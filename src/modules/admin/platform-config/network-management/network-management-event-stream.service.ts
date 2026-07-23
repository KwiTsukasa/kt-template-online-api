import { Injectable, Optional } from '@nestjs/common';
import { merge, Observable, of, Subject, timer } from 'rxjs';
import { map } from 'rxjs/operators';
import type {
  NetworkStateChangeEvent,
  NetworkStateChangeSource,
} from './network-management.types';

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

  /**
   * Creates the network-management SSE fan-out without exposing MQTT to browsers.
   * @param options - Optional heartbeat and replay bounds used by runtime or tests.
   */
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
   * Opens a replayable SSE stream plus heartbeats pinned to the committed cursor.
   * @param lastEventId - Browser replay cursor from the previous committed state event.
   * @returns Observable containing replay, live changes, or keepalive messages.
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
   * Publishes one browser-safe notice after an inbound MQTT transaction commits.
   * @param source - Accepted Agent topic category that changed persisted state.
   * @returns Exact stream event stored for reconnect replay.
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
   * Resolves the bounded replay window without treating a first connection as stale.
   * @param lastEventId - Last committed event applied by the current Admin page.
   * @returns Subsequent events or one snapshot instruction when continuity is lost.
   */
  private getReplayEvents(
    lastEventId?: string,
  ): NetworkManagementStreamEvent[] {
    if (!lastEventId) return [];
    const index = this.replay.findIndex((event) => event.id === lastEventId);
    if (index === -1) return [this.createSnapshotRequiredEvent()];
    return this.replay.slice(index + 1);
  }

  /** Creates a keepalive pinned to the latest committed replay cursor. */
  private createHeartbeatEvent(): NetworkManagementStreamEvent {
    return {
      data: { message: 'alive', observedAt: new Date().toISOString() },
      id: this.currentReplayCursor(),
      type: 'heartbeat',
    };
  }

  /** Creates a snapshot instruction aligned to the latest committed replay cursor. */
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

  /** Returns the latest real state-event ID or an explicit empty initial cursor. */
  private currentReplayCursor(): string {
    return this.replay.at(-1)?.id || '';
  }
}
