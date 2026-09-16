import { TASK_EXECUTION, type TaskExecutionPort } from '@/modules/task-execution/contract/task-execution.port';
import { WorkflowHumanTaskService } from './workflow-human-task.service';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  DataSource,
  EntityManager,
  In,
  LessThan,
  LessThanOrEqual,
} from 'typeorm';
import { createSnowflakeId } from '@/common/snowflake/snowflake-id';
import { validateDataValues } from '@/common/automation/data-schema';
import { validateDefinitionInput } from '@/common/automation/definition.repository';
import type { PublishedReference } from '@/common/automation/definition.types';
import {
  FORM_DEFINITIONS,
  type FormDefinitionPort,
} from '@/modules/form-definition/contract/form.types';
import type {
  WorkflowDocument,
  WorkflowExecutionPort,
} from '../contract/workflow.types';
import type {
  WorkflowNodeVisitPage,
  WorkflowRunView,
} from '../contract/workflow-run.types';
import {
  WorkflowNodeRun,
  WorkflowNodeVisit,
  WorkflowRun,
} from '../infrastructure/persistence/workflow-run.entities';
import { WorkflowDefinitionService } from './workflow-definition.service';
import type {
  WorkflowBusinessContext,
} from '../contract/workflow-process.interface';
import { isBpmnWorkflow, workflowContract } from '../domain/workflow-document.policy';
import { WorkflowBpmnExecutionService } from './workflow-bpmn-execution.service';
import { WorkflowBpmnActivity } from '../infrastructure/persistence/workflow-bpmn.entity';

@Injectable()
export class WorkflowExecutionService implements WorkflowExecutionPort {
  constructor(
    private readonly database: DataSource,
    private readonly definitions: WorkflowDefinitionService,
    @Inject(FORM_DEFINITIONS) private readonly forms: FormDefinitionPort,
    @Optional() private readonly bpmn?: WorkflowBpmnExecutionService,
    @Optional() private readonly human?: WorkflowHumanTaskService,
    @Optional() @Inject(TASK_EXECUTION) private readonly tasks?: TaskExecutionPort,
  ) {}

  /**
   * 在业务已确认的运行范围内读取当前人工待办。
   * @param runId - 固定业务实例标识。
   * @returns 当前仍可办理的用户任务。
   * @throws 人工任务服务未装配时拒绝读取，不能返回伪造的空待办。
   */
  async humanTasks(runId: string) {
    if (!this.human) throw new Error('人工任务模块尚未装配');
    return this.human.pending(runId);
  }

  /**
   * 保存当前活动的人工结果，返回原实例状态供业务页面继续观察。
   * @param runId - 已授权的业务流程实例。
   * @param executionId - 待办活动实例的精确身份。
   * @param actorId - 认证后的办理人。
   * @param values - 该人工节点允许填写的字段。
   * @returns 同一实例的最新持久状态。
   * @throws 人工任务服务未装配时拒绝提交。
   */
  async completeHumanTask(runId: string, executionId: string, actorId: string, values: unknown) {
    if (!this.human) throw new Error('人工任务模块尚未装配');
    await this.human.submit(runId, executionId, actorId, values);
    return this.read(runId);
  }

  /**
   * 从工作流拥有的不可变版本恢复执行图，运行实例不读取草稿。
   * @param reference - 固定工作流版本。
   * @returns 保存的执行图与独立布局。
   */
  resolve(reference: PublishedReference): Promise<WorkflowDocument> {
    return this.definitions.resolve(reference);
  }

  /**
   * 通过表单公开端口解析流程绑定的固定版本，使发起和历史查看不依赖表单管理菜单权限。
   * @param reference - 已授权访问的流程固定版本。
   * @returns 执行图和该版本的表单结构，无表单流程返回空表单。
   */
  async presentation(reference: PublishedReference) {
    const definition = await this.resolve(reference);
    const contract = await workflowContract(definition);
    let form = null;
    if (contract.formRef)
      form = await this.forms.resolve(contract.formRef);
    return { definition, form };
  }

  /**
   * 通过工作流公开端口提供输入契约，调度模块不依赖内部元模型实现。
   * @param reference - 固定工作流版本。
   * @returns 从该版本权威定义解析的业务契约。
   */
  async contract(reference: PublishedReference) {
    return workflowContract(await this.resolve(reference));
  }

  /**
   * 按工作流固定的表单版本校验填写值并映射业务提交参数，未绑定表单时拒绝额外表单载荷。
   * @param reference - 当前业务绑定的精确工作流版本。
   * @param submitted - 用户填写的原表单字段，未使用表单时省略。
   * @returns 校验后的表单快照及仅由已声明映射生成的业务参数。
   * @throws 缺少绑定表单的填写值、字段校验失败或无表单却提交载荷时拒绝发起。
   */
  async submission(reference: PublishedReference, submitted?: Record<string, unknown>) {
    const contract = await this.contract(reference);
    if (!contract.formRef) {
      if (submitted !== undefined) throw new BadRequestException('当前工作流未绑定业务表单');
      return { formValues: null, values: {} as Record<string, unknown> };
    }
    if (submitted === undefined) throw new BadRequestException('请填写当前工作流绑定的业务表单');
    const formValues = await this.forms.validate(contract.formRef, submitted);
    const values: Record<string, unknown> = {};
    for (const [target, source] of Object.entries(contract.formMapping)) {
      if (Object.hasOwn(formValues, source)) values[target] = formValues[source];
    }
    return { formValues, values };
  }

  /**
   * 接受调度端口传入的已映射流程输入，校验固定契约后持久化运行与全部节点。
   * @param reference - 固定流程版本。
   * @param input - 输入契约所声明的字段。
   * @param executionKey - 调用方持久保存的幂等请求键。
   * @returns 稳定运行身份。
   */
  async start(
    reference: PublishedReference,
    input: Record<string, unknown>,
    executionKey: string,
  ): Promise<{ runId: string }> {
    return this.create(reference, input, executionKey, null);
  }

  /**
   * 接受业务绑定服务验证后的上下文，实例固定业务身份及接口版本。
   * @param reference - 业务绑定指向的工作流发布版本。
   * @param input - 业务接口准备并验证的输入。
   * @param executionKey - 业务入口保留的稳定请求键。
   * @param business - 固定业务身份、操作者及绑定修订。
   * @param subjectKey - 用于同一业务对象并发约束的摘要。
   * @param formValues - 工作流已按固定版本校验的原始表单快照。
   * @param transaction - 新业务对象尚未提交的事务，用于原子保存对象和运行。
   * @returns 该业务请求唯一的持久工作流身份。
   */
  async startBusiness(
    reference: PublishedReference,
    input: Record<string, unknown>,
    executionKey: string,
    business: WorkflowBusinessContext,
    subjectKey: string,
    formValues: Record<string, unknown> | null = null,
    transaction?: EntityManager,
  ) {
    return this.create(
      reference,
      input,
      executionKey,
      formValues,
      business,
      subjectKey,
      transaction,
    );
  }

  /**
   * 在单一事务中记录运行和所有节点，重复请求返回原身份且不重置等待时间。
   * @param reference - 固定流程版本。
   * @param input - 映射后的流程输入。
   * @param executionKey - 幂等执行请求键。
   * @param formValues - 由流程实例保存的原表单值，无表单发起时为空。
   * @param business - 业务发起时密封的上下文，历史技术流程为空。
   * @param subjectKey - 业务对象的并发约束摘要。
   * @param transaction - 可选的业务创建事务；未传时由工作流自行开启事务。
   * @returns 稳定运行身份。
   * @throws 请求键对应不同输入或发布依赖失效时拒绝创建。
   */
  private async create(
    reference: PublishedReference,
    input: Record<string, unknown>,
    executionKey: string,
    formValues: Record<string, unknown> | null,
    business: WorkflowBusinessContext | null = null,
    subjectKey: string | null = null,
    transaction?: EntityManager,
  ) {
    const definition = await this.resolve(reference);
    const contract = await workflowContract(definition);
    if (contract.processRef) {
      if (
        !business ||
        contract.processRef.key !== business.processRef.key ||
        contract.processRef.version !== business.processRef.version
      )
        throw new BadRequestException('业务工作流只能从兼容的业务绑定入口发起');
    } else if (business)
      throw new BadRequestException('工作流没有声明业务流程接口');
    if (
      typeof executionKey !== 'string' ||
      !executionKey.trim() ||
      executionKey.length > 191
    )
      throw new BadRequestException('必须提供 1 至 191 字符的执行请求键');
    const inputValues = validateDefinitionInput(() =>
      validateDataValues(contract.inputSchema, input),
    );
    const key = createHash('sha256').update(executionKey).digest('hex');
    let formEntries: Array<[string, unknown]> | null = null;
    if (formValues)
      formEntries = Object.entries(formValues).sort(([left], [right]) =>
        left.localeCompare(right),
      );
    const requestParts: unknown[] = [
      reference.id,
      reference.version,
      Object.entries(inputValues).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
      formEntries,
    ];
    if (business) requestParts.push(business);
    const requestHash = createHash('sha256')
      .update(JSON.stringify(requestParts))
      .digest('hex');
    const manager = transaction ?? this.database.manager;
    if (transaction && !transaction.queryRunner?.isTransactionActive)
      throw new BadRequestException('业务创建必须使用活动事务');
    const repository = manager.getRepository(WorkflowRun);
    const existing = await repository.findOneBy({ executionKey: key });
    if (existing) {
      if (existing.requestHash !== requestHash)
        throw new ConflictException('流程请求键已经用于不同内容');
      return { runId: existing.id };
    }
    await this.definitions.checkForPublish(definition);
    const run = repository.create({
      id: createSnowflakeId(),
      workflowId: reference.id,
      workflowVersion: reference.version,
      executionKey: key,
      requestHash,
      businessContext: business,
      businessSubjectKey: subjectKey,
      status: 'pending',
      inputValues,
      formValues,
      outputValues: null,
      bpmnState: null,
      cancelRequested: false,
      errorMessage: null,
      deadlineAt: new Date(Date.now() + contract.timeoutMs),
      nextWakeAt: new Date(),
      finishedAt: null,
    });
    try {
      const persist = async (manager: EntityManager) => {
        await manager.insert(WorkflowRun, run);

      };
      if (transaction) await persist(transaction);
      else await this.database.transaction(persist);
    } catch (error) {
      const duplicate = await repository.findOneBy({ executionKey: key });
      if (!duplicate) throw error;
      if (duplicate.requestHash !== requestHash)
        throw new ConflictException('流程请求键已经用于不同内容');
      return { runId: duplicate.id };
    }
    return { runId: run.id };
  }

  /**
   * 返回固定版本下的运行和节点进度，供执行图按节点身份着色。
   * @param runId - 流程运行身份。
   * @returns 流程实例及节点输出、唤醒时间和原子运行关联。
   * @throws 运行不存在时返回 HTTP 404。
   */
  async read(runId: string): Promise<WorkflowRunView> {
    const run = await this.database
      .getRepository(WorkflowRun)
      .findOneBy({ id: runId });
    if (!run) throw new NotFoundException('流程运行不存在');
    const nodes = await this.database
      .getRepository(WorkflowNodeRun)
      .findBy({ runId });
    const activities = await this.database.getRepository(WorkflowBpmnActivity).findBy({ runId });
    const bpmnNodes = new Map<string, WorkflowNodeRun>();
    for (const activity of activities) {
      const current = bpmnNodes.get(activity.elementId);
      if (!current || activity.state.visit > current.visit || activity.state.status === 'waiting') bpmnNodes.set(activity.elementId, activity.state);
    }
    nodes.push(...bpmnNodes.values());
    let activeActivities = run.bpmnState?.activeActivities ?? [];
    if (!['pending', 'running', 'waiting'].includes(run.status)) activeActivities = [];
    return {
      runId: run.id,
      workflowId: run.workflowId,
      workflowVersion: run.workflowVersion,
      status: run.status,
      business: run.businessContext,
      input: run.inputValues,
      formValues: run.formValues,
      output: run.outputValues || {},
      error: run.errorMessage,
      activities: activities.map((activity) => ({ executionId: activity.executionId, nodeId: activity.elementId, status: activity.state.status, visit: activity.state.visit, output: activity.state.outputValues, error: activity.state.errorMessage })),
      transitions: run.bpmnState?.transitions ?? [],
      activeActivities,
      nodes: nodes.map((node) => {
        let wakeAt: string | null = null;
        if (node.wakeAt) wakeAt = new Date(node.wakeAt).toISOString();
        return {
          nodeId: node.nodeId,
          status: node.status,
          taskRunId: node.taskRunId,
          businessReceipt: node.businessReceipt,
          visit: node.visit,
          loopIteration: node.loopIteration,
          loopPath: node.loopPath || {},
          scriptAttempts: node.scriptAttempts || [],
          selectedPorts: node.selectedPorts,
          output: node.outputValues,
          wakeAt,
          error: node.errorMessage,
        };
      }),
    };
  }

  /**
   * 按轮次倒序读取单个节点的当前记录与已归档记录，翻页不会重复返回当前轮。
   * @param runId - 所属工作流实例身份。
   * @param nodeId - 固定图中的节点身份。
   * @param beforeVisit - 只读取早于该轮次的记录，省略时包含当前轮。
   * @returns 最多五十条轮次记录及下一页边界。
   * @throws 节点不存在或轮次边界非法时拒绝请求。
   */
  async nodeVisits(
    runId: string,
    nodeId: string,
    beforeVisit?: string,
  ): Promise<WorkflowNodeVisitPage> {
    let before: number | undefined;
    if (beforeVisit !== undefined) {
      before = Number(beforeVisit);
      if (!Number.isSafeInteger(before) || before < 1)
        throw new BadRequestException('历史轮次边界必须是正整数');
    }
    const current = await this.database
      .getRepository(WorkflowNodeRun)
      .findOneBy({ runId, nodeId });
    const records: (WorkflowNodeRun | WorkflowNodeVisit)[] = [];
    if (!current) {
      const query = this.database.getRepository(WorkflowBpmnActivity).createQueryBuilder('activity').where('activity.runId = :runId AND activity.elementId = :nodeId', { runId, nodeId });
      if (before !== undefined) query.andWhere("JSON_EXTRACT(activity.step_state, '$.visit') < :before", { before });
      const activities = await query.orderBy("CAST(JSON_EXTRACT(activity.step_state, '$.visit') AS UNSIGNED)", 'DESC').take(51).getMany();
      if (!activities.length && before === undefined) throw new NotFoundException('流程节点不存在');
      records.push(...activities.map((activity) => activity.state));
    } else {
      if (before === undefined || current.visit < before) records.push(current);
      const archived = await this.database.getRepository(WorkflowNodeVisit).find({
      where: { runId, nodeId, visit: LessThan(before || current.visit) },
      order: { visit: 'DESC' },
      take: 51,
    });
    records.push(...archived);
    }
    let nextBeforeVisit: number | null = null;
    if (records.length > 50) nextBeforeVisit = records[49].visit;
    return {
      items: records.slice(0, 50).map((item) => {
        let startedAt: string | null = null;
        let finishedAt: string | null = null;
        if (item.startedAt) startedAt = new Date(item.startedAt).toISOString();
        if (item.finishedAt)
          finishedAt = new Date(item.finishedAt).toISOString();
        return {
          nodeId: item.nodeId,
          visit: item.visit,
          loopPath: item.loopPath || {},
          status: item.status,
          output: item.outputValues,
          taskRunId: item.taskRunId,
          businessReceipt: item.businessReceipt,
          scriptAttempts: item.scriptAttempts || [],
          error: item.errorMessage,
          startedAt,
          finishedAt,
        };
      }),
      nextBeforeVisit,
    };
  }

  /**
   * 唤醒等待中的流程处理取消意图，不直接把仍有子任务在执行的流程标成终态。
   * @param runId - 待取消的运行身份。
   * @returns 保存取消意图后的运行详情。
   */
  async cancel(runId: string): Promise<WorkflowRunView> {
    await this.database
      .getRepository(WorkflowRun)
      .update(
        { id: runId, status: In(['pending', 'running', 'waiting']) },
        { cancelRequested: true, nextWakeAt: new Date() },
      );
    return this.read(runId);
  }

  /**
   * 读取到期的流程恢复消息，等待节点由数据库时间驱动且不占用工作线程。
   * @returns 本轮有界待恢复运行身份。
   */
  async pendingRunIds(): Promise<string[]> {
    const rows = await this.database.getRepository(WorkflowRun).find({
      where: {
        status: In(['pending', 'running', 'waiting']),
        nextWakeAt: LessThanOrEqual(new Date()),
      },
      order: { nextWakeAt: 'ASC' },
      take: 100,
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /**
   * 仅发现仍归属于活动流程令牌的内置动作，独立任务没有恢复入口。
   * @returns 由工作流队列统一唤醒的有界动作身份。
   */
  async pendingActionIds(): Promise<string[]> {
    if (!this.tasks) return [];
    const activities = await this.database.getRepository(WorkflowBpmnActivity)
      .createQueryBuilder('activity')
      .innerJoin(WorkflowRun, 'run', 'run.id = activity.runId')
      .where('run.status IN (:...statuses)', { statuses: ['pending', 'running', 'waiting'] })
      .andWhere('activity.delivered = false')
      .andWhere("JSON_UNQUOTE(JSON_EXTRACT(activity.job, '$.step.kind')) = 'action'")
      .andWhere("JSON_UNQUOTE(JSON_EXTRACT(activity.step_state, '$.status')) = 'waiting'")
      .orderBy('activity.runId', 'ASC').take(100).getMany();
    return [...new Set(activities.flatMap((activity) => {
      if (activity.state.taskRunId) return [activity.state.taskRunId];
      return [];
    }))];
  }

  /**
   * 在同一工作流队列中执行单个内置动作，持续以父流程与活动令牌判断取消。
   * @param actionRunId - 已绑定到标准活动的动作运行身份。
   * @throws 内置动作模块未装配时拒绝派发。
   */
  async processAction(actionRunId: string): Promise<void> {
    if (!this.tasks) throw new Error('内置动作能力未装配');
    const activity = await this.database.getRepository(WorkflowBpmnActivity).createQueryBuilder('activity')
      .where("JSON_UNQUOTE(JSON_EXTRACT(activity.step_state, '$.taskRunId')) = :actionRunId", { actionRunId }).getOne();
    if (!activity || activity.job.step.kind !== 'action') return;
    await this.tasks.process(actionRunId, async () => {
      const parent = await this.database.getRepository(WorkflowRun).findOneBy({ id: activity.runId });
      const current = await this.database.getRepository(WorkflowBpmnActivity).findOneBy({ runId: activity.runId, executionId: activity.executionId });
      if (!parent || !current || parent.cancelRequested || current.cancelRequested || current.delivered) return false;
      return ['pending', 'running', 'waiting'].includes(parent.status) && !parent.errorMessage;
    });
    await this.database.getRepository(WorkflowRun).update({ id: activity.runId }, { nextWakeAt: new Date() });
  }

  /**
   * 持有流程独占连接后恢复标准活动令牌；旧自定义图只记录退役错误，不再派发动作。
   * @param runId - 待恢复的流程身份。
   * @throws 数据库状态无法确认时交由队列保留失败并等待恢复。
   */
  async process(runId: string): Promise<void> {
    const connection = this.database.createQueryRunner();
    const lock = `kt:workflow:${runId}`;
    let acquired = false;
    try {
      await connection.connect();
      acquired =
        Number(
          (
            await connection.query('SELECT GET_LOCK(?, 0) AS acquired', [lock])
          )[0]?.acquired,
        ) === 1;
      if (!acquired) return;
      const manager = connection.manager;
      const run = await manager.findOneBy(WorkflowRun, { id: runId });
      if (!run || !['pending', 'running', 'waiting'].includes(run.status))
        return;
      const definition = await this.resolve({
        id: run.workflowId,
        version: run.workflowVersion,
      });
      if (isBpmnWorkflow(definition)) {
        if (!this.bpmn) throw new Error('BPMN 工作流执行模块尚未装配');
        await this.bpmn.process(run, definition, manager);
        return;
      }
      await manager.update(WorkflowRun, { id: run.id }, {
        status: 'failed',
        errorMessage: '旧自定义图执行器已退役，请重新建立 BPMN 2.0 流程',
        finishedAt: new Date(),
      });
    } finally {
      try {
        if (acquired) await connection.query('SELECT RELEASE_LOCK(?)', [lock]);
      } finally {
        await connection.release();
      }
    }
  }

}
