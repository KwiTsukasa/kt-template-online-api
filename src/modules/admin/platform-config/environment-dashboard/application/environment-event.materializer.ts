import { Inject, Injectable, Optional } from '@nestjs/common';
import { Subject } from 'rxjs';
import { EnvironmentDashboardCacheService } from '../infrastructure/environment-dashboard-cache.service';
import type {
  EnvironmentEvent,
  EnvironmentEventEnvelope,
} from '../domain/environment-dashboard.types';

export interface EnvironmentDashboardCacheInvalidator {
  invalidate(): void;
}

@Injectable()
export class EnvironmentEventMaterializer {
  private readonly events: EnvironmentEvent[] = [];
  private readonly eventSubject = new Subject<EnvironmentEvent>();

  constructor(
    @Optional()
    @Inject(EnvironmentDashboardCacheService)
    private readonly cache?: EnvironmentDashboardCacheInvalidator,
    @Optional()
    private readonly maxRecentEvents = 200,
  ) {}

  /**
   * 根据当前运行态建立可重放的以只读 Observable 暴露内部事件主题；先推送缓存或当前快照，退订时移除监听器。
   * @returns 按订阅顺序推送缓存与实时数据的以只读 Observable 暴露内部事件主题；调用退订函数后不再接收后续事件。
   */
  events$() {
    return this.eventSubject.asObservable();
  }

  /**
   * 从输入或当前状态提取实体化。
   * @param envelope - 用于materialize的领域对象，包含 `evidence`、`expiresAt`、`eventId`、`nodeId` 字段。
   * @param now - 用于过期、排序或租约判定的时间基准；省略时默认采用 `new Date()`。
   * @returns 可展示的环境事件；过期 retained 事件会改为缓存来源、未知级别并在摘要中标明过期。
   */
  materialize(
    envelope: EnvironmentEventEnvelope,
    now = new Date(),
  ): EnvironmentEvent {
    const staleRetained = this.isStaleRetained(envelope, now);
    const event: EnvironmentEvent = {
      evidence: envelope.evidence,
      expiresAt: envelope.expiresAt,
      id: envelope.eventId,
      nodeId: envelope.nodeId,
      observedAt: envelope.observedAt,
      retained: envelope.retained,
      serviceId: envelope.serviceId,
      severity: (() => {
        if (staleRetained) {
          return 'unknown';
        }
        return envelope.severity;
      })(),
      signalId: envelope.signalId,
      siteId: envelope.siteId,
      sourceKind: (() => {
        if (staleRetained) {
          return 'cached';
        }
        return envelope.sourceKind;
      })(),
      summary: (() => {
        if (staleRetained) {
          return `${envelope.summary}（ retained 已过期）`;
        }
        return envelope.summary;
      })(),
      topic: envelope.topic,
      type: (() => {
        if (envelope.signalId) {
          return 'environment-signal';
        }
        return 'environment-event';
      })(),
    };

    this.appendRecentEvent(event);
    if (!staleRetained && envelope.signalId) {
      this.cache?.invalidate();
    }
    this.eventSubject.next(event);
    return event;
  }

  /**
   * 按当前运行态读取最近事件。
   * @returns 按输入顺序得到的最近事件列表；没有匹配项时为空数组。
   */
  getRecentEvents() {
    return [...this.events];
  }

  /**
   * 根据`envelope`、`now`与当前约束判定过期的已保留的；从 `getTime` 读取过期的已保留的。
   * @param envelope - 用于过期的已保留的的领域对象，包含 `retained`、`observedAt`、`expiresAt` 字段。
   * @param now - 用于过期、排序或租约判定的时间基准。
   * @returns 满足过期的已保留的约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isStaleRetained(
    envelope: EnvironmentEventEnvelope,
    now: Date,
  ): boolean {
    if (!envelope.retained) return false;
    if (!envelope.observedAt || !envelope.expiresAt) return true;
    return new Date(envelope.expiresAt).getTime() <= now.getTime();
  }

  /**
   * 根据`event`更新最近事件。
   * @param event - 触发最近事件的领域事件。
   */
  private appendRecentEvent(event: EnvironmentEvent) {
    this.events.push(event);
    if (this.events.length > this.maxRecentEvents) {
      this.events.splice(0, this.events.length - this.maxRecentEvents);
    }
  }
}
