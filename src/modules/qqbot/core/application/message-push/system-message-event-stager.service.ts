import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { KtDateTime } from '@/common';
import {
  type SystemMessageEventInput,
  type SystemMessageEventStager,
} from '../../contract/message-push/qqbot-message-push.types';
import { QqbotMessageEvent } from '../../infrastructure/persistence/message-push/qqbot-message-event.entity';
import { SystemMessageSourceRegistry } from './system-message-source.registry';

/** Validates and atomically stages one producer-owned system-message Outbox fact. */
@Injectable()
export class SystemMessageEventStagerService implements SystemMessageEventStager {
  /**
   * Creates the transaction-bound Outbox stager.
   * @param sourceRegistry - Registry that owns source-specific event payload validation.
   */
  constructor(private readonly sourceRegistry: SystemMessageSourceRegistry) {}

  /**
   * Validates and inserts one Outbox fact through the caller's transaction manager.
   * @param manager - Active caller-owned transaction manager; never replaced with a new connection.
   * @param input - Producer event identity, occurrence time, source, resource, and scalar payload.
   * @returns `accepted` for a new event or `duplicate` for the same persisted event ID.
   */
  async stage(
    manager: EntityManager,
    input: SystemMessageEventInput,
  ): Promise<'accepted' | 'duplicate'> {
    const payload = this.sourceRegistry
      .get(input.sourceKey)
      .validateEventPayload(input.payload);
    const repository = manager.getRepository(QqbotMessageEvent);
    if (await repository.findOne({ where: { eventId: input.eventId } })) {
      return 'duplicate';
    }
    try {
      await repository.save(
        repository.create({
          eventId: input.eventId,
          fanoutAttemptCount: 0,
          fanoutLeaseUntil: null,
          fanoutStatus: 'accepted',
          lastErrorCode: null,
          lastErrorMessage: null,
          nextFanoutAt: new KtDateTime(input.occurredAt),
          occurredAt: new KtDateTime(input.occurredAt),
          payload,
          resourceKey: input.resourceKey,
          sourceKey: input.sourceKey,
        }),
      );
      return 'accepted';
    } catch (error) {
      if (this.isDuplicateKeyError(error)) return 'duplicate';
      throw error;
    }
  }

  /**
   * Recognizes only MySQL duplicate-key failures as idempotent races.
   * @param error - Unknown persistence error caught from the caller's manager.
   * @returns Whether the error is MySQL's duplicate key signal.
   */
  private isDuplicateKeyError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const record = error as { code?: unknown; errno?: unknown };
    return record.code === 'ER_DUP_ENTRY' || record.errno === 1062;
  }
}
