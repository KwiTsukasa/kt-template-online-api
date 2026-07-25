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

  events$() {
    return this.eventSubject.asObservable();
  }

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
      severity: staleRetained ? 'unknown' : envelope.severity,
      signalId: envelope.signalId,
      siteId: envelope.siteId,
      sourceKind: staleRetained ? 'cached' : envelope.sourceKind,
      summary: staleRetained
        ? `${envelope.summary}（ retained 已过期）`
        : envelope.summary,
      topic: envelope.topic,
      type: envelope.signalId ? 'environment-signal' : 'environment-event',
    };

    this.appendRecentEvent(event);
    if (!staleRetained && envelope.signalId) {
      this.cache?.invalidate();
    }
    this.eventSubject.next(event);
    return event;
  }

  getRecentEvents() {
    return [...this.events];
  }

  private isStaleRetained(
    envelope: EnvironmentEventEnvelope,
    now: Date,
  ): boolean {
    if (!envelope.retained) return false;
    if (!envelope.observedAt || !envelope.expiresAt) return true;
    return new Date(envelope.expiresAt).getTime() <= now.getTime();
  }

  private appendRecentEvent(event: EnvironmentEvent) {
    this.events.push(event);
    if (this.events.length > this.maxRecentEvents) {
      this.events.splice(0, this.events.length - this.maxRecentEvents);
    }
  }
}
