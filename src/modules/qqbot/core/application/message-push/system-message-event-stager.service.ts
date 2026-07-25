import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { KtDateTime } from '@/common';
import {
  type SystemMessageEventInput,
  type SystemMessageEventStager,
} from '../../contract/message-push/qqbot-message-push.types';
import { QqbotMessageEvent } from '../../infrastructure/persistence/message-push/qqbot-message-event.entity';
import { SystemMessageSourceRegistry } from './system-message-source.registry';

@Injectable()
export class SystemMessageEventStagerService implements SystemMessageEventStager {
  constructor(private readonly sourceRegistry: SystemMessageSourceRegistry) {}

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

  private isDuplicateKeyError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const record = error as { code?: unknown; errno?: unknown };
    return record.code === 'ER_DUP_ENTRY' || record.errno === 1062;
  }
}
