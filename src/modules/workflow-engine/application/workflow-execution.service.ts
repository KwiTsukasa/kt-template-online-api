import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager, In, LessThanOrEqual } from 'typeorm';
import { createSnowflakeId } from '@/common/snowflake/snowflake-id';
import { validateDataValues } from '@/common/automation/data-schema';
import { validateDefinitionInput } from '@/common/automation/definition.repository';
import type { PublishedReference } from '@/common/automation/definition.types';
import {
  FORM_DEFINITIONS,
  type FormDefinitionPort,
} from '@/modules/form-definition/contract/form.types';
import {
  RULE_ENGINE,
  type RuleEnginePort,
} from '@/modules/rule-engine/contract/rule.types';
import {
  TASK_EXECUTION,
  type TaskExecutionPort,
} from '@/modules/task-execution/contract/task-execution.port';
import type {
  WorkflowDefinition,
  WorkflowExecutionPort,
  WorkflowNode,
} from '../contract/workflow.types';
import type { WorkflowRunView } from '../contract/workflow-run.types';
import {
  bindWorkflowValues,
  nodeReadiness,
  type NodeProgress,
} from '../domain/workflow-execution.policy';
import { validateWorkflowGraph } from '../domain/workflow.policy';
import {
  WorkflowNodeRun,
  WorkflowRun,
} from '../infrastructure/persistence/workflow-run.entities';
import { WorkflowDefinitionService } from './workflow-definition.service';

@Injectable()
export class WorkflowExecutionService implements WorkflowExecutionPort {
  constructor(
    private readonly database: DataSource,
    private readonly definitions: WorkflowDefinitionService,
    @Inject(RULE_ENGINE) private readonly rules: RuleEnginePort,
    @Inject(FORM_DEFINITIONS) private readonly forms: FormDefinitionPort,
    @Optional()
    @Inject(TASK_EXECUTION)
    private readonly tasks?: TaskExecutionPort,
  ) {}

  /**
   * 从工作流拥有的不可变版本恢复执行图，运行实例不读取草稿。
   * @param reference - 固定工作流版本。
   * @returns 保存的执行图与独立布局。
   */
  resolve(reference: PublishedReference): Promise<WorkflowDefinition> {
    return this.definitions.resolve(reference);
  }

  /**
   * 通过表单公开端口解析流程绑定的固定版本，使发起和历史查看不依赖表单管理菜单权限。
   * @param reference - 已授权访问的流程固定版本。
   * @returns 执行图和该版本的表单结构，无表单流程返回空表单。
   */
  async presentation(reference: PublishedReference) {
    const definition = await this.resolve(reference);
    let form = null;
    if (definition.graph.formRef)
      form = await this.forms.resolve(definition.graph.formRef);
    return { definition, form };
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
   * 从发起页使用固定表单版本校验数据，再按流程保存的映射生成输入。
   * @param reference - 选择的流程发布版本。
   * @param values - 表单字段或无表单流程的输入。
   * @param executionKey - 页面本次提交的稳定请求键。
   * @returns 持久流程运行身份。
   */
  async startFromPage(
    reference: PublishedReference,
    values: Record<string, unknown>,
    executionKey: string,
  ) {
    const definition = await this.resolve(reference);
    if (!definition.graph.formRef)
      return this.start(reference, values, executionKey);
    const formValues = await this.forms.validate(
      definition.graph.formRef,
      values,
    );
    const input: Record<string, unknown> = {};
    for (const [target, field] of Object.entries(
      definition.graph.formMapping,
    )) {
      if (Object.hasOwn(formValues, field)) input[target] = formValues[field];
    }
    return this.create(reference, input, executionKey, formValues);
  }

  /**
   * 在单一事务中记录运行和所有节点，重复请求返回原身份且不重置等待时间。
   * @param reference - 固定流程版本。
   * @param input - 映射后的流程输入。
   * @param executionKey - 幂等执行请求键。
   * @param formValues - 由流程实例保存的原表单值，无表单发起时为空。
   * @returns 稳定运行身份。
   * @throws 请求键对应不同输入或发布依赖失效时拒绝创建。
   */
  private async create(
    reference: PublishedReference,
    input: Record<string, unknown>,
    executionKey: string,
    formValues: Record<string, unknown> | null,
  ) {
    const definition = await this.resolve(reference);
    if (
      typeof executionKey !== 'string' ||
      !executionKey.trim() ||
      executionKey.length > 191
    )
      throw new BadRequestException('必须提供 1 至 191 字符的执行请求键');
    const inputValues = validateDefinitionInput(() =>
      validateDataValues(definition.graph.inputSchema, input),
    );
    const key = createHash('sha256').update(executionKey).digest('hex');
    let formEntries: Array<[string, unknown]> | null = null;
    if (formValues)
      formEntries = Object.entries(formValues).sort(([left], [right]) =>
        left.localeCompare(right),
      );
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify([
          reference.id,
          reference.version,
          Object.entries(inputValues).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
          formEntries,
        ]),
      )
      .digest('hex');
    const repository = this.database.getRepository(WorkflowRun);
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
      status: 'pending',
      inputValues,
      formValues,
      outputValues: null,
      cancelRequested: false,
      errorMessage: null,
      deadlineAt: new Date(Date.now() + definition.graph.timeoutMs),
      nextWakeAt: new Date(),
      finishedAt: null,
    });
    try {
      await this.database.transaction(async (manager) => {
        await manager.insert(WorkflowRun, run);
        await manager.insert(
          WorkflowNodeRun,
          definition.graph.nodes.map((node) => ({
            runId: run.id,
            nodeId: node.id,
            status: 'pending',
            taskRunId: null,
            selectedPorts: [],
            outputValues: {},
            errorMessage: null,
            wakeAt: null,
            startedAt: null,
            finishedAt: null,
          })),
        );
      });
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
    return {
      runId: run.id,
      workflowId: run.workflowId,
      workflowVersion: run.workflowVersion,
      status: run.status,
      input: run.inputValues,
      formValues: run.formValues,
      output: run.outputValues || {},
      error: run.errorMessage,
      nodes: nodes.map((node) => {
        let wakeAt: string | null = null;
        if (node.wakeAt) wakeAt = new Date(node.wakeAt).toISOString();
        return {
          nodeId: node.nodeId,
          status: node.status,
          taskRunId: node.taskRunId,
          selectedPorts: node.selectedPorts,
          output: node.outputValues,
          wakeAt,
          error: node.errorMessage,
        };
      }),
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
    const rows = await this.database
      .getRepository(WorkflowRun)
      .find({
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
   * 持有流程独占连接后按拓扑推进节点；控制状态写入使用同一连接，连接失效即停止推进。
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
      const states = await manager.findBy(WorkflowNodeRun, { runId });
      if (
        !run.errorMessage &&
        states.some((state) => state.status === 'failed')
      ) {
        run.errorMessage = '流程存在失败节点，停止后续派发';
        await manager.update(
          WorkflowRun,
          { id: run.id },
          { errorMessage: run.errorMessage },
        );
      }
      if (await this.stopIfRequested(run, states, manager)) return;
      const graph = definition.graph;
      const topology = validateWorkflowGraph(graph);
      if (!topology.valid) {
        run.errorMessage = '已发布流程拓扑无法执行';
        await manager.update(
          WorkflowRun,
          { id: run.id },
          { errorMessage: run.errorMessage },
        );
        await this.stopIfRequested(run, states, manager);
        return;
      }
      await manager.update(WorkflowRun, { id: run.id }, { status: 'running' });
      const byId = new Map(states.map((state) => [state.nodeId, state]));
      for (const nodeId of topology.order) {
        const node = graph.nodes.find((candidate) => candidate.id === nodeId)!;
        const state = byId.get(nodeId)!;
        if (!['pending', 'waiting'].includes(state.status)) continue;
        const current = await manager.findOneByOrFail(WorkflowRun, {
          id: run.id,
        });
        run.cancelRequested = current.cancelRequested;
        run.errorMessage = current.errorMessage;
        if (await this.stopIfRequested(run, states, manager)) return;
        const progress = this.progress(states);
        const readiness = nodeReadiness(
          graph.edges.filter((edge) => edge.target === node.id),
          progress,
        );
        if (readiness === 'wait') continue;
        if (readiness === 'skip') {
          state.status = 'skipped';
          state.finishedAt = new Date();
          await manager.save(WorkflowNodeRun, state);
          continue;
        }
        try {
          await this.advanceNode(node, state, run, progress);
        } catch {
          state.status = 'failed';
          state.errorMessage =
            '节点执行或参数映射失败，请检查固定版本与上游结果';
          state.finishedAt = new Date();
        }
        await manager.save(WorkflowNodeRun, state);
        if (state.status === 'failed') {
          run.errorMessage = `节点 ${node.name} 执行失败`;
          await manager.update(
            WorkflowRun,
            { id: run.id },
            { errorMessage: run.errorMessage },
          );
          await this.stopIfRequested(run, states, manager);
          return;
        }
      }
      run.cancelRequested = (
        await manager.findOneByOrFail(WorkflowRun, { id: run.id })
      ).cancelRequested;
      if (await this.stopIfRequested(run, states, manager)) return;
      if (
        states.every((state) => ['succeeded', 'skipped'].includes(state.status))
      ) {
        const end = graph.nodes.find((node) => node.type === 'end')!;
        if (byId.get(end.id)?.status !== 'succeeded') {
          run.errorMessage = '没有激活的路径到达结束节点';
        } else {
          try {
            const output = validateDataValues(
              graph.outputSchema,
              bindWorkflowValues(
                graph.output,
                run.inputValues,
                this.progress(states),
              ),
            );
            const completed = await manager.update(
              WorkflowRun,
              { id: run.id, cancelRequested: false },
              {
                status: 'succeeded',
                outputValues: output,
                finishedAt: new Date(),
              },
            );
            if (completed.affected !== 1) {
              run.cancelRequested = true;
              await this.stopIfRequested(run, states, manager);
            }
            return;
          } catch {
            run.errorMessage = '流程输出映射或契约校验失败';
          }
        }
        await manager.update(
          WorkflowRun,
          { id: run.id },
          { errorMessage: run.errorMessage },
        );
        await this.stopIfRequested(run, states, manager);
        return;
      }
      let nextWakeAt = new Date(run.deadlineAt).getTime();
      for (const state of states) {
        if (state.status !== 'waiting') continue;
        if (state.wakeAt)
          nextWakeAt = Math.min(nextWakeAt, new Date(state.wakeAt).getTime());
        if (state.taskRunId)
          nextWakeAt = Math.min(nextWakeAt, Date.now() + 1000);
      }
      if (!states.some((state) => state.status === 'waiting')) {
        run.errorMessage = '流程存在无法推进的待执行节点';
        await manager.update(
          WorkflowRun,
          { id: run.id },
          { errorMessage: run.errorMessage },
        );
        await this.stopIfRequested(run, states, manager);
        return;
      }
      await manager.update(
        WorkflowRun,
        { id: run.id },
        { status: 'waiting', nextWakeAt: new Date(nextWakeAt) },
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
   * 实施一个已激活节点的职责；原子动作委托公开端口，等待仅保存唤醒时间。
   * @param node - 固定版本中的节点定义。
   * @param state - 本次节点持久状态。
   * @param run - 流程身份、输入和总期限。
   * @param progress - 成功上游节点的状态映射。
   * @throws 处理端口不可用或规则结果没有对应分支时拒绝推进。
   */
  private async advanceNode(
    node: WorkflowNode,
    state: WorkflowNodeRun,
    run: WorkflowRun,
    progress: Map<string, NodeProgress>,
  ): Promise<void> {
    if (!state.startedAt) state.startedAt = new Date();
    if (node.type === 'task') {
      if (!this.tasks) throw new Error('任务执行端口未加载');
      if (!state.taskRunId) {
        const child = await this.tasks.start({
          taskRef: node.taskRef,
          executionKey: `workflow-${run.id}-${node.id}`,
          parentRunId: run.id,
          nodeId: node.id,
          input: bindWorkflowValues(node.input, run.inputValues, progress),
          deadlineAt: new Date(run.deadlineAt).getTime(),
        });
        state.taskRunId = child.runId;
      }
      const child = await this.tasks.read(state.taskRunId);
      if (['pending', 'running'].includes(child.status)) {
        state.status = 'waiting';
        return;
      }
      if (child.status !== 'succeeded') {
        state.status = 'failed';
        state.errorMessage = child.error || '原子任务已取消';
        state.finishedAt = new Date();
        return;
      }
      state.outputValues = child.output;
    } else if (node.type === 'wait') {
      if (!state.wakeAt) state.wakeAt = new Date(Date.now() + node.durationMs);
      if (new Date(state.wakeAt).getTime() > Date.now()) {
        state.status = 'waiting';
        return;
      }
    } else if (node.type === 'rule') {
      const result = await this.rules.evaluate(
        node.ruleRef,
        bindWorkflowValues(node.facts, run.inputValues, progress),
      );
      const branch = node.branches.find(
        (candidate) => candidate.value === result.result,
      );
      if (!branch) throw new Error('规则结果未映射到分支');
      state.selectedPorts = [branch.port];
    }
    if (node.type !== 'rule' && node.type !== 'end')
      state.selectedPorts = ['out'];
    state.status = 'succeeded';
    state.finishedAt = new Date();
  }

  /**
   * 取消、失败或到期时先停止所有子任务，处理器退出后才提交流程终态。
   * @param run - 当前流程意图和期限。
   * @param states - 当前节点状态，已成功节点的历史保持不变。
   * @param manager - 持有流程锁的数据库连接。
   * @returns 已进入终止处理时为真。
   */
  private async stopIfRequested(
    run: WorkflowRun,
    states: WorkflowNodeRun[],
    manager: EntityManager,
  ): Promise<boolean> {
    const expired = Date.now() >= new Date(run.deadlineAt).getTime();
    if (!run.cancelRequested && !run.errorMessage && !expired) return false;
    if (expired && !run.errorMessage) run.errorMessage = '流程总期限已结束';
    if (this.tasks && (await this.tasks.cancelParent(run.id)).active) {
      await manager.update(
        WorkflowRun,
        { id: run.id },
        {
          status: 'waiting',
          errorMessage: run.errorMessage,
          nextWakeAt: new Date(Date.now() + 500),
        },
      );
      return true;
    }
    for (const state of states) {
      if (!['pending', 'waiting'].includes(state.status)) continue;
      state.status = 'cancelled';
      state.finishedAt = new Date();
      await manager.save(WorkflowNodeRun, state);
    }
    let status: WorkflowRun['status'] = 'failed';
    if (run.cancelRequested && !run.errorMessage) status = 'cancelled';
    await manager.update(
      WorkflowRun,
      { id: run.id },
      { status, errorMessage: run.errorMessage, finishedAt: new Date() },
    );
    return true;
  }

  /**
   * 把持久节点状态投影为纯领域决策需要的数据，不暴露实体到其他模块。
   * @param states - 当前流程拥有的节点记录。
   * @returns 按节点身份索引的进度与输出。
   */
  private progress(states: WorkflowNodeRun[]): Map<string, NodeProgress> {
    return new Map(
      states.map((state) => [
        state.nodeId,
        {
          status: state.status,
          selectedPorts: state.selectedPorts,
          output: state.outputValues,
        },
      ]),
    );
  }
}
