import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, In, LessThanOrEqual, type EntityManager } from 'typeorm';
import { createSnowflakeId } from '@/common/snowflake/snowflake-id';
import type { DataScalar } from '@/common/automation/data-schema';
import {
  TRIGGER_OCCURRENCES,
  type TriggerOccurrencePort,
  type TriggerOccurrenceView,
} from '@/modules/trigger-engine/contract/trigger-runtime.port';
import { bindScheduleValues } from '../domain/schedule-definition.policy';
import {
  ScheduleDispatch,
  ScheduleRegistration,
  ScheduleState,
} from '../infrastructure/persistence/schedule-plan.entities';
import { ScheduleLock } from '../infrastructure/schedule-lock';
import { ScheduleDefinitionService } from './schedule-definition.service';

@Injectable()
export class ScheduleDispatchService {
  constructor(
    private readonly database: DataSource,
    private readonly definitions: ScheduleDefinitionService,
    private readonly locks: ScheduleLock,
    @Inject(TRIGGER_OCCURRENCES)
    private readonly triggers: TriggerOccurrencePort,
  ) {}

  /**
   * 在计划锁内收取持久事件、确认收件并推进目标运行，只通过执行模块公开端口派发。
   * @param scheduleId - 当前需要推进的计划身份。
   */
  async process(scheduleId: string): Promise<void> {
    await this.locks.run(scheduleId, async (manager) => {
      const state = await manager.findOneBy(ScheduleState, { scheduleId });
      if (!state) return;
      await this.collect(manager, state);
      const running = await manager.find(ScheduleDispatch, {
        where: {
          scheduleId,
          status: 'running',
          nextAttemptAt: LessThanOrEqual(new Date()),
        },
        order: { id: 'ASC' },
        take: 100,
      });
      for (const row of running) await this.refreshTarget(manager, row);
      const pending = await manager.find(ScheduleDispatch, {
        where: {
          scheduleId,
          status: In(['pending', 'starting']),
          nextAttemptAt: LessThanOrEqual(new Date()),
        },
        order: { id: 'ASC' },
        take: 100,
      });
      for (const row of pending) await this.startTarget(manager, state, row);
    });
  }

  /**
   * 读取计划自己的派发历史，执行输出和步骤由相应执行模块展示。
   * @param scheduleId - 当前计划资源身份。
   * @param beforeId - 上一页末尾的派发身份。
   * @returns 最近一百条派发及下一页游标。
   * @throws 游标不是正整数身份时拒绝查询。
   */
  async history(scheduleId: string, beforeId?: string) {
    const query = this.database
      .getRepository(ScheduleDispatch)
      .createQueryBuilder('dispatch')
      .where('dispatch.scheduleId = :scheduleId', { scheduleId });
    if (beforeId) {
      if (!/^[1-9]\d{0,19}$/.test(beforeId))
        throw new BadRequestException('派发记录游标不合法');
      query.andWhere('dispatch.id < :beforeId', { beforeId });
    }
    const rows = await query.orderBy('dispatch.id', 'DESC').take(101).getMany();
    let nextCursor: string | null = null;
    if (rows.length > 100) {
      rows.pop();
      nextCursor = rows[rows.length - 1].id;
    }
    return {
      list: rows.map((row) => ({
        id: row.id,
        scheduleId: row.scheduleId,
        scheduleVersion: row.scheduleVersion,
        occurrenceId: row.occurrenceId,
        occurredAt: row.occurredAt,
        status: row.status,
        target: row.definition.target,
        targetRunId: row.targetRunId,
        error: row.errorMessage,
        finishedAt: row.finishedAt,
      })),
      nextCursor,
    };
  }

  /**
   * 先将事件保存到本模块收件记录再确认，跨模块确认失败时通过唯一身份安全重试。
   * @param manager - 持有计划锁的连接。
   * @param state - 本轮读取的计划启停状态。
   */
  private async collect(
    manager: EntityManager,
    state: ScheduleState,
  ): Promise<void> {
    const bindings = await manager.find(ScheduleRegistration, {
      where: { scheduleId: state.scheduleId, retired: false },
      order: { id: 'ASC' },
    });
    for (const binding of bindings) {
      const pending = await this.triggers.pending(binding.registrationId);
      const definition = await this.definitions.resolve({
        id: binding.scheduleId,
        version: binding.scheduleVersion,
      });
      for (const occurrence of pending) {
        let row = await manager.findOneBy(ScheduleDispatch, {
          occurrenceId: occurrence.id,
        });
        if (!row) {
          row = manager.create(ScheduleDispatch, {
            id: createSnowflakeId(),
            scheduleId: state.scheduleId,
            scheduleVersion: binding.scheduleVersion,
            bindingId: binding.id,
            occurrenceId: occurrence.id,
            registrationId: binding.registrationId,
            occurrencePayload: occurrence.payload,
            occurredAt: occurrence.occurredAt,
            definition,
            status: 'pending',
            targetRunId: null,
            errorMessage: null,
            deadlineAt: new Date(Date.now() + definition.taskDeadlineMs),
            nextAttemptAt: new Date(),
            finishedAt: null,
          });
          await manager.insert(ScheduleDispatch, row);
        }
        await this.triggers.acknowledge(occurrence.id, binding.registrationId);
      }
      if (binding.id !== state.activeBindingId && !pending.length) {
        const registration = await this.triggers.readRegistration(
          binding.registrationId,
        );
        if (registration.status === 'closed')
          await manager.update(
            ScheduleRegistration,
            { id: binding.id },
            { retired: true },
          );
      }
    }
  }

  /**
   * 检查启停、重叠与固定准入规则，再用稳定请求身份向任务或工作流发起运行。
   * @param manager - 持有计划锁的连接。
   * @param state - 本轮稳定的计划控制状态。
   * @param row - 已可靠收取但尚未关联目标运行的事件。
   * @throws 目标配置不合法或对应模块未装配时中止派发，由本方法记录失败或延期恢复。
   */
  private async startTarget(
    manager: EntityManager,
    state: ScheduleState,
    row: ScheduleDispatch,
  ): Promise<void> {
    if (
      row.status === 'pending' &&
      (!state.enabled || state.activeBindingId !== row.bindingId)
    ) {
      await this.finish(
        manager,
        row,
        'skipped',
        '计划已停用或此触发注册已被替换',
      );
      return;
    }
    try {
      if (row.status === 'pending' && row.definition.overlap === 'skip') {
        const busy = await manager.exists(ScheduleDispatch, {
          where: {
            scheduleId: row.scheduleId,
            status: In(['starting', 'running']),
          },
        });
        if (busy) {
          await this.finish(manager, row, 'skipped', '上一次计划运行尚未结束');
          return;
        }
      }
      const occurrence: TriggerOccurrenceView = {
        id: row.occurrenceId,
        registrationId: row.registrationId,
        triggerRef: row.definition.triggerRef!,
        occurredAt: row.occurredAt,
        payload: row.occurrencePayload as Record<string, DataScalar>,
        status: 'acknowledged',
      };
      const admission = row.definition.admission;
      if (row.status === 'pending' && admission) {
        if (!this.definitions.rules)
          throw new BadRequestException('规则引擎未装配');
        const result = await this.definitions.rules.evaluate(
          admission.ruleRef,
          bindScheduleValues(admission.facts, occurrence),
        );
        if (result.result !== admission.expected) {
          await this.finish(manager, row, 'skipped', '准入规则未匹配');
          return;
        }
      }
      const target = row.definition.target;
      if (!target) throw new BadRequestException('已发布计划缺少执行目标');
      if (row.status === 'pending' && target.type === 'task') {
        if (!this.definitions.tasks)
          throw new BadRequestException('原子任务模块未装配');
        const capability = await this.definitions.tasks.resolve(
          target.reference,
        );
        if (!capability.available) {
          await this.finish(manager, row, 'skipped', '执行能力暂不可用');
          return;
        }
      }
      const input = bindScheduleValues(row.definition.input, occurrence);
      const executionKey = `schedule-${row.scheduleId}-${row.occurrenceId}`;
      if (row.status === 'pending') {
        row.status = 'starting';
        await manager.save(row);
      }
      let runId: string;
      if (target.type === 'task') {
        if (!this.definitions.tasks)
          throw new BadRequestException('原子任务模块未装配');
        const run = await this.definitions.tasks.start({
          taskRef: target.reference,
          executionKey,
          input,
          deadlineAt: row.deadlineAt.getTime(),
        });
        runId = run.runId;
      } else {
        if (!this.definitions.workflows)
          throw new BadRequestException('工作流模块未装配');
        const run = await this.definitions.workflows.start(
          target.reference,
          input,
          executionKey,
        );
        runId = run.runId;
      }
      row.targetRunId = runId;
      row.status = 'running';
      row.errorMessage = null;
      row.nextAttemptAt = new Date();
      await manager.save(row);
      await this.refreshTarget(manager, row);
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        await this.finish(manager, row, 'failed', error.message);
      } else await this.defer(manager, row, error);
    }
  }

  /**
   * 从目标公开状态刷新本计划派发结果，不把读取失败当作执行失败或重新发起。
   * @param manager - 当前计划锁连接。
   * @param row - 已关联目标身份的派发记录。
   * @throws 目标模块未装配时中止本轮读取，由本方法保留运行身份并延期恢复。
   */
  private async refreshTarget(
    manager: EntityManager,
    row: ScheduleDispatch,
  ): Promise<void> {
    if (!row.targetRunId || !row.definition.target) return;
    try {
      const target = row.definition.target;
      let result: { status: string; error: string | null };
      if (target.type === 'task') {
        if (!this.definitions.tasks) throw new Error('原子任务模块暂未装配');
        result = await this.definitions.tasks.read(row.targetRunId);
      } else {
        if (!this.definitions.workflows) throw new Error('工作流模块暂未装配');
        result = await this.definitions.workflows.read(row.targetRunId);
      }
      if (
        result.status === 'succeeded' ||
        result.status === 'failed' ||
        result.status === 'cancelled'
      )
        await this.finish(manager, row, result.status, result.error);
      else
        await manager.update(
          ScheduleDispatch,
          { id: row.id },
          { nextAttemptAt: new Date(Date.now() + 1000), errorMessage: null },
        );
    } catch (error) {
      await this.defer(manager, row, error);
    }
  }

  /**
   * 保存明确的终态原因及完成时间，保留事件和目标关联以供执行中心追溯。
   * @param manager - 当前计划锁连接。
   * @param row - 待结束的派发记录。
   * @param status - 明确的执行或准入终态。
   * @param message - 失败或跳过原因，成功时可为空。
   */
  private async finish(
    manager: EntityManager,
    row: ScheduleDispatch,
    status: 'succeeded' | 'failed' | 'cancelled' | 'skipped',
    message: string | null,
  ): Promise<void> {
    row.status = status;
    row.errorMessage = message;
    row.finishedAt = new Date();
    await manager.save(row);
  }

  /**
   * 将暂时失败留在原阶段稍后恢复，目标启动响应丢失时仍重用原执行身份。
   * @param manager - 当前计划锁连接。
   * @param row - 尚不能确认结果的派发记录。
   * @param error - 本轮基础设施或响应异常。
   */
  private async defer(
    manager: EntityManager,
    row: ScheduleDispatch,
    error: unknown,
  ): Promise<void> {
    let errorMessage = '派发状态暂时无法确认，正在等待恢复';
    if (error instanceof Error) errorMessage = error.message.slice(0, 2048);
    await manager.update(
      ScheduleDispatch,
      { id: row.id },
      { errorMessage, nextAttemptAt: new Date(Date.now() + 5000) },
    );
  }
}
