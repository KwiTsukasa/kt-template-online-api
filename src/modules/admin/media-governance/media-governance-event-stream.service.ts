import { Injectable, Optional } from '@nestjs/common';
import { merge, Observable, of, Subject, timer } from 'rxjs';
import { map } from 'rxjs/operators';

export interface MediaGovernanceEventStreamOptions {
  heartbeatMs?: number;
  replayLimit?: number;
}

export interface MediaGovernanceTaskChangedData {
  changeType: 'created' | 'source-updated' | 'state-updated';
  observedAt: string;
  revision: number;
  taskId: string;
}

export interface MediaGovernanceStreamEvent {
  data:
    | MediaGovernanceTaskChangedData
    | { message: string; observedAt: string };
  id: string;
  type: 'heartbeat' | 'snapshot-required' | 'task-changed';
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

  publishTaskChanged(
    input: Omit<MediaGovernanceTaskChangedData, 'observedAt'>,
  ): MediaGovernanceStreamEvent {
    const observedAt = new Date().toISOString();
    const eventId = `media-${Date.now()}-${++this.eventSequence}`;
    const event: MediaGovernanceStreamEvent = {
      data: { ...input, observedAt },
      id: eventId,
      type: 'task-changed',
    };
    this.replay.push(event);
    if (this.replay.length > this.replayLimit) {
      this.replay.splice(0, this.replay.length - this.replayLimit);
    }
    this.streamSubject.next(event);
    return event;
  }

  private getReplayEvents(lastEventId?: string): MediaGovernanceStreamEvent[] {
    if (!lastEventId) return [];
    const index = this.replay.findIndex((event) => event.id === lastEventId);
    if (index === -1) return [this.createSnapshotRequiredEvent()];
    return this.replay.slice(index + 1);
  }

  private createHeartbeatEvent(): MediaGovernanceStreamEvent {
    return {
      data: { message: 'alive', observedAt: new Date().toISOString() },
      id: this.currentReplayCursor(),
      type: 'heartbeat',
    };
  }

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

  private currentReplayCursor(): string {
    return this.replay.at(-1)?.id ?? '';
  }
}
