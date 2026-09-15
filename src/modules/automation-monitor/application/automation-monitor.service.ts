import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Observable } from 'rxjs';
import {
  normalizeRunFeedQuery,
  type RunFeedPort,
  type RunKind,
} from '@/common/automation/run-feed';
import { TASK_RUN_FEED } from '@/modules/task-execution/contract/task-run-feed.port';
import { WORKFLOW_RUN_FEED } from '@/modules/workflow-engine/contract/workflow-run-feed.port';
import { SCHEDULE_RUN_FEED } from '@/modules/task-scheduling/contract/schedule-run-feed.port';

@Injectable()
export class AutomationMonitorService {
  constructor(
    @Inject(TASK_RUN_FEED) private readonly tasks: RunFeedPort,
    @Inject(WORKFLOW_RUN_FEED) private readonly workflows: RunFeedPort,
    @Inject(SCHEDULE_RUN_FEED) private readonly schedules: RunFeedPort,
  ) {}

  /**
   * 按有界查询推送完整快照；每次重连重取领域摘要，游标只用于标识快照且不承诺事件重放。
   * @param input - 与列表相同的类型、阶段和分页条件。
   * @returns 含内容游标、变化快照及保活心跳的只读事件流，退订后停止查询。
   */
  stream(input: Record<string, unknown>): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      let cursor = '';
      let stopped = false;
      let heartbeatAt = Date.now();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const poll = async () => {
        try {
          const page = await this.page(input);
          if (stopped) return;
          const next = createHash('sha256').update(JSON.stringify(page)).digest('hex');
          if (next !== cursor) {
            cursor = next;
            subscriber.next({ type: 'execution-snapshot', id: cursor, data: page });
            heartbeatAt = Date.now();
          } else if (Date.now() - heartbeatAt >= 25_000) {
            subscriber.next({ type: 'heartbeat', data: { observedAt: new Date().toISOString() } });
            heartbeatAt = Date.now();
          }
          if (!stopped) timeout = setTimeout(() => void poll(), 2_000);
        } catch (error) {
          if (!stopped) subscriber.error(error);
        }
      };
      void poll();
      return () => {
        stopped = true;
        if (timeout) clearTimeout(timeout);
      };
    });
  }

  /**
   * 聚合领域公开的只读摘要；任何来源失败时明确报错，不伪造完整空结果。
   * @param input - 页面指定的运行类型、阶段和历史游标。
   * @returns 无业务输入输出的统一运行页和继续读取游标。
   * @throws 类型不受支持时返回 HTTP 400。
   */
  async page(input: Record<string, unknown>) {
    const query = normalizeRunFeedQuery(input);
    const sources: Record<RunKind, RunFeedPort> = {
      task: this.tasks,
      workflow: this.workflows,
      schedule: this.schedules,
    };
    let kinds: RunKind[] = ['task', 'workflow', 'schedule'];
    if (input.kind !== undefined) {
      if (!kinds.includes(input.kind as RunKind))
        throw new BadRequestException('运行类型无效');
      kinds = [input.kind as RunKind];
    }
    const records = (
      await Promise.all(kinds.map((kind) => sources[kind].page(query)))
    ).flat();
    records.sort((left, right) => {
      if (BigInt(left.runId) > BigInt(right.runId)) return -1;
      if (BigInt(left.runId) < BigInt(right.runId)) return 1;
      return 0;
    });
    const items = records.slice(0, query.limit);
    let nextCursor: string | null = null;
    if (items.length === query.limit)
      nextCursor = items[items.length - 1].runId;
    return { items, nextCursor };
  }
}
