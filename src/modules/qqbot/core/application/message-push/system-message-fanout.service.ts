import { Injectable } from '@nestjs/common';
import { DataSource, Brackets, In, type EntityManager } from 'typeorm';
import { KtDateTime } from '@/common';
import {
  SystemMessageContractError,
  type SystemMessageDeliveryReadiness,
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

const TRANSIENT_ERROR_CODE = 'fanout_transient_error';
const EVENT_EXPIRED_ERROR_CODE = 'fanout_expired';
const EVENT_RESOURCE_MISMATCH_ERROR_CODE = 'event_resource_mismatch';
const SUPERSEDED_STATUSES = ['waiting_ddns', 'pending', 'retry'];

interface ClaimToken {
  attempt: number;
  event: QqbotMessageEvent;
  leaseUntil: KtDateTime;
}

type SubscriptionFanOutOutcome = 'handled' | 'stale_claim';

@Injectable()
export class SystemMessageFanoutService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly sourceRegistry: SystemMessageSourceRegistry,
    private readonly templateRenderer: SystemMessageTemplateRendererService,
  ) {}

  /** 执行一次。 */
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

  /** 返回声明单个。 */
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
                new Brackets((due) => {
                  due.where(
                    'event.fanoutStatus IN (:...due) AND (event.nextFanoutAt IS NULL OR event.nextFanoutAt <= :now)',
                    { due: ['accepted', 'retry'], now },
                  );
                }),
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

  /** 处理声明。 */
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
      this.assertResourceIdentity(
        token.event,
        adapter.eventResourceKey(payload),
      );
      const subscriptions = await this.findMatchingSubscriptions(
        token.event,
        adapter,
      );
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

  /** 查找匹配的订阅。 */
  private async findMatchingSubscriptions(
    event: QqbotMessageEvent,
    adapter: SystemMessageSourceAdapter,
  ): Promise<QqbotMessageSubscription[]> {
    const subscriptions = await this.dataSource
      .getRepository(QqbotMessageSubscription)
      .find({
        where: { enabled: true, isDeleted: false, sourceKey: event.sourceKey },
        order: { id: 'ASC' },
      });
    return subscriptions.filter((subscription) =>
      this.matchesSubscription(subscription, event, adapter),
    );
  }

  /** 返回扇出输出订阅。 */
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

    if (await this.hasStrictlyNewerEvent(manager, event)) {
      await this.supersedeCurrentEventDeliveries(
        manager,
        event,
        subscriptionId,
      );
      return 'handled';
    }

    const subscriptions = manager.getRepository(QqbotMessageSubscription);
    const subscription = await subscriptions.findOne({
      where: { id: subscriptionId },
      lock: { mode: 'pessimistic_write' },
    });
    if (
      !subscription ||
      !this.matchesSubscription(subscription, event, adapter)
    ) {
      return 'handled';
    }

    const payload = adapter.validateEventPayload(event.payload);
    this.assertResourceIdentity(event, adapter.eventResourceKey(payload));
    const readiness = await adapter.resolveDelivery({
      eventPayload: payload,
      subscriptionConfig: subscription.sourceConfig,
    });
    await this.supersedeEarlierDeliveries(manager, event, subscription.id);
    if (!this.hasRenderableVariables(readiness)) return 'handled';

    await this.createDeliveries(manager, event, subscription, readiness, now);
    return 'handled';
  }

  /** 判断严格地更新的事件是否存在。 */
  private async hasStrictlyNewerEvent(
    manager: EntityManager,
    event: QqbotMessageEvent,
  ): Promise<boolean> {
    const newerEvent = await manager
      .getRepository(QqbotMessageEvent)
      .createQueryBuilder('newerEvent')
      .setLock('pessimistic_read')
      .where(
        'newerEvent.sourceKey = :sourceKey AND newerEvent.resourceKey = :resourceKey',
        { resourceKey: event.resourceKey, sourceKey: event.sourceKey },
      )
      .andWhere(
        new Brackets((where) => {
          where
            .where('newerEvent.occurredAt > :occurredAt', {
              occurredAt: event.occurredAt,
            })
            .orWhere(
              'newerEvent.occurredAt = :occurredAt AND newerEvent.id > :eventId',
              { eventId: event.id, occurredAt: event.occurredAt },
            );
        }),
      )
      .orderBy('newerEvent.occurredAt', 'ASC')
      .addOrderBy('newerEvent.id', 'ASC')
      .take(1)
      .getOne();
    return !!newerEvent;
  }

  /** 取代当前事件投递记录。 */
  private async supersedeCurrentEventDeliveries(
    manager: EntityManager,
    event: QqbotMessageEvent,
    subscriptionId: string,
  ): Promise<void> {
    const deliveries = manager.getRepository(QqbotMessageDelivery);
    await deliveries.update(
      {
        messageEventId: event.id,
        status: In(SUPERSEDED_STATUSES),
        subscriptionId,
      },
      { status: 'superseded' },
    );
  }

  /** 取代更早投递记录。 */
  private async supersedeEarlierDeliveries(
    manager: EntityManager,
    event: QqbotMessageEvent,
    subscriptionId: string,
  ): Promise<void> {
    const events = manager.getRepository(QqbotMessageEvent);
    const priorEvents = await events.find({
      where: { resourceKey: event.resourceKey, sourceKey: event.sourceKey },
    });
    const priorIds = priorEvents
      .filter((candidate) => this.isStrictlyEarlier(candidate, event))
      .map((candidate) => candidate.id);
    if (!priorIds.length) return;

    const deliveries = manager.getRepository(QqbotMessageDelivery);
    await deliveries.update(
      {
        messageEventId: In(priorIds),
        status: In(SUPERSEDED_STATUSES),
        subscriptionId,
      },
      { status: 'superseded' },
    );
  }

  /** 创建投递记录。 */
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

  /** 创建投递条件分支不存在的。 */
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

  /** 完成系统消息扇出记录。 */
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

  /** 重试或失败。 */
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

  /** 确认适配器解析的事件资源与冻结事件身份一致。 */
  private assertResourceIdentity(
    event: QqbotMessageEvent,
    resourceKey: string,
  ): void {
    if (resourceKey !== event.resourceKey) {
      throw new EventResourceMismatchError();
    }
  }

  /** 使用消息源适配器自己的资源键规则匹配订阅。 */
  private matchesSubscription(
    subscription: QqbotMessageSubscription,
    event: QqbotMessageEvent,
    adapter: SystemMessageSourceAdapter,
  ): boolean {
    const config = subscription.sourceConfig;
    return (
      subscription.enabled &&
      !subscription.isDeleted &&
      subscription.sourceKey === event.sourceKey &&
      !!config &&
      adapter.subscriptionResourceKey(config) === event.resourceKey
    );
  }

  /** 判断严格地更早是否成立。 */
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

  /** 判断已过期的是否成立。 */
  private isExpired(event: QqbotMessageEvent, now: Date): boolean {
    return (
      now.getTime() >=
      event.occurredAt.getTime() + SYSTEM_MESSAGE_RETRY_WINDOW_MS
    );
  }

  /** 返回拥有声明。 */
  private ownsClaim(event: QqbotMessageEvent, token: ClaimToken): boolean {
    return (
      event.id === token.event.id &&
      event.fanoutStatus === 'processing' &&
      event.fanoutAttemptCount === token.attempt &&
      !!event.fanoutLeaseUntil &&
      event.fanoutLeaseUntil.getTime() === token.leaseUntil.getTime()
    );
  }

  /** 判断可渲染的变量是否存在。 */
  private hasRenderableVariables(
    readiness: SystemMessageDeliveryReadiness,
  ): readiness is Extract<
    SystemMessageDeliveryReadiness,
    { status: 'ready' | 'waiting_ddns' }
  > {
    return readiness.status === 'ready' || readiness.status === 'waiting_ddns';
  }

  /** 判断重复键错误是否成立。 */
  private isDuplicateKeyError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const record = error as { code?: unknown; errno?: unknown };
    return record.code === 'ER_DUP_ENTRY' || record.errno === 1062;
  }

  /** 返回安全消息。 */
  private safeMessage(error: SystemMessageContractError): string {
    return error.message.slice(0, 500);
  }
}

class EventResourceMismatchError extends Error {
  constructor() {
    super('validated source identity does not match event resource');
  }
}
