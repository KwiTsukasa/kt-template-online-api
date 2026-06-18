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

  /**
   * Initializes the SSE stream fan-out from the environment event bus.
   * @param eventBus - Local/MQTT event bus that receives backend environment events.
   * @param materializer - Event materializer that sanitizes events and invalidates cache.
   * @param options - Test/runtime overrides for replay window and heartbeat interval.
   */
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
   * Opens an SSE-compatible observable with optional replay cursor.
   * @param lastEventId - Browser Last-Event-ID header or query fallback.
   * @returns Observable carrying replay, live events, and heartbeat notices.
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
   * Adds a materialized event to replay history and current SSE subscribers.
   * @param event - Sanitized dashboard event.
   */
  private pushEvent(event: EnvironmentEvent) {
    const streamEvent: EnvironmentStreamEvent = {
      data: event,
      id: event.id,
      type: event.type || 'environment-event',
    };
    this.replay.push(streamEvent);
    if (this.replay.length > this.replayLimit) {
      this.replay.splice(0, this.replay.length - this.replayLimit);
    }
    this.streamSubject.next(streamEvent);
  }

  /**
   * Replays recent events or asks the browser to reload one snapshot.
   * @param lastEventId - Last event id reported by the browser.
   * @returns Replay events for the new SSE subscription.
   */
  private getReplayEvents(lastEventId?: string): EnvironmentStreamEvent[] {
    if (!lastEventId) return [];
    const index = this.replay.findIndex((event) => event.id === lastEventId);
    if (index === -1) return [this.createSnapshotRequiredEvent()];
    return this.replay.slice(index + 1);
  }

  /**
   * Creates a heartbeat event that keeps the connection alive without refreshing state.
   * @returns SSE heartbeat event.
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
   * Creates a snapshot instruction when replay continuity cannot be guaranteed.
   * @returns SSE snapshot-required notice.
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
