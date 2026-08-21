import { Injectable, Optional } from '@nestjs/common';
import { merge, Observable, of, Subject, timer } from 'rxjs';
import { map } from 'rxjs/operators';
import type { MediaGovernanceTask } from './media-governance.service';

export interface MediaGovernanceEventStreamOptions {
  heartbeatMs?: number;
  replayLimit?: number;
}

export interface MediaGovernanceTaskChangedData {
  changeType: 'created' | 'deleted' | 'source-updated' | 'state-updated';
  observedAt: string;
  patchMode: 'full' | 'progress';
  revision: number;
  runId: null | string;
  runSequence: null | number;
  summary: {
    agentPending: number;
    attentionRequired: number;
    blocked: number;
    closed: number;
    downloading: number;
    evidenceDriftCount: number;
    governing: number;
    healthLabel: string;
    metadataAutoClosureRate: number;
    mixedSubtitleSeasonCount: number;
    stagingResidualCount: null | number;
    stuckRunCount: number;
    total: number;
  };
  task:
    | null
    | (Pick<MediaGovernanceTask, 'id' | 'revision'> &
        Partial<Omit<MediaGovernanceTask, 'payloadSeal' | 'sealedPlan'>>);
  taskId: string;
  updatedAt: string;
}

export interface MediaGovernanceStreamEvent {
  data:
    | MediaGovernanceTaskChangedData
    | { message: string; observedAt: string };
  id: string;
  type: 'heartbeat' | 'snapshot-required' | 'task-changed';
}

@Injectable()
export class MediaGovernanceEventStreamService {
  private readonly replay: MediaGovernanceStreamEvent[] = [];
  private readonly streamSubject = new Subject<MediaGovernanceStreamEvent>();
  private readonly heartbeatMs: number;
  private readonly replayLimit: number;
  private eventSequence = 0;

  constructor(@Optional() options: MediaGovernanceEventStreamOptions = {}) {
    this.heartbeatMs = options.heartbeatMs ?? 25_000;
    this.replayLimit = options.replayLimit ?? 100;
  }

  /**
   * 合并断线重放、实时任务事件与定时心跳，形成单一事件流。
   * @param lastEventId - 用于精确定位last事件的标识；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 返回合并历史重放、实时事件与定时心跳的只读 Observable。
   */
  stream(lastEventId?: string): Observable<MediaGovernanceStreamEvent> {
    const replayEvents = this.getReplayEvents(lastEventId);
    const heartbeat$ = timer(this.heartbeatMs, this.heartbeatMs).pipe(
      map(() => this.createHeartbeatEvent()),
    );
    return merge(
      ...replayEvents.map((event) => of(event)),
      this.streamSubject,
      heartbeat$,
    );
  }

  /**
   * 发布任务变更事件，并优先使用运行序号生成可续接事件标识。
   * @param input - 用于任务Changed的结构化输入，包含 `runId`、`runSequence` 字段。
   * @returns 任务Changed。
   */
  publishTaskChanged(
    input: Omit<MediaGovernanceTaskChangedData, 'observedAt'>,
  ): MediaGovernanceStreamEvent {
    const observedAt = new Date().toISOString();
    let eventId = `media-${Date.now()}-${++this.eventSequence}`;
    if (input.runId && input.runSequence !== null) {
      eventId = `${input.runId}:${input.runSequence}`;
    }
    const event: MediaGovernanceStreamEvent = {
      data: { ...input, observedAt },
      id: eventId,
      type: 'task-changed',
    };
    this.append(event);
    return event;
  }

  /**
   * 将事件加入有界重放缓存，并广播给当前订阅者。
   * @param event - 触发`append` 对应结果的领域事件。
   */
  private append(event: MediaGovernanceStreamEvent) {
    this.replay.push(event);
    if (this.replay.length > this.replayLimit) {
      this.replay.splice(0, this.replay.length - this.replayLimit);
    }
    this.streamSubject.next(event);
  }

  /**
   * 根据客户端游标返回增量事件，游标失效时要求重新拉取快照。
   * @param lastEventId - 用于精确定位last事件的标识；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 按输入顺序得到的根据客户端游标返回增量事件，游标失效时要求重新拉取快照列表；没有匹配项时为空数组。
   */
  private getReplayEvents(lastEventId?: string): MediaGovernanceStreamEvent[] {
    if (!lastEventId) return [];
    const index = this.replay.findIndex((event) => event.id === lastEventId);
    if (index === -1) return [this.createSnapshotRequiredEvent()];
    return this.replay.slice(index + 1);
  }

  /**
   * 根据当前运行态构造携带当前重放游标的心跳事件。
   * @returns 包含 `data`、`id`、`type` 字段的携带当前重放游标的心跳事件。
   */
  private createHeartbeatEvent(): MediaGovernanceStreamEvent {
    return {
      data: { message: 'alive', observedAt: new Date().toISOString() },
      id: this.currentReplayCursor(),
      type: 'heartbeat',
    };
  }

  /**
   * 根据当前运行态构造提示客户端重新拉取完整快照的事件。
   * @returns 包含 `data`、`id`、`type` 字段的提示客户端重新拉取完整快照的事件。
   */
  private createSnapshotRequiredEvent(): MediaGovernanceStreamEvent {
    return {
      data: {
        message: 'snapshot-required',
        observedAt: new Date().toISOString(),
      },
      id: this.currentReplayCursor(),
      type: 'snapshot-required',
    };
  }

  /**
   * 返回最近事件标识，空缓存时返回空游标。
   * @returns 返回 `this.replay.at(-1)?.id` 的可用值；为空时回退到 `''`；可选链未命中时为 `undefined`。
   */
  private currentReplayCursor(): string {
    return this.replay.at(-1)?.id ?? '';
  }
}
