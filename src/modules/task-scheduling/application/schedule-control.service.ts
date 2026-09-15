import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { createSnowflakeId } from '@/common/snowflake/snowflake-id';
import type { PublishedReference } from '@/common/automation/definition.types';
import {
  TRIGGER_OCCURRENCES,
  type TriggerOccurrencePort,
} from '@/modules/trigger-engine/contract/trigger-runtime.port';
import type { SchedulePlanPort } from '../contract/schedule.types';
import {
  ScheduleRegistration,
  ScheduleState,
} from '../infrastructure/persistence/schedule-plan.entities';
import { ScheduleLock } from '../infrastructure/schedule-lock';
import { ScheduleDefinitionService } from './schedule-definition.service';

@Injectable()
export class ScheduleControlService implements SchedulePlanPort {
  constructor(
    private readonly database: DataSource,
    private readonly definitions: ScheduleDefinitionService,
    private readonly locks: ScheduleLock,
    @Inject(TRIGGER_OCCURRENCES)
    private readonly triggers: TriggerOccurrencePort,
  ) {}

  /**
   * 查询计划启停状态和当前注册阶段，不把发布版本号当作启停修订号。
   * @param scheduleId - 计划资源身份。
   * @returns 状态修订、实际绑定版本以及注册激活情况。
   */
  async state(scheduleId: string) {
    await this.definitions.definitions.detail(scheduleId);
    const state = await this.database
      .getRepository(ScheduleState)
      .findOneBy({ scheduleId });
    let activeVersion: number | null = null;
    let activationStatus: string | null = null;
    let manualTrigger = false;
    let nextRunAt: string | null = null;
    if (state?.activeBindingId) {
      const binding = await this.database
        .getRepository(ScheduleRegistration)
        .findOneBy({ id: state.activeBindingId });
      if (binding) {
        activeVersion = binding.scheduleVersion;
        const registration = await this.triggers.readRegistration(
          binding.registrationId,
        );
        activationStatus = registration.status;
        if (
          state.enabled &&
          registration.status === 'active' &&
          registration.nextAt
        )
          nextRunAt = registration.nextAt.toISOString();
        manualTrigger =
          (await this.definitions.triggers.resolve(registration.triggerRef))
            .trigger.type === 'manual';
      }
    }
    return {
      scheduleId,
      revision: state?.revision || 0,
      enabled: state?.enabled || false,
      activeVersion,
      activationStatus,
      manualTrigger,
      nextRunAt,
      error: state?.errorMessage || null,
    };
  }

  /**
   * 先准备未激活注册，再原子保存计划关联，最后启用发生条件，防止事件早于消费关联。
   * @param reference - 操作者明确选择的固定计划版本。
   * @param expectedRevision - 页面最后读取的启停状态修订号。
   * @returns 已保存的计划状态；暂时无法激活时保留错误供恢复流程重试。
   * @throws 状态修订冲突、其他操作者持锁或依赖校验失败时拒绝启用。
   */
  async enable(reference: PublishedReference, expectedRevision: number) {
    this.validateRevision(expectedRevision);
    const definition = await this.definitions.resolve(reference);
    await this.definitions.checkForPublish(definition);
    if (!definition.triggerRef)
      throw new BadRequestException('计划尚未指定触发器');
    const triggerRef = definition.triggerRef;
    const applied = await this.locks.run(reference.id, async (manager) => {
      const state = await this.ensureState(manager, reference.id);
      if (state.revision !== expectedRevision)
        throw new ConflictException('计划启停状态已经变化，请刷新后重试');
      const activationRevision = state.revision + 1;
      const registration = await this.triggers.prepare({
        consumerKey: `schedule:${reference.id}:${activationRevision}`,
        triggerRef,
      });
      const binding = manager.create(ScheduleRegistration, {
        id: createSnowflakeId(),
        scheduleId: reference.id,
        scheduleVersion: reference.version,
        activationRevision,
        registrationId: registration.id,
        retired: false,
      });
      await manager.transaction(async (transaction) => {
        await transaction.insert(ScheduleRegistration, binding);
        await transaction.update(
          ScheduleState,
          { scheduleId: reference.id, revision: expectedRevision },
          {
            enabled: true,
            revision: activationRevision,
            activeBindingId: binding.id,
            errorMessage: null,
          },
        );
      });
      await this.reconcileLocked(manager, reference.id);
      return true;
    });
    if (!applied) throw new ConflictException('计划正在被处理，请稍后重试');
    return this.state(reference.id);
  }

  /**
   * 先禁止新的派发，再关闭触发注册；已经开始的运行由执行中心单独取消。
   * @param scheduleId - 待停用的计划身份。
   * @param expectedRevision - 当前启停状态修订号。
   * @returns 停用后的计划状态。
   * @throws 状态发生变化或另一个操作者持锁时拒绝覆盖。
   */
  async disable(scheduleId: string, expectedRevision: number) {
    this.validateRevision(expectedRevision);
    await this.definitions.definitions.detail(scheduleId);
    const applied = await this.locks.run(scheduleId, async (manager) => {
      const state = await this.ensureState(manager, scheduleId);
      if (state.revision !== expectedRevision)
        throw new ConflictException('计划启停状态已经变化，请刷新后重试');
      await manager.update(
        ScheduleState,
        { scheduleId, revision: expectedRevision },
        {
          enabled: false,
          revision: expectedRevision + 1,
          activeBindingId: null,
          errorMessage: null,
        },
      );
      await this.reconcileLocked(manager, scheduleId);
      return true;
    });
    if (!applied) throw new ConflictException('计划正在被处理，请稍后重试');
    return this.state(scheduleId);
  }

  /**
   * 给启用中的手动计划记录一次发生事件，沿用正常的准入和派发流程。
   * @param scheduleId - 操作者选择的计划身份。
   * @param eventId - 页面为本次点击保存的稳定请求身份。
   * @returns 持久化的触发发生记录。
   * @throws 计划未启用或发生注册不支持手动触发时拒绝请求。
   */
  async fire(scheduleId: string, eventId: string) {
    const occurrence = await this.locks.run(scheduleId, async (manager) => {
      const state = await manager.findOneBy(ScheduleState, { scheduleId });
      if (!state?.enabled || !state.activeBindingId)
        throw new ConflictException('计划尚未启用');
      const binding = await manager.findOneBy(ScheduleRegistration, {
        id: state.activeBindingId,
      });
      if (!binding) throw new ConflictException('计划触发关联缺失');
      return this.triggers.fire(binding.registrationId, eventId);
    });
    if (!occurrence) throw new ConflictException('计划正在被处理，请稍后重试');
    return occurrence;
  }

  /**
   * 恢复计划关联保存后尚未完成的启停步骤，恢复本身不触发任务执行。
   * @param scheduleId - 需要校准注册状态的计划身份。
   */
  async reconcile(scheduleId: string): Promise<void> {
    await this.locks.run(scheduleId, async (manager) =>
      this.reconcileLocked(manager, scheduleId),
    );
  }

  /**
   * 分页读取仍有激活、退役或执行收尾工作的计划，避免固定前一百条饿死后续计划。
   * @param afterId - 上一批处理到的计划身份。
   * @returns 按身份递增的最多一百个计划。
   */
  async pendingScheduleIds(afterId: string) {
    const rows = await this.database
      .getRepository(ScheduleState)
      .createQueryBuilder('state')
      .where('state.scheduleId > :afterId', { afterId })
      .andWhere(
        '(state.enabled = 1 OR EXISTS (SELECT 1 FROM automation_schedule_binding binding WHERE binding.schedule_id = state.schedule_id AND binding.retired = 0) OR EXISTS (SELECT 1 FROM automation_schedule_dispatch dispatch WHERE dispatch.schedule_id = state.schedule_id AND dispatch.status IN (:...statuses)))',
        { statuses: ['pending', 'starting', 'running'] },
      )
      .orderBy('state.scheduleId', 'ASC')
      .take(100)
      .getMany();
    return rows.map((row) => row.scheduleId);
  }

  /**
   * 在计划锁内关闭历史注册并恢复当前注册；失败保留状态和原因以便再次执行。
   * @param manager - 持有计划锁的数据库连接。
   * @param scheduleId - 当前计划身份。
   * @throws 当前注册已经关闭时中止恢复，由本方法捕获并保存失败状态。
   */
  private async reconcileLocked(
    manager: EntityManager,
    scheduleId: string,
  ): Promise<void> {
    const state = await manager.findOneBy(ScheduleState, { scheduleId });
    if (!state) return;
    const bindings = await manager.find(ScheduleRegistration, {
      where: { scheduleId, retired: false },
      order: { id: 'ASC' },
    });
    try {
      for (const binding of bindings) {
        if (state.enabled && binding.id === state.activeBindingId) {
          const registration = await this.triggers.readRegistration(
            binding.registrationId,
          );
          if (registration.status === 'prepared')
            await this.triggers.activate(binding.registrationId);
          if (registration.status === 'closed')
            throw new ConflictException(
              '活动计划的触发注册已关闭，请重新启用计划',
            );
        } else await this.triggers.close(binding.registrationId);
      }
      await manager.update(
        ScheduleState,
        { scheduleId },
        { errorMessage: null },
      );
    } catch (error) {
      let errorMessage = '触发注册状态恢复失败';
      if (error instanceof Error) errorMessage = error.message.slice(0, 2048);
      await manager.update(ScheduleState, { scheduleId }, { errorMessage });
    }
  }

  /**
   * 仅在计划第一次启停时建立状态行，保持定义版本与控制修订独立。
   * @param manager - 当前计划锁连接。
   * @param scheduleId - 已验证存在的计划身份。
   * @returns 已存在或新建的初始状态。
   */
  private async ensureState(
    manager: EntityManager,
    scheduleId: string,
  ): Promise<ScheduleState> {
    const current = await manager.findOneBy(ScheduleState, { scheduleId });
    if (current) return current;
    const state = manager.create(ScheduleState, {
      scheduleId,
      revision: 0,
      enabled: false,
      activeBindingId: null,
      errorMessage: null,
    });
    await manager.insert(ScheduleState, state);
    return state;
  }

  /**
   * 强制控制操作携带有效修订号，避免迟到页面覆盖最新启停状态。
   * @param revision - 页面读取的状态修订号。
   * @throws 修订号不是非负安全整数时拒绝操作。
   */
  private validateRevision(revision: number): void {
    if (!Number.isSafeInteger(revision) || revision < 0)
      throw new BadRequestException('计划启停操作必须携带状态修订号');
  }
}
