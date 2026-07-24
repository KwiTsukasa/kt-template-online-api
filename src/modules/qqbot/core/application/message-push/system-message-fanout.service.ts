import { Injectable } from '@nestjs/common';
import { DataSource, Brackets, type EntityManager } from 'typeorm';
import { KtDateTime } from '@/common';
import {
  SystemMessageContractError,
  type SystemMessageDeliveryReadiness,
  type SystemMessageScalar,
  type SystemMessageSourceAdapter,
} from '../../contract/message-push/qqbot-message-push.types';
import { QqbotAccount } from '../../infrastructure/persistence/account/qqbot-account.entity';
import { QqbotMessageDelivery } from '../../infrastructure/persistence/message-push/qqbot-message-delivery.entity';
import { QqbotMessageEvent } from '../../infrastructure/persistence/message-push/qqbot-message-event.entity';
import { QqbotMessagePublishBinding } from '../../infrastructure/persistence/message-push/qqbot-message-publish-binding.entity';
import { QqbotMessagePublishTarget } from '../../infrastructure/persistence/message-push/qqbot-message-publish-target.entity';
import { QqbotMessageSubscription } from '../../infrastructure/persistence/message-push/qqbot-message-subscription.entity';
import { QqbotMessageTemplate } from '../../infrastructure/persistence/message-push/qqbot-message-template.entity';
import {
  SYSTEM_MESSAGE_BATCH_SIZE,
  SYSTEM_MESSAGE_DDNS_RECHECK_MS,
  SYSTEM_MESSAGE_LEASE_MS,
  SYSTEM_MESSAGE_RETRY_BASE_MS,
  SYSTEM_MESSAGE_RETRY_MAX_MS,
  SYSTEM_MESSAGE_RETRY_WINDOW_MS,
} from './system-message-runner.constants';
import { SystemMessageSourceRegistry } from './system-message-source.registry';
import { SystemMessageTemplateRendererService } from './system-message-template-renderer.service';

const STUN_MAPPING_PORT_SOURCE = 'network.stun.mapping-port-changed';
const TRANSIENT_ERROR_CODE = 'fanout_transient_error';
const EVENT_EXPIRED_ERROR_CODE = 'fanout_expired';
const EVENT_RESOURCE_MISMATCH_ERROR_CODE = 'event_resource_mismatch';
const SUPERSEDED_STATUSES = new Set(['waiting_ddns', 'pending', 'retry']);

interface ClaimToken {
  attempt: number;
  event: QqbotMessageEvent;
  leaseUntil: KtDateTime;
}

type SubscriptionFanOutOutcome = 'handled' | 'stale_claim';

/**
 * Creates frozen, idempotent delivery work from committed system-message Outbox facts.
 *
 * It deliberately only persists work. The later delivery coordinator owns DDNS wakeups
 * and every OneBot call.
 */
@Injectable()
export class SystemMessageFanoutService {
  /**
   * Creates the durable Outbox fan-out service.
   * @param dataSource - Core database source used for short claim and subscription transactions.
   * @param sourceRegistry - Registered source adapters for payload validation and readiness.
   * @param templateRenderer - Safe literal-only renderer used to freeze final text.
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly sourceRegistry: SystemMessageSourceRegistry,
    private readonly templateRenderer: SystemMessageTemplateRendererService,
  ) {}

  /**
   * Claims and processes at most one bounded batch of due Outbox events.
   * @param now - Stable clock instant for leases, schedules, and retry decisions.
   * @returns Count of rows successfully claimed, including rows that become retry or failed.
   */
  async runOnce(now: Date = new Date()): Promise<number> {
    let claimed = 0;
    for (let index = 0; index < SYSTEM_MESSAGE_BATCH_SIZE; index += 1) {
      const token = await this.claimOne(now);
      if (!token) break;
      claimed += 1;
      await this.processClaim(token, now);
    }
    return claimed;
  }

  /**
   * Atomically claims the oldest due Outbox event using an exact lease ownership token.
   * @param now - Clock instant against which due rows and expired leases are evaluated.
   * @returns Claimed event with its new attempt and lease, or null when no eligible row exists.
   */
  private async claimOne(now: Date): Promise<ClaimToken | null> {
    return this.dataSource.transaction(async (manager) => {
      const events = manager.getRepository(QqbotMessageEvent);
      const event = await events
        .createQueryBuilder('event')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where(
          new Brackets((where) => {
            where
              .where(
                'event.fanoutStatus IN (:...due) AND event.nextFanoutAt <= :now',
                { due: ['accepted', 'retry'], now },
              )
              .orWhere(
                'event.fanoutStatus = :processing AND event.fanoutLeaseUntil <= :now',
                { processing: 'processing', now },
              );
          }),
        )
        .orderBy('event.occurredAt', 'ASC')
        .addOrderBy('event.id', 'ASC')
        .take(1)
        .getOne();
      if (!event) return null;

      const leaseUntil = new KtDateTime(
        now.getTime() + SYSTEM_MESSAGE_LEASE_MS,
      );
      event.fanoutAttemptCount += 1;
      event.fanoutLeaseUntil = leaseUntil;
      event.fanoutStatus = 'processing';
      event.nextFanoutAt = null;
      await events.save(event);
      return { attempt: event.fanoutAttemptCount, event, leaseUntil };
    });
  }

  /**
   * Validates one owned event and fans it out without allowing stale owners to finish it.
   * @param token - Attempt-plus-lease token returned by the successful claim transaction.
   * @param now - Stable clock instant for expiry and next retry time.
   */
  private async processClaim(token: ClaimToken, now: Date): Promise<void> {
    if (this.isExpired(token.event, now)) {
      await this.finish(
        token,
        'failed',
        EVENT_EXPIRED_ERROR_CODE,
        'fan-out deadline reached',
      );
      return;
    }

    try {
      const adapter = this.sourceRegistry.get(token.event.sourceKey);
      const payload = adapter.validateEventPayload(token.event.payload);
      this.assertResourceIdentity(token.event, payload);
      const subscriptions = await this.findMatchingSubscriptions(token.event);
      let transientFailure = false;

      for (const subscription of subscriptions) {
        try {
          const outcome = await this.dataSource.transaction((manager) =>
            this.fanOutSubscription(
              manager,
              token,
              subscription.id,
              adapter,
              now,
            ),
          );
          if (outcome === 'stale_claim') return;
        } catch {
          transientFailure = true;
        }
      }

      if (transientFailure) {
        await this.retryOrFail(
          token,
          now,
          TRANSIENT_ERROR_CODE,
          'fan-out dependency unavailable',
        );
        return;
      }
      await this.finish(token, 'completed', null, null);
    } catch (error) {
      if (error instanceof SystemMessageContractError) {
        await this.finish(token, 'failed', error.code, this.safeMessage(error));
        return;
      }
      if (error instanceof EventResourceMismatchError) {
        await this.finish(
          token,
          'failed',
          EVENT_RESOURCE_MISMATCH_ERROR_CODE,
          error.message,
        );
        return;
      }
      await this.retryOrFail(
        token,
        now,
        TRANSIENT_ERROR_CODE,
        'fan-out dependency unavailable',
      );
    }
  }

  /**
   * Selects active subscriptions whose own JSON resource field exactly matches the event.
   * @param event - Frozen Outbox event being fanned out.
   * @returns Deterministically ordered eligible subscription rows.
   */
  private async findMatchingSubscriptions(
    event: QqbotMessageEvent,
  ): Promise<QqbotMessageSubscription[]> {
    const subscriptions = await this.dataSource
      .getRepository(QqbotMessageSubscription)
      .find({
        where: { enabled: true, isDeleted: false, sourceKey: event.sourceKey },
        order: { id: 'ASC' },
      });
    return subscriptions.filter((subscription) =>
      this.matchesSubscription(subscription, event),
    );
  }

  /**
   * Executes one subscription's isolated persistence unit.
   * @param manager - Transaction manager whose mutations commit only for this subscription.
   * @param token - Exact claim token that must still own the locked Outbox row.
   * @param subscriptionId - Primary key of the subscription to lock and recheck.
   * @param adapter - Source adapter already used to validate the frozen payload.
   * @param now - Stable scheduling instant for newly created delivery rows.
   */
  private async fanOutSubscription(
    manager: EntityManager,
    token: ClaimToken,
    subscriptionId: string,
    adapter: SystemMessageSourceAdapter,
    now: Date,
  ): Promise<SubscriptionFanOutOutcome> {
    const events = manager.getRepository(QqbotMessageEvent);
    const event = await events.findOne({
      where: { id: token.event.id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!event || !this.ownsClaim(event, token)) return 'stale_claim';

    const subscriptions = manager.getRepository(QqbotMessageSubscription);
    const subscription = await subscriptions.findOne({
      where: { id: subscriptionId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!subscription || !this.matchesSubscription(subscription, event)) {
      return 'handled';
    }

    const payload = adapter.validateEventPayload(event.payload);
    this.assertResourceIdentity(event, payload);
    const readiness = await adapter.resolveDelivery({
      eventPayload: payload,
      subscriptionConfig: subscription.sourceConfig,
    });
    await this.supersedeEarlierDeliveries(manager, event, subscription.id);
    if (!this.hasRenderableVariables(readiness)) return 'handled';

    await this.createDeliveries(manager, event, subscription, readiness, now);
    return 'handled';
  }

  /**
   * Supersedes only unfinished deliveries of events strictly earlier than the current event.
   * @param manager - Current subscription transaction manager.
   * @param event - Current event that supersedes older work for this subscription.
   * @param subscriptionId - Subscription scope that prevents unrelated fan-out interference.
   */
  private async supersedeEarlierDeliveries(
    manager: EntityManager,
    event: QqbotMessageEvent,
    subscriptionId: string,
  ): Promise<void> {
    const events = manager.getRepository(QqbotMessageEvent);
    const priorEvents = await events.find({
      where: { resourceKey: event.resourceKey, sourceKey: event.sourceKey },
    });
    const priorIds = new Set(
      priorEvents
        .filter((candidate) => this.isStrictlyEarlier(candidate, event))
        .map((candidate) => candidate.id),
    );
    if (!priorIds.size) return;

    const deliveries = manager.getRepository(QqbotMessageDelivery);
    const candidates = await deliveries.find({ where: { subscriptionId } });
    for (const delivery of candidates) {
      if (
        priorIds.has(delivery.messageEventId) &&
        SUPERSEDED_STATUSES.has(delivery.status)
      ) {
        delivery.status = 'superseded';
        await deliveries.save(delivery);
      }
    }
  }

  /**
   * Builds every currently legal binding/target delivery with frozen snapshots.
   * @param manager - Current isolated subscription transaction manager.
   * @param event - Frozen Outbox event.
   * @param subscription - Locked and rechecked active subscription.
   * @param readiness - Ready or DDNS-waiting variables from the source adapter.
   * @param now - Stable scheduling instant for the newly created rows.
   */
  private async createDeliveries(
    manager: EntityManager,
    event: QqbotMessageEvent,
    subscription: QqbotMessageSubscription,
    readiness: Extract<
      SystemMessageDeliveryReadiness,
      { status: 'ready' | 'waiting_ddns' }
    >,
    now: Date,
  ): Promise<void> {
    const bindings = await manager
      .getRepository(QqbotMessagePublishBinding)
      .find({
        where: {
          enabled: true,
          isDeleted: false,
          subscriptionId: subscription.id,
        },
        order: { id: 'ASC' },
      });
    const accounts = await manager.getRepository(QqbotAccount).find({
      where: { enabled: true, isDeleted: false },
    });
    const templates = await manager.getRepository(QqbotMessageTemplate).find({
      where: { enabled: true, isDeleted: false, sourceKey: event.sourceKey },
    });
    const targets = await manager
      .getRepository(QqbotMessagePublishTarget)
      .find({
        where: { enabled: true, isDeleted: false },
        order: { id: 'ASC' },
      });
    const accountById = new Map(
      accounts.map((account) => [account.id, account]),
    );
    const templateById = new Map(
      templates.map((template) => [template.id, template]),
    );

    for (const binding of bindings) {
      const account = accountById.get(binding.accountId);
      const template = templateById.get(binding.templateId);
      if (!account || !template || account.selfId !== binding.selfId) continue;

      let renderedMessage: string;
      try {
        renderedMessage = this.templateRenderer.render(
          template.content,
          readiness.variables,
        );
      } catch (error) {
        if (error instanceof SystemMessageContractError) continue;
        throw error;
      }
      for (const target of targets.filter(
        (item) => item.bindingId === binding.id,
      )) {
        if (target.targetType !== 'group' && target.targetType !== 'private') {
          continue;
        }
        await this.createDeliveryIfAbsent(
          manager,
          event,
          subscription,
          binding,
          template,
          target,
          readiness,
          renderedMessage,
          now,
        );
      }
    }
  }

  /**
   * Persists one delivery, accepting only the exact event-target duplicate-key race.
   * @param manager - Current isolated subscription transaction manager.
   * @param event - Frozen source event.
   * @param subscription - Subscription snapshot identity.
   * @param binding - Active strict-account publishing binding.
   * @param template - Source-compatible template whose content is frozen.
   * @param target - Active target that defines this row's idempotency key.
   * @param readiness - Ready or DDNS-waiting result that supplies frozen variables.
   * @param renderedMessage - Already validated literal rendered content.
   * @param now - Stable schedule time for the new row.
   */
  private async createDeliveryIfAbsent(
    manager: EntityManager,
    event: QqbotMessageEvent,
    subscription: QqbotMessageSubscription,
    binding: QqbotMessagePublishBinding,
    template: QqbotMessageTemplate,
    target: QqbotMessagePublishTarget,
    readiness: Extract<
      SystemMessageDeliveryReadiness,
      { status: 'ready' | 'waiting_ddns' }
    >,
    renderedMessage: string,
    now: Date,
  ): Promise<void> {
    const deliveries = manager.getRepository(QqbotMessageDelivery);
    const key = { messageEventId: event.id, publishTargetId: target.id };
    if (await deliveries.findOne({ where: key })) return;
    const isWaiting = readiness.status === 'waiting_ddns';
    const delivery = deliveries.create({
      attemptCount: 0,
      bindingId: binding.id,
      expiresAt: new KtDateTime(
        event.occurredAt.getTime() + SYSTEM_MESSAGE_RETRY_WINDOW_MS,
      ),
      lastErrorCode: null,
      lastErrorMessage: null,
      messageEventId: event.id,
      nextAttemptAt: new KtDateTime(
        now.getTime() + (isWaiting ? SYSTEM_MESSAGE_DDNS_RECHECK_MS : 0),
      ),
      processingLeaseUntil: null,
      publishTargetId: target.id,
      renderedMessage,
      selfId: binding.selfId,
      sendLogId: null,
      status: isWaiting ? 'waiting_ddns' : 'pending',
      subscriptionId: subscription.id,
      targetId: target.targetId,
      targetType: target.targetType,
      templateContent: template.content,
      templateId: template.id,
      variableSnapshot: structuredClone(readiness.variables),
    });
    try {
      await deliveries.save(delivery);
    } catch (error) {
      if (!this.isDuplicateKeyError(error)) throw error;
      const existing = await deliveries.findOne({
        where: key,
        lock: { mode: 'pessimistic_read' },
      });
      if (!existing) throw error;
    }
  }

  /**
   * Completes, retries, or fails only while the original claim still owns the event.
   * @param token - Original attempt and exact lease ownership token.
   * @param status - Terminal or retry fan-out state to persist.
   * @param code - Safe stable error classification, or null for completion.
   * @param message - Bounded safe error summary, or null for completion.
   */
  private async finish(
    token: ClaimToken,
    status: 'completed' | 'failed' | 'retry',
    code: null | string,
    message: null | string,
  ): Promise<void> {
    await this.dataSource.getRepository(QqbotMessageEvent).update(
      {
        fanoutAttemptCount: token.attempt,
        fanoutLeaseUntil: token.leaseUntil,
        fanoutStatus: 'processing',
        id: token.event.id,
      },
      {
        fanoutLeaseUntil: null,
        fanoutStatus: status,
        lastErrorCode: code,
        lastErrorMessage: message,
        nextFanoutAt: null,
      },
    );
  }

  /**
   * Schedules a safe retry only when another attempt can occur before the hard deadline.
   * @param token - Original claim ownership token.
   * @param now - Stable clock instant used to calculate retry timing.
   * @param code - Stable safe transient error code.
   * @param message - Sanitized transient error summary.
   */
  private async retryOrFail(
    token: ClaimToken,
    now: Date,
    code: string,
    message: string,
  ): Promise<void> {
    const delay = Math.min(
      SYSTEM_MESSAGE_RETRY_BASE_MS * 2 ** (token.attempt - 1),
      SYSTEM_MESSAGE_RETRY_MAX_MS,
    );
    const deadline =
      token.event.occurredAt.getTime() + SYSTEM_MESSAGE_RETRY_WINDOW_MS;
    if (now.getTime() + delay >= deadline) {
      await this.finish(
        token,
        'failed',
        EVENT_EXPIRED_ERROR_CODE,
        'fan-out deadline reached',
      );
      return;
    }
    await this.dataSource.getRepository(QqbotMessageEvent).update(
      {
        fanoutAttemptCount: token.attempt,
        fanoutLeaseUntil: token.leaseUntil,
        fanoutStatus: 'processing',
        id: token.event.id,
      },
      {
        fanoutLeaseUntil: null,
        fanoutStatus: 'retry',
        lastErrorCode: code,
        lastErrorMessage: message,
        nextFanoutAt: new KtDateTime(now.getTime() + delay),
      },
    );
  }

  /**
   * Checks the strict current source/resource identity without coercing Snowflake strings.
   * @param event - Event whose immutable resource key is authoritative.
   * @param payload - Source-validated scalar payload.
   */
  private assertResourceIdentity(
    event: QqbotMessageEvent,
    payload: Record<string, SystemMessageScalar>,
  ): void {
    if (
      event.sourceKey === STUN_MAPPING_PORT_SOURCE &&
      payload.portForwardId !== event.resourceKey
    ) {
      throw new EventResourceMismatchError();
    }
  }

  /**
   * Checks whether a subscription remains active and has an own string resource ID match.
   * @param subscription - Candidate subscription row.
   * @param event - Current immutable Outbox event.
   * @returns Whether this row is a strict fan-out match.
   */
  private matchesSubscription(
    subscription: QqbotMessageSubscription,
    event: QqbotMessageEvent,
  ): boolean {
    const config = subscription.sourceConfig;
    return (
      subscription.enabled &&
      !subscription.isDeleted &&
      subscription.sourceKey === event.sourceKey &&
      !!config &&
      Object.prototype.hasOwnProperty.call(config, 'portForwardId') &&
      typeof config.portForwardId === 'string' &&
      config.portForwardId === event.resourceKey
    );
  }

  /**
   * Compares source events by their required occurrence-time then string-ID ordering.
   * @param candidate - Potential historical event.
   * @param current - Event whose older deliveries may be superseded.
   * @returns Whether candidate is strictly earlier than current.
   */
  private isStrictlyEarlier(
    candidate: QqbotMessageEvent,
    current: QqbotMessageEvent,
  ): boolean {
    const difference =
      candidate.occurredAt.getTime() - current.occurredAt.getTime();
    return (
      difference < 0 ||
      (difference === 0 && BigInt(candidate.id) < BigInt(current.id))
    );
  }

  /**
   * Checks whether creating a new delivery would violate the occurrence-based fan-out deadline.
   * @param event - Claimed Outbox event.
   * @param now - Stable invocation clock.
   * @returns Whether the event is at or beyond its 24-hour deadline.
   */
  private isExpired(event: QqbotMessageEvent, now: Date): boolean {
    return (
      now.getTime() >=
      event.occurredAt.getTime() + SYSTEM_MESSAGE_RETRY_WINDOW_MS
    );
  }

  /**
   * Verifies that a locked event row still belongs to the exact claim attempt.
   * @param event - Event row freshly locked in the subscription transaction.
   * @param token - Attempt and lease values returned by the original claim.
   * @returns Whether this transaction may mutate deliveries for the claim.
   */
  private ownsClaim(event: QqbotMessageEvent, token: ClaimToken): boolean {
    return (
      event.id === token.event.id &&
      event.fanoutStatus === 'processing' &&
      event.fanoutAttemptCount === token.attempt &&
      !!event.fanoutLeaseUntil &&
      event.fanoutLeaseUntil.getTime() === token.leaseUntil.getTime()
    );
  }

  /**
   * Narrows the source union to outcomes that provide variables required by delivery rows.
   * @param readiness - Source adapter result for the locked subscription.
   * @returns Whether a frozen ready or DDNS-waiting delivery can be persisted.
   */
  private hasRenderableVariables(
    readiness: SystemMessageDeliveryReadiness,
  ): readiness is Extract<
    SystemMessageDeliveryReadiness,
    { status: 'ready' | 'waiting_ddns' }
  > {
    return readiness.status === 'ready' || readiness.status === 'waiting_ddns';
  }

  /**
   * Recognizes MySQL's duplicate-key signal without treating other writes as idempotent.
   * @param error - Unknown persistence failure from an individual delivery insert.
   * @returns Whether the error is a MySQL duplicate-key failure.
   */
  private isDuplicateKeyError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const record = error as { code?: unknown; errno?: unknown };
    return record.code === 'ER_DUP_ENTRY' || record.errno === 1062;
  }

  /**
   * Converts a domain error into a bounded, non-stack persistence summary.
   * @param error - Domain contract error whose stable code is safe to retain.
   * @returns At most 500 characters of non-sensitive message text.
   */
  private safeMessage(error: SystemMessageContractError): string {
    return error.message.slice(0, 500);
  }
}

/** Signals frozen STUN payload identity that conflicts with the immutable event resource. */
class EventResourceMismatchError extends Error {
  /** Creates the stable permanent event/resource mismatch classification. */
  constructor() {
    super('validated port-forward identity does not match event resource');
  }
}
