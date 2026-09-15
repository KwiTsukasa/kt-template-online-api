import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  normalizeRunFeedQuery,
  projectRunPhase,
  runPhaseStatuses,
  type RunFeedPort,
  type RunFeedQuery,
  type RunSummary,
} from '@/common/automation/run-feed';
import { WorkflowRun } from '../infrastructure/persistence/workflow-run.entities';
import { WorkflowRevision } from '../infrastructure/persistence/workflow.entities';

@Injectable()
export class WorkflowRunFeedService implements RunFeedPort {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * 从工作流自有运行表和固定版本读取摘要，不向监控模块暴露实体或输入输出。
   * @param query - 有界历史游标和运行阶段筛选。
   * @returns 按完整大整数身份倒序排列的运行摘要。
   */
  async page(query: RunFeedQuery): Promise<RunSummary[]> {
    const input = normalizeRunFeedQuery(query);
    const builder = this.dataSource
      .getRepository(WorkflowRun)
      .createQueryBuilder('run')
      .select(['run.id', 'run.workflowId', 'run.workflowVersion', 'run.status', 'run.createTime', 'run.finishedAt', 'run.errorMessage'])
      .leftJoin(
        WorkflowRevision,
        'revision',
        'revision.definitionId = run.workflowId AND revision.version = run.workflowVersion',
      )
      .addSelect('revision.name', 'definitionName')
      .orderBy('run.id', 'DESC')
      .take(input.limit);
    if (input.beforeId)
      builder.andWhere('run.id < :beforeId', { beforeId: input.beforeId });
    const statuses = runPhaseStatuses(input.phase);
    if (statuses.length)
      builder.andWhere('run.status IN (:...statuses)', { statuses });
    const { entities, raw } = await builder.getRawAndEntities();
    return entities.map((run, index) => ({
      kind: 'workflow',
      runId: run.id,
      resourceId: run.workflowId,
      resourceVersion: run.workflowVersion,
      name: String(raw[index]?.definitionName || '工作流'),
      phase: projectRunPhase(run.status),
      status: run.status,
      createdAt: run.createTime,
      finishedAt: run.finishedAt,
      requiresReview: false,
      hasError: Boolean(run.errorMessage),
    }));
  }
}
