import { Injectable, Optional } from '@nestjs/common';
import { merge, Observable, of, Subject, timer } from 'rxjs';
import { map } from 'rxjs/operators';
import type {
  NetworkStateChangeEvent,
  NetworkStateChangeSource,
} from '@/modules/admin/platform-config/network-management/contract/network-management.types';

export interface NetworkManagementEventStreamOptions {
  heartbeatMs?: number;
  replayLimit?: number;
}

export interface NetworkManagementStreamEvent {
  data: NetworkStateChangeEvent | { message: string; observedAt: string };
  id: string;
  type: 'heartbeat' | 'network-state-changed' | 'snapshot-required';
}

@Injectable()
export class NetworkManagementEventStreamService {
  private readonly replay: NetworkManagementStreamEvent[] = [];
  private readonly streamSubject = new Subject<NetworkManagementStreamEvent>();
  private readonly heartbeatMs: number;
  private readonly replayLimit: number;
  private eventSequence = 0;

  constructor(@Optional() options: NetworkManagementEventStreamOptions = {}) {
    this.heartbeatMs =
      options.heartbeatMs ||
      Number(process.env.NETWORK_MANAGEMENT_SSE_HEARTBEAT_MS) ||
      25_000;
    this.replayLimit =
      options.replayLimit ||
      Number(process.env.NETWORK_MANAGEMENT_SSE_REPLAY_LIMIT) ||
      100;
  }

  /**
   * 通过建立包含可重放事件、实时提交事件与定时心跳的服务端事件流。
   * @param lastEventId - 用于精确定位last事件的标识；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 返回合并历史重放、实时事件与定时心跳的只读 Observable。
   */
  stream(lastEventId?: string): Observable<NetworkManagementStreamEvent> {
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
   * 按`source`投递已提交事件。
   * @param source - 决定已提交事件内容、边界或目标的 `source` 值。
   * @returns 已提交事件。
   */
  publishCommitted(
    source: NetworkStateChangeSource,
  ): NetworkManagementStreamEvent {
    const observedAt = new Date().toISOString();
    const eventId = `network-${Date.now()}-${++this.eventSequence}`;
    const event: NetworkManagementStreamEvent = {
      data: { eventId, observedAt, source },
      id: eventId,
      type: 'network-state-changed',
    };
    this.replay.push(event);
    if (this.replay.length > this.replayLimit) {
      this.replay.splice(0, this.replay.length - this.replayLimit);
    }
    this.streamSubject.next(event);
    return event;
  }

  /**
   * 从内存重放缓冲区定位客户端游标；游标缺失时不重放，游标已淘汰时要求客户端重新获取快照。
   * @param lastEventId - 客户端最后确认的网络状态事件标识；为空时不返回历史事件。
   * @returns 游标后的网络状态事件；游标不在缓冲区时仅返回快照刷新事件。
   */
  private getReplayEvents(
    lastEventId?: string,
  ): NetworkManagementStreamEvent[] {
    if (!lastEventId) return [];
    const index = this.replay.findIndex((event) => event.id === lastEventId);
    if (index === -1) return [this.createSnapshotRequiredEvent()];
    return this.replay.slice(index + 1);
  }

  /**
   * 根据当前运行态构造心跳事件。
   * @returns 包含 `data`、`id`、`type` 字段的心跳事件。
   */
  private createHeartbeatEvent(): NetworkManagementStreamEvent {
    return {
      data: { message: 'alive', observedAt: new Date().toISOString() },
      id: this.currentReplayCursor(),
      type: 'heartbeat',
    };
  }

  /**
   * 根据当前运行态构造快照必需的事件。
   * @returns 包含 `data`、`id`、`type` 字段的快照必需的事件。
   */
  private createSnapshotRequiredEvent(): NetworkManagementStreamEvent {
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
   * 从当前数据源读取当前重放游标。
   * @returns 规范化后的当前重放游标；主值为空时采用 `''` 兜底。
   */
  private currentReplayCursor(): string {
    return this.replay.at(-1)?.id || '';
  }
}
