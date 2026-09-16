import { BadRequestException, Injectable } from '@nestjs/common';
import type { DataSchema } from '@/common/automation/data-schema';
import { AbstractWorkflowProcess } from '@/modules/workflow-engine/contract/abstract-workflow-process';
import type {
  WorkflowCompletionContext,
  WorkflowLaunchContext,
  WorkflowStepAcceptance,
  WorkflowStepDefinition,
  WorkflowStepInvocation,
  WorkflowStepStop,
  WorkflowHumanStepAcceptance,
} from '@/modules/workflow-engine/contract/workflow-process.interface';
import { MediaGovernanceService } from './media-governance.service';
import { MEDIA_WORKFLOW_REFERENCES } from '../contract/media-workflow.types';

export const MEDIA_WORKFLOW_REFERENCE = MEDIA_WORKFLOW_REFERENCES.governance;

const revisionField = {
  key: 'revision',
  label: '任务修订',
  type: 'integer' as const,
  required: true,
  min: 1,
};
const sourceField = {
  key: 'sourceId',
  label: '来源',
  type: 'string' as const,
  required: false,
  max: 96,
};
const sourceCountField = {
  key: 'sourceCount',
  label: '来源数量',
  type: 'integer' as const,
  required: true,
  min: 0,
  max: 16,
};
export const MEDIA_WORKFLOW_STEP_OUTPUT: DataSchema = {
  fields: [
    { key: 'taskId', label: '治理任务', type: 'string', required: true },
    revisionField,
    {
      key: 'mediaRunId',
      label: '媒体步骤运行',
      type: 'string',
      required: true,
    },
    {
      key: 'evidenceSha256',
      label: '步骤证据摘要',
      type: 'string',
      required: true,
    },
  ],
};

export const MEDIA_WORKFLOW_INPUT_SCHEMA: DataSchema = {
  fields: [
    { key: 'taskId', label: '治理任务', type: 'string', required: true },
    { key: 'workId', label: '所属作品', type: 'string', required: true },
    revisionField, sourceField, sourceCountField,
  ],
};

@Injectable()
export class MediaGovernanceWorkflow extends AbstractWorkflowProcess {
  readonly key: string = MEDIA_WORKFLOW_REFERENCE.key;
  readonly concurrencyGroup = MEDIA_WORKFLOW_REFERENCE.key;
  readonly version = MEDIA_WORKFLOW_REFERENCE.version;
  readonly name: string = '媒体治理';
  readonly launchSchema: DataSchema = { fields: [sourceField] };
  readonly inputSchema = MEDIA_WORKFLOW_INPUT_SCHEMA;
  readonly outputSchema: DataSchema = {
    fields: [
      { key: 'taskId', label: '治理任务', type: 'string', required: true },
      { key: 'workId', label: '所属作品', type: 'string', required: true },
      {
        key: 'mediaRunId',
        label: '业务步骤运行',
        type: 'string',
        required: true,
      },
      {
        key: 'evidenceSha256',
        label: '步骤证据摘要',
        type: 'string',
        required: true,
      },
    ],
  };
  readonly steps = mediaWorkflowSteps(['source.inspect', 'source.probe-runtime', 'source.download', 'governance.execute', 'acceptance.verify', 'source.cleanup', 'governance.rebase']);
  readonly humanSteps = [{
    key: 'source.review', name: '确认来源资料',
    outputSchema: { fields: MEDIA_WORKFLOW_INPUT_SCHEMA.fields.filter((field) => field.key !== 'sourceId') },
  }];

  constructor(protected readonly media: MediaGovernanceService) {
    super();
  }

  /**
   * 在人工确认来源后重新读取已保存的任务事实，为后续检查提供最新修订及来源数量。
   * @param context - 工作流确认的同一任务、人工待办及结果事务。
   * @returns 来源已存在且没有执行占用时的权威业务输入，不接受手填任务或来源身份。
   * @throws 来源未补齐、业务能力不匹配或仍有步骤执行时拒绝结束人工待办。
   */
  async acceptHumanStep(context: WorkflowHumanStepAcceptance): Promise<Record<string, unknown>> {
    if (context.stepKey !== 'source.review') throw new BadRequestException('媒体未实现此人工办理能力');
    const task = await this.media.workflowTask(context.business.scopeId, context.business.subjectId, context.transaction);
    const sourceCount = task.sources.filter((source) => source.descriptorTombstonedAt === null).length;
    if (!sourceCount) throw new BadRequestException('请先补充媒体来源');
    if (task.activeRunId) throw new BadRequestException('媒体步骤仍在执行，不能确认来源资料');
    return { taskId: task.id, workId: task.workId, revision: task.revision, sourceCount };
  }

  /**
   * 从媒体权威对象核对 Work 归属和修订，工作流只能启动既有 Task，不能猜建业务身份。
   * @param context - 业务控制器确认的 Work、Task、操作者和可选来源。
   * @returns 固定业务身份与该修订的输入快照。
   * @throws 业务归属、修订或提交字段不合法时拒绝发起。
   */
  async prepare(context: WorkflowLaunchContext) {
    if (Object.keys(context.values).some((key) => key !== 'sourceId'))
      throw new BadRequestException('媒体流程只接受已声明的来源参数');
    const task = await this.media.workflowTask(context.scopeId, context.subjectId, context.transaction);
    if (task.revision !== context.revision)
      throw new BadRequestException('媒体任务已变更，请刷新后发起流程');
    if (task.activeRunId)
      throw new BadRequestException('媒体任务仍有未结束的步骤');
    const input: Record<string, unknown> = {
      taskId: task.id, workId: task.workId, revision: task.revision,
      sourceCount: task.sources.filter((source) => source.descriptorTombstonedAt === null).length,
    };
    if (context.values.sourceId !== undefined) {
      if (!task.sources.some((source) => source.id === context.values.sourceId && source.descriptorTombstonedAt === null))
        throw new BadRequestException('所选来源不属于当前媒体任务');
      input.sourceId = context.values.sourceId;
    }
    return { identity: { scopeId: context.scopeId, subjectId: task.id, revision: task.revision }, input };
  }

  /**
   * 为固定工作流执行键密封一次媒体步骤，实际脚本由工作流按图中顺序派发。
   * @param invocation - 工作流固定的对象、步骤和输入映射。
   * @returns 可重复读取的媒体运行身份及密封摘要。
   */
  protected prepareStepInput(invocation: WorkflowStepInvocation) {
    return this.media.prepareWorkflowStep(invocation);
  }

  /**
   * 将标准脚本回执与媒体持久证据逐项核对，禁止只凭退出码宣告业务成功。
   * @param acceptance - 工作流保存的密封参数与有序脚本结果。
   * @returns 当前步骤的权威修订和证据摘要。
   */
  protected verifyStep(acceptance: WorkflowStepAcceptance) {
    return this.media.acceptWorkflowStep(acceptance);
  }

  /**
   * 工作流确认所有脚本退出后，幂等释放原媒体步骤占用。
   * @param context - 停止状态、密封身份与尝试账本。
   * @returns 原步骤占用释放完成的异步结果。
   */
  protected releaseStep(context: WorkflowStepStop) {
    return this.media.stopWorkflowStep(context);
  }

  /**
   * 核对同一 Work、Task 的机械验收证据，媒体尚未闭环时拒绝流程成功。
   * @param context - 固定业务身份及流程映射的最终结果。
   * @returns 媒体完成条件核对通过的异步结果。
   */
  protected verifyResult(context: WorkflowCompletionContext) {
    return this.media.completeWorkflow(context);
  }
}

/**
 * 为各媒体业务流程选出明确允许的原子步骤，未声明的动作不能加入该流程。
 * @param keys - 当前业务流程公开的步骤键。
 * @returns 包含输入映射与标准业务结果结构的步骤声明。
 */
export function mediaWorkflowSteps(keys: readonly string[]): readonly WorkflowStepDefinition[] {
  return [
    ['source.inspect', '检查来源清单'],
    ['source.probe-runtime', '检查来源可用性'],
    ['source.download', '下载媒体载荷'],
    ['governance.execute', '治理媒体文件'],
    ['governance.rebase', '重整规范身份目录'],
    ['acceptance.verify', '机械验收'],
    ['source.cleanup', '清理指定来源'],
  ].filter(([key]) => keys.includes(key)).map(([key, name]) => {
    const inputSchema: DataSchema = { fields: [revisionField] };
    if (key === 'source.inspect' || key === 'source.probe-runtime')
      inputSchema.fields.push({
        key: 'sourceIndex',
        label: '来源序号',
        type: 'integer',
        required: false,
        min: 1,
        max: 16,
      });
    if (key === 'source.inspect' || key === 'source.probe-runtime') inputSchema.fields.push(sourceField);
    if (key === 'source.download') inputSchema.fields.push(
      { key: 'autoSelect', label: '自动匹配文件', type: 'boolean', required: false },
      { key: 'subtitleLanguage', label: '字幕语言', type: 'string', required: false, options: [{ label: '简体中文', value: 'zh-CN' }, { label: '繁体中文', value: 'zh-TW' }] },
    );
    if (key === 'source.cleanup')
      inputSchema.fields.push({ ...sourceField, required: true });
    return {
      key,
      name,
      description: name,
      inputSchema,
      outputSchema: MEDIA_WORKFLOW_STEP_OUTPUT,
    };
  });
}
