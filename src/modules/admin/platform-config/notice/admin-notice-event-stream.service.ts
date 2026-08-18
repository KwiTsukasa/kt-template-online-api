import { Injectable, Optional } from '@nestjs/common';
import { merge, Observable, of, Subject, timer } from 'rxjs';
import { map } from 'rxjs/operators';

export type AdminNoticeChangeReason =
  | 'created'
  | 'deleted'
  | 'read'
  | 'reopened'
  | 'updated';

export interface AdminNoticeEventStreamOptions {
  heartbeatMs?: number;
  replayLimit?: number;
}

export interface AdminNoticeStreamEvent {
  data:
    | {
        observedAt: string;
        reason: AdminNoticeChangeReason;
      }
    | {
        message: string;
        observedAt: string;
      };
  id: string;
  type: 'heartbeat' | 'notice-changed' | 'snapshot-required';
}

@Injectable()
export class AdminNoticeEventStreamService {
  private readonly replay: AdminNoticeStreamEvent[] = [];
  private readonly streamSubject = new Subject<AdminNoticeStreamEvent>();
  private readonly heartbeatMs: number;
  private readonly replayLimit: number;
  private eventSequence = 0;

  constructor(@Optional() options: AdminNoticeEventStreamOptions = {}) {
    this.heartbeatMs =
      options.heartbeatMs ||
      Number(process.env.ADMIN_NOTICE_SSE_HEARTBEAT_MS) ||
      25_000;
    this.replayLimit =
      options.replayLimit ||
      Number(process.env.ADMIN_NOTICE_SSE_REPLAY_LIMIT) ||
      100;
  }

  /**
   * 根据业务游标选择增量重放或强制快照，并合并提交后变更与不推进游标的心跳。
   * @param lastEventId - 客户端最后处理的站内信变更事件标识；首次连接时可省略。
   * @returns 按游标恢复语义合并后的只读站内信事件 Observable。
   */
  stream(lastEventId?: string): Observable<AdminNoticeStreamEvent> {
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
   * 在站内信事务提交后发布轻量变更信号，由客户端重新获取未读数和当前列表。
   * @param reason - 已完成数据库提交且需要客户端校准快照的领域变更原因。
   * @returns 已写入有限重放缓冲区并同步推送给在线客户端的事件。
   */
  publishCommitted(reason: AdminNoticeChangeReason): AdminNoticeStreamEvent {
    const observedAt = new Date().toISOString();
    const eventId = `notice-${Date.now()}-${++this.eventSequence}`;
    const event: AdminNoticeStreamEvent = {
      data: { observedAt, reason },
      id: eventId,
      type: 'notice-changed',
    };
    this.replay.push(event);
    if (this.replay.length > this.replayLimit) {
      this.replay.splice(0, this.replay.length - this.replayLimit);
    }
    this.streamSubject.next(event);
    return event;
  }

  /**
   * 根据客户端游标返回后续变更；首次连接或游标失效时要求重新获取快照。
   * @param lastEventId - 客户端最后处理的站内信变更事件标识。
   * @returns 游标后的重放事件，或唯一的快照刷新提示。
   */
  private getReplayEvents(lastEventId?: string): AdminNoticeStreamEvent[] {
    if (!lastEventId) return [this.createSnapshotRequiredEvent()];
    const index = this.replay.findIndex((event) => event.id === lastEventId);
    if (index === -1) return [this.createSnapshotRequiredEvent()];
    return this.replay.slice(index + 1);
  }

  /**
   * 构造保持代理和浏览器连接活跃的心跳事件，且不推进业务变更游标。
   * @returns 带当前业务游标和观测时间的心跳事件。
   */
  private createHeartbeatEvent(): AdminNoticeStreamEvent {
    return {
      data: { message: 'alive', observedAt: new Date().toISOString() },
      id: this.currentReplayCursor(),
      type: 'heartbeat',
    };
  }

  /**
   * 构造要求客户端重新读取未读数与消息列表的快照提示。
   * @returns 不进入重放缓冲区的快照刷新事件。
   */
  private createSnapshotRequiredEvent(): AdminNoticeStreamEvent {
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
   * 读取最近一条业务变更的游标；尚无变更时返回固定初始游标。
   * @returns 可安全用于 SSE `id` 字段的当前业务游标。
   */
  private currentReplayCursor(): string {
    return this.replay.at(-1)?.id || 'notice-initial';
  }
}
