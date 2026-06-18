import { Injectable, Optional } from '@nestjs/common';
import { Subject } from 'rxjs';
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

  /**
   * Initializes the materializer with an optional cache invalidator.
   * @param cache - Dashboard cache dependency; invalidated only for fresh signal events.
   * @param maxRecentEvents - Bounded recent-event history retained for dashboard snapshots.
   */
  constructor(
    @Optional()
    private readonly cache?: EnvironmentDashboardCacheInvalidator,
    @Optional()
    private readonly maxRecentEvents = 200,
  ) {}

  /**
   * Exposes materialized events for SSE stream fan-out.
   * @returns RxJS subject stream carrying already-sanitized dashboard events.
   */
  events$() {
    return this.eventSubject.asObservable();
  }

  /**
   * Converts a raw envelope into safe dashboard event state.
   * @param envelope - Event from local collectors, MQTT retained messages, or bridge services.
   * @param now - Clock override used by tests to validate retained expiry behavior.
   * @returns Materialized event, with stale retained messages downgraded to unknown.
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

  /**
   * Reads recent materialized events for the dashboard HTTP snapshot.
   * @returns Newest retained event array in insertion order.
   */
  getRecentEvents() {
    return [...this.events];
  }

  /**
   * Determines whether retained MQTT evidence is missing expiry or already expired.
   * @param envelope - Raw environment event envelope.
   * @param now - Clock used to compare the retained expiry boundary.
   * @returns True when the event must not create green status.
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
   * Adds an event to bounded recent history.
   * @param event - Materialized dashboard event to retain for snapshots and replay.
   */
  private appendRecentEvent(event: EnvironmentEvent) {
    this.events.push(event);
    if (this.events.length > this.maxRecentEvents) {
      this.events.splice(0, this.events.length - this.maxRecentEvents);
    }
  }
}
