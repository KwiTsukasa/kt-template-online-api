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

  private getReplayEvents(lastEventId?: string): EnvironmentStreamEvent[] {
    if (!lastEventId) return [];
    const index = this.replay.findIndex((event) => event.id === lastEventId);
    if (index === -1) return [this.createSnapshotRequiredEvent()];
    return this.replay.slice(index + 1);
  }

  private createHeartbeatEvent(): EnvironmentStreamEvent {
    const observedAt = new Date().toISOString();
    return {
      data: { message: 'alive', observedAt },
      id: `heartbeat-${Date.now()}`,
      type: 'heartbeat',
    };
  }

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
