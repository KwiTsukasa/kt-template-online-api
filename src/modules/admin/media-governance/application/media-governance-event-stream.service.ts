import { Injectable, Optional } from '@nestjs/common';
import { merge, Observable, of, Subject, timer } from 'rxjs';
import { map } from 'rxjs/operators';
import type { MediaCodexAgentConversationEvent } from '@/apps/media-codex-agent-gateway/domain/media-codex-agent.contract';
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
    | MediaCodexAgentConversationEvent
    | MediaGovernanceTaskChangedData
    | { message: string; observedAt: string };
  id: string;
  type:
    | 'agent-conversation-changed'
    | 'heartbeat'
    | 'snapshot-required'
    | 'task-changed';
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

  /** 合并断线重放、实时任务事件与定时心跳，形成单一事件流。 */
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

  /** 发布任务变更事件，并优先使用运行序号生成可续接事件标识。 */
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

  /** 发布经隔离复制的 Agent 对话事件。 */
  publishAgentConversation(
    input: MediaCodexAgentConversationEvent,
  ): MediaGovernanceStreamEvent {
    const event: MediaGovernanceStreamEvent = {
      data: structuredClone(input),
      id: `media-${Date.now()}-${++this.eventSequence}`,
      type: 'agent-conversation-changed',
    };
    this.append(event);
    return event;
  }

  /** 将事件加入有界重放缓存，并广播给当前订阅者。 */
  private append(event: MediaGovernanceStreamEvent) {
    this.replay.push(event);
    if (this.replay.length > this.replayLimit) {
      this.replay.splice(0, this.replay.length - this.replayLimit);
    }
    this.streamSubject.next(event);
  }

  /** 根据客户端游标返回增量事件，游标失效时要求重新拉取快照。 */
  private getReplayEvents(lastEventId?: string): MediaGovernanceStreamEvent[] {
    if (!lastEventId) return [];
    const index = this.replay.findIndex((event) => event.id === lastEventId);
    if (index === -1) return [this.createSnapshotRequiredEvent()];
    return this.replay.slice(index + 1);
  }

  /** 创建携带当前重放游标的心跳事件。 */
  private createHeartbeatEvent(): MediaGovernanceStreamEvent {
    return {
      data: { message: 'alive', observedAt: new Date().toISOString() },
      id: this.currentReplayCursor(),
      type: 'heartbeat',
    };
  }

  /** 创建提示客户端重新拉取完整快照的事件。 */
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

  /** 返回最近事件标识，空缓存时返回空游标。 */
  private currentReplayCursor(): string {
    return this.replay.at(-1)?.id ?? '';
  }
}
