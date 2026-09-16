import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { WorkflowBusinessPort, WorkflowProcess } from '@/modules/workflow-engine/contract/workflow-process.interface';
import type { WorkflowExecutionPort } from '@/modules/workflow-engine/contract/workflow.types';
import type { MediaWorkflowPort } from '../contract/media-workflow.port';
import { MediaGovernanceService } from './media-governance.service';
import {
  MediaGovernanceWorkflow,
  MEDIA_WORKFLOW_REFERENCE,
} from './media-governance.workflow';

@Injectable()
export class MediaWorkflowService implements MediaWorkflowPort {
  readonly processes: readonly WorkflowProcess[];
  private connection: {
    businesses: WorkflowBusinessPort;
    execution: WorkflowExecutionPort;
  } | null = null;
  constructor(
    readonly process: MediaGovernanceWorkflow,
    private readonly media: MediaGovernanceService,
  ) { this.processes = [process]; }

  /**
   * 由应用装配层一次接入工作流公共端口，媒体模块自身不创建执行器或恢复定时器。
   * @param businesses - 工作流负责的绑定、去重发起和业务运行查询端口。
   * @param execution - 工作流负责的状态读取与取消端口。
   * @returns 只断开此次装配的清理函数。
   * @throws 同一媒体模块被重复装配到不同工作流实例时拒绝覆盖。
   */
  connect(
    businesses: WorkflowBusinessPort,
    execution: WorkflowExecutionPort,
  ): () => void {
    if (this.connection) throw new Error('媒体工作流端口不能重复装配');
    const connection = { businesses, execution };
    this.connection = connection;
    const detachCreation = this.media.connectWorkflowCreation(async (task, actorId, transaction) => {
      if (!task.workId) throw new BadRequestException('媒体任务必须属于已核验作品');
      await businesses.launch(MEDIA_WORKFLOW_REFERENCE, {
        scopeId: task.workId, subjectId: task.id, revision: task.revision,
        actorId, values: {}, transaction,
      }, `create:${task.id}`);
    }, (task, manager) => businesses.assertIdle(MEDIA_WORKFLOW_REFERENCE, task.workId ?? '', task.id, manager));
    return () => {
      detachCreation();
      if (this.connection === connection) this.connection = null;
    };
  }

  /**
   * 以业务对象限定最近运行记录，避免把任意工作流运行标识当作媒体任务身份。
   * @param taskId - 当前媒体 Task。
   * @returns 同一业务对象最近一次工作流运行，没有运行时为空。
   */
  async latest(taskId: string) {
    const task = await this.task(taskId);
    return this.ports().businesses.latest(
      MEDIA_WORKFLOW_REFERENCE,
      task.workId!,
      task.id,
    );
  }

  /**
   * 只读取当前媒体对象已经进入的流程待办，不允许选择其他实例。
   * @param taskId - 业务权限允许查看的任务。
   * @returns 原流程实例的人工节点列表。
   */
  async humanTasks(taskId: string) {
    const run = await this.latest(taskId);
    if (!run) return [];
    return this.ports().execution.humanTasks(run.runId);
  }

  /**
   * 校验任务与实例归属后提交当前人工节点，由工作流继续原链路。
   * @param taskId - 当前媒体任务。
   * @param runId - 用户查看时的流程实例。
   * @param executionId - 待办活动实例身份。
   * @param actorId - 认证守卫提供的办理人。
   * @param values - 节点表单填写值或确认值。
   * @returns 原实例保存人工结果后的状态。
   * @throws 所属实例已变化时拒绝提交。
   */
  async completeHumanTask(taskId: string, runId: string, executionId: string, actorId: string, values: unknown) {
    const run = await this.latest(taskId);
    if (!run || run.runId !== runId) throw new ConflictException('媒体工作流实例已变更');
    return this.ports().execution.completeHumanTask(runId, executionId, actorId, values);
  }

  /**
   * 校验当前业务运行后向工作流提交取消意图，媒体模块不直接终止脚本或清除占用。
   * @param taskId - 已授权取消流程的媒体 Task。
   * @param runId - 页面当前显示的工作流运行身份。
   * @returns 工作流确认的最新状态，实际终态需等待脚本退出和业务收尾。
   * @throws 页面运行身份已经过期或指向其他任务时拒绝取消。
   */
  async cancel(taskId: string, runId: string) {
    const run = await this.latest(taskId);
    if (!run || run.runId !== runId)
      throw new ConflictException('媒体工作流运行身份已变更');
    return this.ports().execution.cancel(runId);
  }

  /**
   * 从既有媒体索引定位 Work 后重读数据库，缺少归属的历史 Task 不自动补造作品。
   * @param taskId - 页面或订阅业务已确定的 Task。
   * @returns 经持久身份核对的媒体对象。
   */
  private async task(taskId: string) {
    const task = this.media.detail(taskId);
    return this.media.workflowTask(task.workId ?? '', task.id);
  }

  /**
   * 只有应用已经装配工作流公共端口时开放业务发起，绝不回退到媒体独立执行器。
   * @returns 当前唯一工作流端口连接。
   * @throws 工作流尚未装配时返回服务不可用。
   */
  private ports() {
    if (!this.connection)
      throw new ServiceUnavailableException('媒体工作流尚未装配');
    return this.connection;
  }
}
