import { Injectable, Optional } from '@nestjs/common';
import { Observable, Subject, merge, of, timer } from 'rxjs';
import { map } from 'rxjs/operators';
import { EnvironmentEventMaterializer } from './environment-event.materializer';
import { EnvironmentEventBusService } from '../infrastructure/event/environment-event-bus.service';
import type {
  EnvironmentEvent,
  EnvironmentStreamEvent,
} from '../domain/environment-dashboard.types';

export interface EnvironmentEventStreamOptions {
  heartbeatMs?: number;
  replayLimit?: number;
}

@Injectable()
export class EnvironmentEventStreamService {
  private readonly replay: EnvironmentStreamEvent[] = [];
  private readonly streamSubject = new Subject<EnvironmentStreamEvent>();
  private readonly heartbeatMs: number;
  private readonly replayLimit: number;

  constructor(
    private readonly eventBus: EnvironmentEventBusService,
    private readonly materializer: EnvironmentEventMaterializer,
    @Optional()
    options: EnvironmentEventStreamOptions = {},
  ) {
    this.heartbeatMs =
      options.heartbeatMs ||
      Number(process.env.ENV_DASHBOARD_SSE_HEARTBEAT_MS) ||
      25_000;
    this.replayLimit =
      options.replayLimit ||
      Number(process.env.ENV_DASHBOARD_SSE_REPLAY_LIMIT) ||
      200;
    this.eventBus.subscribe((event) => {
      this.pushEvent(this.materializer.materialize(event));
    });
  }

  /**
   * 通过建立包含可重放事件、实时提交事件与定时心跳的服务端事件流。
   * @param lastEventId - 用于精确定位last事件的标识；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 返回合并历史重放、实时事件与定时心跳的只读 Observable。
   */
  stream(lastEventId?: string): Observable<EnvironmentStreamEvent> {
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
   * 将`event`中的非空事件截断到安全上限后追加到目标集合。
   * @param event - 触发事件的领域事件，包含 `eventId`、`type` 字段。
   */
  private pushEvent(event: EnvironmentEvent) {
    const streamEvent: EnvironmentStreamEvent = {
      data: event,
      id: event.eventId,
      type: event.type || 'environment-event',
    };
    this.replay.push(streamEvent);
    if (this.replay.length > this.replayLimit) {
      this.replay.splice(0, this.replay.length - this.replayLimit);
    }
    this.streamSubject.next(streamEvent);
  }

  /**
   * 从内存重放缓冲区定位客户端游标；游标缺失时不重放，游标已淘汰时要求客户端重新获取快照。
   * @param lastEventId - 客户端最后确认的环境事件标识；为空时不返回历史事件。
   * @returns 游标后的环境事件；游标不在缓冲区时仅返回快照刷新事件。
   */
  private getReplayEvents(lastEventId?: string): EnvironmentStreamEvent[] {
    if (!lastEventId) return [];
    const index = this.replay.findIndex((event) => event.id === lastEventId);
    if (index === -1) return [this.createSnapshotRequiredEvent()];
    return this.replay.slice(index + 1);
  }

  /**
   * 根据当前运行态构造心跳事件。
   * @returns 包含 `data`、`id`、`type` 字段的心跳事件。
   */
  private createHeartbeatEvent(): EnvironmentStreamEvent {
    const observedAt = new Date().toISOString();
    return {
      data: { message: 'alive', observedAt },
      id: `heartbeat-${Date.now()}`,
      type: 'heartbeat',
    };
  }

  /**
   * 根据当前运行态构造快照必需的事件。
   * @returns 包含 `data`、`id`、`type` 字段的快照必需的事件。
   */
  private createSnapshotRequiredEvent(): EnvironmentStreamEvent {
    return {
      data: {
        message: 'snapshot-required',
        observedAt: new Date().toISOString(),
      },
      id: `snapshot-required-${Date.now()}`,
      type: 'snapshot-required',
    };
  }
}
