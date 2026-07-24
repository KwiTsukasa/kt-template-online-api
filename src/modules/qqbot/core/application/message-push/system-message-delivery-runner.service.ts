import { Injectable } from '@nestjs/common';
import { Brackets, DataSource } from 'typeorm';
import { KtDateTime } from '@/common';
import {
  SystemMessageContractError,
  type SystemMessageDeliveryReadiness,
} from '../../contract/message-push/qqbot-message-push.types';
import { QqbotAccount } from '../../infrastructure/persistence/account/qqbot-account.entity';
import { QqbotMessageDelivery } from '../../infrastructure/persistence/message-push/qqbot-message-delivery.entity';
import { QqbotMessageEvent } from '../../infrastructure/persistence/message-push/qqbot-message-event.entity';
import { QqbotMessagePublishBinding } from '../../infrastructure/persistence/message-push/qqbot-message-publish-binding.entity';
import { QqbotMessagePublishTarget } from '../../infrastructure/persistence/message-push/qqbot-message-publish-target.entity';
import { QqbotMessageSubscription } from '../../infrastructure/persistence/message-push/qqbot-message-subscription.entity';
import {
  QqbotSendAttemptError,
  strictSendErrorSummary,
} from '../send/qqbot-send.error';
import { QqbotSendService } from '../send/qqbot-send.service';
import {
  SYSTEM_MESSAGE_BATCH_SIZE,
  SYSTEM_MESSAGE_DDNS_RECHECK_MS,
  SYSTEM_MESSAGE_LEASE_MS,
  SYSTEM_MESSAGE_RETRY_BASE_MS,
  SYSTEM_MESSAGE_RETRY_MAX_MS,
} from './system-message-runner.constants';
import { SystemMessageSourceRegistry } from './system-message-source.registry';
import { SystemMessageTemplateRendererService } from './system-message-template-renderer.service';

const DELIVERY_EXPIRED = 'delivery_expired';
const TRANSIENT_ERROR = 'delivery_transient_error';

type ClaimToken = {
  attempt: number;
  delivery: QqbotMessageDelivery;
  leaseUntil: KtDateTime;
};

type PreparedDelivery =
  | { kind: 'send'; delivery: QqbotMessageDelivery }
  | { kind: 'stale' }
  | {
      code: string;
      kind: 'finish';
      status: 'cancelled' | 'failed' | 'superseded' | 'waiting_ddns';
    };

/** Calculates the bounded delay for a one-based durable delivery attempt. */
export function deliveryRetryDelayMs(attemptCount: number): number {
  return Math.min(
    SYSTEM_MESSAGE_RETRY_BASE_MS * 2 ** Math.max(0, attemptCount - 1),
    SYSTEM_MESSAGE_RETRY_MAX_MS,
  );
}

/** Claims, rechecks, and sends a bounded set of durable system-message deliveries. */
@Injectable()
export class SystemMessageDeliveryRunnerService {
  /** Creates the runner from Core persistence, source, renderer, and strict-send boundaries. */
  constructor(
    private readonly dataSource: DataSource,
    private readonly sourceRegistry: SystemMessageSourceRegistry,
    private readonly templateRenderer: SystemMessageTemplateRendererService,
    private readonly sendService: QqbotSendService,
  ) {}

  /** Processes up to one bounded batch of due deliveries and returns its claim count. */
  async runOnce(now?: Date): Promise<number> {
    let claimed = 0;
    for (let index = 0; index < SYSTEM_MESSAGE_BATCH_SIZE; index += 1) {
      const token = await this.claimOne(now ?? new Date());
      if (!token) break;
      claimed += 1;
      try {
        await this.processClaim(token, now);
      } catch {
        await this.handleUnexpectedClaimFailure(token, now ?? new Date());
      }
    }
    return claimed;
  }

  /** Claims one oldest due row in a short transaction and returns its exact owner token. */
  private async claimOne(now: Date): Promise<ClaimToken | null> {
    return this.dataSource.transaction(async (manager) => {
      const deliveries = manager.getRepository(QqbotMessageDelivery);
      const delivery = await deliveries
        .createQueryBuilder('delivery')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where(
          new Brackets((where) => {
            where
              .where(
                'delivery.status IN (:...due) AND delivery.nextAttemptAt <= :now',
                { due: ['pending', 'retry', 'waiting_ddns'], now },
              )
              .orWhere(
                'delivery.status = :processing AND delivery.processingLeaseUntil <= :now',
                { processing: 'processing', now },
              );
          }),
        )
        .orderBy('delivery.nextAttemptAt', 'ASC')
        .addOrderBy('delivery.id', 'ASC')
        .take(1)
        .getOne();
      if (!delivery) return null;
      const leaseUntil = new KtDateTime(
        now.getTime() + SYSTEM_MESSAGE_LEASE_MS,
      );
      delivery.attemptCount += 1;
      delivery.nextAttemptAt = null;
      delivery.processingLeaseUntil = leaseUntil;
      delivery.status = 'processing';
      await deliveries.save(delivery);
      return { attempt: delivery.attemptCount, delivery, leaseUntil };
    });
  }

  /** Rechecks one claimed delivery before doing external I/O and then performs its final CAS. */
  private async processClaim(
    token: ClaimToken,
    fixedNow?: Date,
  ): Promise<void> {
    const preparationNow = fixedNow ?? new Date();
    if (preparationNow.getTime() >= token.delivery.expiresAt.getTime()) {
      await this.finish(
        token,
        'failed',
        DELIVERY_EXPIRED,
        'delivery deadline reached',
        null,
      );
      return;
    }
    const prepared = await this.prepare(token);
    if (prepared.kind === 'stale') return;
    if (prepared.kind === 'finish') {
      if (prepared.status === 'waiting_ddns') {
        const schedulingNow = fixedNow ?? new Date();
        if (
          schedulingNow.getTime() + SYSTEM_MESSAGE_DDNS_RECHECK_MS >=
          token.delivery.expiresAt.getTime()
        ) {
          await this.finish(
            token,
            'failed',
            DELIVERY_EXPIRED,
            'delivery deadline reached',
            null,
          );
          return;
        }
        await this.finish(
          token,
          'waiting_ddns',
          prepared.code,
          'DDNS is not synchronized',
          null,
          new KtDateTime(
            schedulingNow.getTime() + SYSTEM_MESSAGE_DDNS_RECHECK_MS,
          ),
        );
      } else {
        await this.finish(
          token,
          prepared.status,
          prepared.code,
          prepared.code,
          null,
        );
      }
      return;
    }
    const sendNow = fixedNow ?? new Date();
    if (sendNow.getTime() >= token.delivery.expiresAt.getTime()) {
      await this.finish(
        token,
        'failed',
        DELIVERY_EXPIRED,
        'delivery deadline reached',
        null,
      );
      return;
    }
    try {
      const result = await this.sendService.sendStrictPlainText({
        attemptNumber: token.attempt,
        deliveryId: token.delivery.id,
        message: prepared.delivery.renderedMessage,
        selfId: prepared.delivery.selfId,
        targetId: prepared.delivery.targetId,
        targetType: prepared.delivery.targetType,
      });
      await this.finish(token, 'success', null, null, String(result.logId));
    } catch (error) {
      if (error instanceof QqbotSendAttemptError) {
        if (!error.retryable) {
          await this.finish(
            token,
            'failed',
            error.code,
            strictSendErrorSummary(error.code),
            error.sendLogId,
          );
          return;
        }
        await this.retryOrFail(
          token,
          fixedNow ?? new Date(),
          error.code,
          strictSendErrorSummary(error.code),
          error.sendLogId,
        );
        return;
      }
      await this.retryOrFail(
        token,
        fixedNow ?? new Date(),
        TRANSIENT_ERROR,
        'delivery transport unavailable',
        null,
      );
    }
  }

  /** Locks current configuration before locking the delivery and returns a safe next action. */
  private async prepare(token: ClaimToken): Promise<PreparedDelivery> {
    return this.dataSource.transaction(async (manager) => {
      const event = await manager.getRepository(QqbotMessageEvent).findOne({
        where: { id: token.delivery.messageEventId },
        lock: { mode: 'pessimistic_read' },
      });
      const subscription = await manager
        .getRepository(QqbotMessageSubscription)
        .findOne({
          where: { id: token.delivery.subscriptionId },
          lock: { mode: 'pessimistic_read' },
        });
      const binding = await manager
        .getRepository(QqbotMessagePublishBinding)
        .findOne({
          where: { id: token.delivery.bindingId },
          lock: { mode: 'pessimistic_read' },
        });
      const target = await manager
        .getRepository(QqbotMessagePublishTarget)
        .findOne({
          where: { id: token.delivery.publishTargetId },
          lock: { mode: 'pessimistic_read' },
        });
      const account = binding
        ? await manager.getRepository(QqbotAccount).findOne({
            where: { id: binding.accountId },
            lock: { mode: 'pessimistic_read' },
          })
        : null;
      const delivery = await manager
        .getRepository(QqbotMessageDelivery)
        .findOne({
          where: { id: token.delivery.id },
          lock: { mode: 'pessimistic_write' },
        });
      if (!delivery || !this.owns(delivery, token)) return { kind: 'stale' };
      if (!event)
        return { code: 'event_invalid', kind: 'finish', status: 'failed' };
      if (delivery.targetType !== 'group' && delivery.targetType !== 'private')
        return {
          code: 'invalid_target_type',
          kind: 'finish',
          status: 'failed',
        };
      if (
        !subscription ||
        !binding ||
        !target ||
        !account ||
        subscription.isDeleted ||
        binding.isDeleted ||
        target.isDeleted ||
        account.isDeleted ||
        !subscription.enabled ||
        !binding.enabled ||
        !target.enabled ||
        !account.enabled ||
        subscription.sourceKey !== event.sourceKey ||
        binding.subscriptionId !== delivery.subscriptionId ||
        target.bindingId !== delivery.bindingId ||
        target.targetId !== delivery.targetId ||
        target.targetType !== delivery.targetType ||
        binding.selfId !== delivery.selfId ||
        account.selfId !== delivery.selfId
      ) {
        return {
          code: 'delivery_configuration_cancelled',
          kind: 'finish',
          status: 'cancelled',
        };
      }
      const adapter = this.sourceRegistry.get(event.sourceKey);
      let eventPayload: Record<string, boolean | null | number | string>;
      try {
        eventPayload = adapter.validateEventPayload(event.payload);
        this.validateFrozen(delivery, event.sourceKey);
      } catch (error) {
        if (!(error instanceof SystemMessageContractError)) throw error;
        return {
          code: error.code,
          kind: 'finish',
          status: 'failed',
        };
      }
      const readiness: SystemMessageDeliveryReadiness =
        await adapter.resolveDelivery({
          eventPayload,
          subscriptionConfig: subscription.sourceConfig,
        });
      if (readiness.status === 'waiting_ddns') {
        return {
          code: readiness.reasonCode,
          kind: 'finish',
          status: 'waiting_ddns',
        };
      }
      if (readiness.status === 'cancelled' || readiness.status === 'superseded')
        return {
          code: readiness.reasonCode,
          kind: 'finish',
          status: readiness.status,
        };
      return { delivery, kind: 'send' };
    });
  }

  /** Validates only immutable frozen content; current templates never replace historical work. */
  private validateFrozen(
    delivery: QqbotMessageDelivery,
    sourceKey: string,
  ): void {
    const definitions = this.sourceRegistry.get(sourceKey).definition.variables;
    const allowed = definitions.map((item) => item.key);
    const snapshot = delivery.variableSnapshot;
    if (
      !snapshot ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot) ||
      Object.keys(snapshot).length !== definitions.length ||
      definitions.some(({ key, type }) => {
        if (!Object.prototype.hasOwnProperty.call(snapshot, key)) return true;
        const value = snapshot[key];
        return (
          value === null ||
          typeof value !== type ||
          (type === 'number' &&
            (typeof value !== 'number' || !Number.isFinite(value)))
        );
      }) ||
      Object.keys(snapshot).some((key) => !allowed.includes(key))
    )
      throw new SystemMessageContractError('template_invalid');
    this.templateRenderer.validate(delivery.templateContent, allowed);
    if (
      this.templateRenderer.render(
        delivery.templateContent,
        snapshot as Record<string, boolean | number | string>,
      ) !== delivery.renderedMessage
    )
      throw new SystemMessageContractError('rendered_message_mismatch');
  }

  /** Best-effort fences an unexpected dependency failure without starving later claims. */
  private async handleUnexpectedClaimFailure(
    token: ClaimToken,
    now: Date,
  ): Promise<void> {
    try {
      await this.retryOrFail(
        token,
        now,
        TRANSIENT_ERROR,
        'delivery dependency unavailable',
        null,
      );
    } catch {
      // A later scan recovers the still-processing row after its lease expires.
    }
  }

  /** Persists a terminal, wait, or successful state only while this worker owns its lease. */
  private async finish(
    token: ClaimToken,
    status: 'cancelled' | 'failed' | 'success' | 'superseded' | 'waiting_ddns',
    code: null | string,
    message: null | string,
    sendLogId: null | string,
    nextAttemptAt: KtDateTime | null = null,
  ): Promise<void> {
    const result = await this.dataSource
      .getRepository(QqbotMessageDelivery)
      .update(this.ownerWhere(token), {
        lastErrorCode: code,
        lastErrorMessage: message,
        nextAttemptAt,
        processingLeaseUntil: null,
        sendLogId: sendLogId ?? token.delivery.sendLogId,
        status,
      });
    if (result.affected !== 1) return;
  }

  /** Retries until the event-derived expiration boundary and otherwise writes a final failure. */
  private async retryOrFail(
    token: ClaimToken,
    now: Date,
    code: string,
    message: string,
    sendLogId: null | string,
  ): Promise<void> {
    const next = new KtDateTime(
      now.getTime() + deliveryRetryDelayMs(token.attempt),
    );
    if (next.getTime() >= token.delivery.expiresAt.getTime()) {
      await this.finish(token, 'failed', code, message, sendLogId);
      return;
    }
    const result = await this.dataSource
      .getRepository(QqbotMessageDelivery)
      .update(this.ownerWhere(token), {
        lastErrorCode: code,
        lastErrorMessage: message,
        nextAttemptAt: next,
        processingLeaseUntil: null,
        sendLogId: sendLogId ?? token.delivery.sendLogId,
        status: 'retry',
      });
    if (result.affected !== 1) return;
  }

  /** Builds the exact attempt-and-lease owner fence used by every post-claim mutation. */
  private ownerWhere(token: ClaimToken) {
    return {
      attemptCount: token.attempt,
      id: token.delivery.id,
      processingLeaseUntil: token.leaseUntil,
      status: 'processing' as const,
    };
  }

  /** Tests whether a locked delivery still belongs to the detached claim owner. */
  private owns(delivery: QqbotMessageDelivery, token: ClaimToken): boolean {
    return (
      delivery.status === 'processing' &&
      delivery.attemptCount === token.attempt &&
      delivery.processingLeaseUntil?.getTime() === token.leaseUntil.getTime()
    );
  }
}
