import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { DataSource, In, type EntityManager } from 'typeorm';
import {
  definitionRecord,
} from '@/common/automation/definition.types';
import { validateDataValues } from '@/common/automation/data-schema';
import { validateDefinitionInput } from '@/common/automation/definition.repository';
import type {
  WorkflowBusinessBindingView,
  WorkflowBusinessPort,
  WorkflowLaunchContext,
  WorkflowProcessReference,
} from '../contract/workflow-process.interface';
import { WorkflowBusinessBinding } from '../infrastructure/persistence/workflow-business.entity';
import { WorkflowRun } from '../infrastructure/persistence/workflow-run.entities';
import { WorkflowRevision } from '../infrastructure/persistence/workflow.entities';
import { WorkflowExecutionService } from './workflow-execution.service';
import { WorkflowProcessRegistry } from './workflow-process.registry';
import type { WorkflowBusinessMessage, WorkflowMessageIngress } from '../contract/workflow-message.types';
import { businessMessageIngress } from '../domain/workflow-message.policy';

@Injectable()
export class WorkflowBusinessService implements WorkflowBusinessPort {
  constructor(
    private readonly database: DataSource,
    private readonly execution: WorkflowExecutionService,
    private readonly processes: WorkflowProcessRegistry,
  ) {}

  /**
   * 在业务删除事务中锁定对象的活动流程，存在等待或执行令牌时阻止删除业务事实。
   * @param processRef - 业务模块声明的固定流程接口。
   * @param scopeId - 待删除对象的权威业务范围。
   * @param subjectId - 事务已经锁定的业务对象。
   * @param manager - 同一业务删除事务的数据库管理器。
   * @throws 没有活动事务或业务对象仍有未结束流程时拒绝删除。
   */
  async assertIdle(processRef: WorkflowProcessReference, scopeId: string, subjectId: string, manager: EntityManager): Promise<void> {
    this.checkScope(processRef, scopeId);
    if (!manager.queryRunner?.isTransactionActive) throw new BadRequestException('删除业务对象必须核对同一事务的工作流状态');
    const active = await manager.getRepository(WorkflowRun).findOne({
      where: { businessSubjectKey: this.subjectKey(processRef, scopeId, subjectId), status: In(['pending', 'running', 'waiting']) },
      lock: { mode: 'pessimistic_write' },
    });
    if (active) throw new ConflictException('任务工作流尚未结束，请先取消流程并等待步骤退出');
  }

  /**
   * 从业务身份读取最近一次所属流程，业务页面不接受其他对象的任意运行标识。
   * @param processRef - 业务模块固定的流程接口版本。
   * @param scopeId - 权限边界确认的业务范围。
   * @param subjectId - 该范围内已经存在的业务对象。
   * @returns 最近运行及步骤状态，没有运行时为空。
   * @throws 业务对象标识为空或超长时拒绝查询。
   */
  async latest(
    processRef: WorkflowProcessReference,
    scopeId: string,
    subjectId: string,
  ) {
    this.checkScope(processRef, scopeId);
    if (!subjectId || subjectId.length > 96)
      throw new BadRequestException('业务对象身份无效');
    const run = await this.database.getRepository(WorkflowRun).findOne({
      where: {
        businessSubjectKey: this.subjectKey(processRef, scopeId, subjectId),
      },
      order: { id: 'DESC' },
    });
    if (!run) return null;
    return this.execution.read(run.id);
  }

  /**
   * 读取业务接口统一绑定的精确发布版本，不以 Work 或 Task 切分流程模型。
   * @param processRef - 业务接口及固定版本。
   * @returns 当前绑定，没有配置时为空。
   * @throws 业务范围或当前接口版本不合法时拒绝读取。
   */
  async binding(
    processRef: WorkflowProcessReference,
  ): Promise<WorkflowBusinessBindingView | null> {
    const scopeId = 'business';
    this.checkScope(processRef, scopeId);
    const row = await this.database
      .getRepository(WorkflowBusinessBinding)
      .findOneBy({ processKey: processRef.key, scopeId });
    if (!row) return null;
    if (row.processVersion !== processRef.version)
      throw new ConflictException('业务绑定接口版本不匹配，请重新确认绑定');
    const publication = await this.database
      .getRepository(WorkflowRevision)
      .findOne({
        where: { definitionId: row.workflowId, version: row.workflowVersion },
        select: ['name'],
      });
    return {
      workflowName: publication?.name,
      processRef,
      scopeId,
      workflowRef: { id: row.workflowId, version: row.workflowVersion },
      revision: row.revision,
    };
  }

  /**
   * 从业务入口核对绑定和业务身份，串行创建该对象唯一未结束实例，重复请求返回原实例。
   * @param processRef - 业务模块固定声明的接口，不能取自浏览器任意选择。
   * @param context - 权限边界确认的对象、修订、操作者及业务提交值。
   * @param executionKey - 业务页面本次操作保留的幂等请求键。
   * @returns 新建或同一请求原有的工作流身份。
   * @throws 缺少绑定、对象正在运行、身份漂移或请求键重复用于其他内容时拒绝发起。
   */
  async launch(
    processRef: WorkflowProcessReference,
    context: WorkflowLaunchContext,
    executionKey: string,
  ): Promise<{ runId: string }> {
    return this.enter(processRef, context, executionKey);
  }

  /**
   * 根据业务统一绑定和消息关联键返回原实例，首次消息与等待快照原子保存，避免重试创建重复流程。
   * @param processRef - 模块固定声明的业务接口，禁止来自页面选择。
   * @param context - 权限边界确认的业务对象、操作者及准备输入。
   * @param message - 业务事件的稳定投递标识、类型与正文。
   * @returns 新建或已匹配流程的身份，重复消息始终返回原实例。
   * @throws 外部事务尚未提交时拒绝跨实例投递，避免释放业务锁后出现不可见回执。
   */
  async receiveMessage(processRef: WorkflowProcessReference, context: WorkflowLaunchContext, message: WorkflowBusinessMessage): Promise<{ runId: string }> {
    if (context.transaction) throw new BadRequestException('业务消息请在对象事务提交后投递');
    const ingress = validateDefinitionInput(() => businessMessageIngress(message, [processRef.key, context.scopeId, context.subjectId]));
    return this.enter(processRef, context, `message:${ingress.ingressKey}`, ingress);
  }

  /**
   * 在同一业务对象锁内核验请求与绑定，避免消息首发和常规发起同时创建未结束实例。
   * @param processRef - 模块固定接口。
   * @param context - 已鉴权的业务身份与提交内容。
   * @param executionKey - 本次业务操作的稳定请求键。
   * @param message - 自动消息入口的密封投递，可省略以常规发起。
   * @returns 本次操作对应的唯一流程身份。
   * @throws 幂等键冲突、绑定失效、业务身份漂移或活动实例归属不符时拒绝进入。
   */
  private async enter(processRef: WorkflowProcessReference, context: WorkflowLaunchContext, executionKey: string, message?: WorkflowMessageIngress): Promise<{ runId: string }> {
    this.checkScope(processRef, context.scopeId);
    const subjectValid = Boolean(context.subjectId) && context.subjectId.length <= 96;
    const actorValid = Boolean(context.actorId) && context.actorId.length <= 96;
    const revisionValid = Number.isSafeInteger(context.revision) && context.revision >= 1;
    if (!subjectValid || !actorValid || !revisionValid)
      throw new BadRequestException('发起流程的业务对象、修订或操作者无效');
    if (
      typeof executionKey !== 'string' ||
      !executionKey.trim() ||
      executionKey.length > 128
    )
      throw new BadRequestException('业务执行请求键需要 1 至 128 字符');
    const values = definitionRecord(context.values);
    let formEntries: Array<[string, unknown]> | null = null;
    if (context.formValues !== undefined)
      formEntries = Object.entries(definitionRecord(context.formValues)).sort(([a], [b]) => a.localeCompare(b));
    const subjectKey = this.subjectKey(processRef, context.scopeId, context.subjectId);
    const requestKey = `business:${this.digest([processRef.key, context.scopeId, executionKey])}`;
    const requestHash = this.digest([
      processRef,
      context.scopeId,
      context.subjectId,
      context.revision,
      context.actorId,
      Object.entries(values).sort(([a], [b]) => a.localeCompare(b)),
      formEntries,
      context.bindingRevision ?? null,
    ]);
    const connection = this.database.createQueryRunner();
    const lock = `kt:business:${subjectKey.slice(0, 48)}`;
    let lockWaitSeconds = 0;
    if (message) lockWaitSeconds = 3;
    let acquired = false;
    try {
      await connection.connect();
      acquired =
        Number(
          (
            await connection.query('SELECT GET_LOCK(?, ?) AS acquired', [lock, lockWaitSeconds])
          )[0]?.acquired,
        ) === 1;
      if (!acquired)
        throw new ConflictException('同一业务对象正在发起流程，请稍后重试');
      if (message) {
        const accepted = await connection.manager.getRepository(WorkflowRun).createQueryBuilder('run')
          .where('run.businessSubjectKey = :subjectKey', { subjectKey })
          .andWhere("JSON_CONTAINS(run.bpmn_state, :receipt, '$.messages')", { receipt: JSON.stringify({ ingressKey: message.ingressKey }) })
          .getOne();
        if (accepted) {
          const receipt = accepted.bpmnState.messages.find((item) => item.ingressKey === message.ingressKey);
          if (receipt.ingressHash !== message.ingressHash) throw new ConflictException('业务消息投递键已经用于不同内容');
          return { runId: accepted.id };
        }
        const active = await connection.manager.findOneBy(WorkflowRun, { businessSubjectKey: subjectKey, status: In(['pending', 'running', 'waiting']) });
        if (active) {
          if (active.businessContext?.processRef.key !== processRef.key || active.businessContext.processRef.version !== processRef.version)
            throw new ConflictException('同一业务对象正在执行其他业务接口的流程');
          await this.execution.receiveBusinessMessage(active.id, message);
          return { runId: active.id };
        }
      }
      const existing = await connection.manager.findOneBy(WorkflowRun, {
        executionKey: createHash('sha256').update(requestKey).digest('hex'),
      });
      if (existing) {
        if (existing.businessContext?.requestHash !== requestHash)
          throw new ConflictException('业务请求键已经用于不同内容');
        return { runId: existing.id };
      }
      if (
        await connection.manager.existsBy(WorkflowRun, {
          businessSubjectKey: subjectKey,
          status: In(['pending', 'running', 'waiting']),
        })
      )
        throw new ConflictException('该业务对象已有未结束工作流');
      const binding = await this.binding(processRef);
      if (!binding) throw new BadRequestException('业务尚未绑定已发布工作流');
      if (context.bindingRevision !== undefined && context.bindingRevision !== binding.revision)
        throw new ConflictException('业务流程绑定已变更，请刷新后重新填写');
      if (context.formValues !== undefined && context.bindingRevision === undefined)
        throw new BadRequestException('表单提交必须提供填写时的绑定修订');
      const process = this.processes.resolve(processRef);
      const submission = await this.execution.submission(binding.workflowRef, context.formValues);
      const launchValues = { ...values };
      for (const [key, value] of Object.entries(submission.values)) {
        if (Object.hasOwn(launchValues, key) && !isDeepStrictEqual(launchValues[key], value))
          throw new BadRequestException('表单与业务入口的同名参数不一致');
        launchValues[key] = value;
      }
      if (submission.formValues)
        validateDefinitionInput(() => validateDataValues(process.launchSchema ?? { fields: [] }, launchValues));
      const prepared = await process.prepare({ ...context, values: launchValues });
      const preparedInput = validateDefinitionInput(() =>
        validateDataValues(process.inputSchema, prepared.input),
      );
      if (
        prepared.identity.scopeId !== context.scopeId ||
        prepared.identity.subjectId !== context.subjectId ||
        prepared.identity.revision !== context.revision
      )
        throw new ConflictException(
          '业务接口返回的对象身份或修订与发起请求不一致',
        );
      return await this.execution.startBusiness(
        binding.workflowRef,
        preparedInput,
        requestKey,
        {
          ...prepared.identity,
          actorId: context.actorId,
          processRef,
          bindingRevision: binding.revision,
          requestHash,
        },
        subjectKey,
        submission.formValues,
        context.transaction,
        message,
      );
    } finally {
      try {
        if (acquired) await connection.query('SELECT RELEASE_LOCK(?)', [lock]);
      } finally {
        await connection.release();
      }
    }
  }

  /**
   * 限制业务范围标识并确认接口已装配，避免写入不能被本实例解释的绑定。
   * @param processRef - 业务固定接口版本。
   * @param scopeId - 业务范围身份。
   * @throws 范围格式或接口版本不支持时拒绝操作。
   */
  private checkScope(
    processRef: WorkflowProcessReference,
    scopeId: string,
  ): void {
    if (
      typeof scopeId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,95}$/.test(scopeId)
    )
      throw new BadRequestException('业务范围身份无效');
    this.processes.resolve(processRef);
  }

  /**
   * 让同一业务对象的不同流程共用工作流运行锁，避免检查、清理与治理同时占用同一任务。
   * @param reference - 当前业务明确选择的流程接口。
   * @param scopeId - 权威业务范围，例如媒体 Work。
   * @param subjectId - 范围内的固定业务对象。
   * @returns 用于实例查询与并发互斥的稳定摘要。
   */
  private subjectKey(reference: WorkflowProcessReference, scopeId: string, subjectId: string): string {
    const process = this.processes.resolve(reference);
    return this.digest([process.concurrencyGroup ?? reference.key, scopeId, subjectId]);
  }

  /**
   * 对固定顺序的请求元组生成有限身份，避免超长业务键进入数据库锁与唯一索引。
   * @param values - 已按契约排序的身份或输入元组。
   * @returns 十六进制摘要。
   */
  private digest(values: unknown[]): string {
    return createHash('sha256').update(JSON.stringify(values)).digest('hex');
  }
}
