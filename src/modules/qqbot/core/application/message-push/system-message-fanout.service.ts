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

  /**
   * 在单批上限内依次领取并处理到期记录，队列暂空时提前停止并返回实际领取数量。
   * @param now - 用于过期、排序或租约判定的时间基准；省略时默认采用 `new Date()`。
   * @returns 返回本轮实际领取的记录数量；队列暂空时可为 `0`。
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
   * 在悲观锁事务中跳过已锁记录，领取最早到期的事件或投递并写入新的处理租约。
   * @param now - 用于过期、排序或租约判定的时间基准。
   * @returns 返回带新租约的事件或投递令牌；没有到期记录时为 `null`。
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

  /**
   * 处理当前租约领取的消息记录，在过期、失去所有权或业务失败时结束、重试或标记失败。
   * @param token - 用于当前租约领取的消息记录，在过期、失去所有权或业务失败时结束、重试或标记失败的领域对象，包含 `event` 字段。
   * @param now - 用于过期、排序或租约判定的时间基准。
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

  /**
   * 按`event`、`adapter`读取匹配的订阅；从 `dataSource.getRepository` 读取匹配的订阅。
   * @param event - 触发匹配的订阅的领域事件，包含 `sourceKey` 字段。
   * @param adapter - 决定匹配的订阅内容、边界或目标的 `adapter` 值。
   * @returns 按输入顺序得到的匹配的订阅列表；没有匹配项时为空数组。
   */
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

  /**
   * 把单个事件按有效订阅扇出为投递记录。
   * @param manager - 保证把单个事件按有效订阅扇出为投递记录读写处于同一事务中的实体管理器。
   * @param token - 用于把单个事件按有效订阅扇出为投递记录的领域对象，包含 `event` 字段。
   * @param subscriptionId - 用于精确定位订阅的标识。
   * @param adapter - 用于把单个事件按有效订阅扇出为投递记录的领域对象，包含 `validateEventPayload`、`eventResourceKey`、`resolveDelivery` 字段。
   * @param now - 用于过期、排序或租约判定的时间基准。
   * @returns 当前状态对应的把单个事件按有效订阅扇出为投递记录，取值为 `'stale_claim'`、`'handled'`。
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

  /**
   * 根据`manager`、`event`与当前约束判定严格地更新的事件是否存在；从 `getOne` 读取严格地更新的事件是否存在。
   * @param manager - 保证严格地更新的事件是否存在读写处于同一事务中的实体管理器。
   * @param event - 触发严格地更新的事件是否存在的领域事件，包含 `resourceKey`、`sourceKey`、`occurredAt`、`id` 字段。
   * @returns 满足严格地更新的事件是否存在约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
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

  /**
   * 取代当前事件投递记录。
   * @param manager - 保证取代当前事件投递记录读写处于同一事务中的实体管理器。
   * @param event - 触发取代当前事件投递记录的领域事件，包含 `id` 字段。
   * @param subscriptionId - 用于精确定位订阅的标识。
   */
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

  /**
   * 根据`manager`、`event`、`subscriptionId`处理取代更早投递记录；从 `manager.getRepository` 读取取代更早投递记录。
   * @param manager - 保证取代更早投递记录读写处于同一事务中的实体管理器。
   * @param event - 触发取代更早投递记录的领域事件，包含 `resourceKey`、`sourceKey` 字段。
   * @param subscriptionId - 用于精确定位订阅的标识。
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

  /**
   * 根据`manager`、`event`、`subscription`构造投递记录；从 `manager.getRepository` 读取投递记录。
   * @param manager - 保证投递记录读写处于同一事务中的实体管理器。
   * @param event - 触发投递记录的领域事件，包含 `sourceKey` 字段。
   * @param subscription - 用于投递记录的领域对象，包含 `id` 字段。
   * @param readiness - 用于投递记录的领域对象，包含 `variables` 字段。
   * @param now - 用于过期、排序或租约判定的时间基准。
   * @throws 当 `templateRenderer.render` 调用失败时重新抛出该入口捕获且决定公开的原异常。
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
   * 在订阅、事件与目标组合尚无投递记录时创建待处理投递，并把唯一键并发冲突视为已存在。
   * @param manager - 保证DeliveryIfAbsent读写处于同一事务中的实体管理器。
   * @param event - 触发DeliveryIfAbsent的领域事件，包含 `id`、`occurredAt` 字段。
   * @param subscription - 用于DeliveryIfAbsent的领域对象，包含 `id` 字段。
   * @param binding - 用于DeliveryIfAbsent的领域对象，包含 `id`、`selfId` 字段。
   * @param template - 用于DeliveryIfAbsent的领域对象，包含 `content`、`id` 字段。
   * @param target - 用于DeliveryIfAbsent的领域对象，包含 `id`、`targetId`、`targetType` 字段。
   * @param readiness - 用于DeliveryIfAbsent的领域对象，包含 `status`、`variables` 字段。
   * @param renderedMessage - 包含正文、发送目标与账号身份的待处理消息。
   * @param now - 用于过期、排序或租约判定的时间基准。
   * @throws 当 `!this.isDuplicateKeyError(error)` 成立时重新抛出该入口捕获且决定公开的原异常；当 `!existing` 成立时重新抛出该入口捕获且决定公开的原异常。
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
        now.getTime() + ((() => {
          if (isWaiting) {
            return SYSTEM_MESSAGE_DDNS_RECHECK_MS;
          }
          return 0;
        })()),
      ),
      processingLeaseUntil: null,
      publishTargetId: target.id,
      renderedMessage,
      selfId: binding.selfId,
      sendLogId: null,
      status: (() => {
        if (isWaiting) {
          return 'waiting_ddns';
        }
        return 'pending';
      })(),
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
   * 仅在当前租约条件仍匹配时把消息事件或投递更新为指定终态，避免旧执行者覆盖新租约。
   * @param token - 用于仅在当前租约条件仍匹配时把消息事件或投递更新为指定终态，避免旧执行者覆盖新租约的领域对象，包含 `attempt`、`leaseUntil`、`event` 字段。
   * @param status - 决定仅在当前租约条件仍匹配时把消息事件或投递更新为指定终态，避免旧执行者覆盖新租约内容、边界或目标的 `status` 值。
   * @param code - 决定仅在当前租约条件仍匹配时把消息事件或投递更新为指定终态，避免旧执行者覆盖新租约内容、边界或目标的 `code` 值。
   * @param message - 包含正文、发送目标与账号身份的待处理消息。
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
   * 按尝试次数计算下一次执行时间；超过事件或投递期限时直接标记失败，否则安排重试。
   * @param token - 用于按尝试次数计算下一次执行时间的领域对象，包含 `attempt`、`event`、`leaseUntil` 字段。
   * @param now - 用于过期、排序或租约判定的时间基准。
   * @param code - 决定按尝试次数计算下一次执行时间内容、边界或目标的 `code` 值。
   * @param message - 包含正文、发送目标与账号身份的待处理消息。
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
   * 根据参数 `event`，确认适配器解析的事件资源与冻结事件身份一致。
   * @param event - 触发根据参数 `event`，确认适配器解析的事件资源与冻结事件身份一致的领域事件，包含 `resourceKey` 字段。
   * @param resourceKey - 用于读取或更新根据参数 `event`，确认适配器解析的事件资源与冻结事件身份一致的稳定键。
   * @throws 当 `resourceKey !== event.resourceKey` 成立时拒绝当前输入并抛出 `EventResourceMismatchError`。
   */
  private assertResourceIdentity(
    event: QqbotMessageEvent,
    resourceKey: string,
  ): void {
    if (resourceKey !== event.resourceKey) {
      throw new EventResourceMismatchError();
    }
  }

  /**
   * 通过使用消息源适配器自己的资源键规则匹配订阅。
   * @param subscription - 用于通过使用消息源适配器自己的资源键规则匹配订阅的领域对象，包含 `sourceConfig`、`enabled`、`isDeleted`、`sourceKey` 字段。
   * @param event - 触发通过使用消息源适配器自己的资源键规则匹配订阅的领域事件，包含 `sourceKey`、`resourceKey` 字段。
   * @param adapter - 用于通过使用消息源适配器自己的资源键规则匹配订阅的领域对象，包含 `subscriptionResourceKey` 字段。
   * @returns 满足通过使用消息源适配器自己的资源键规则匹配订阅约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
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

  /**
   * 根据`candidate`、`current`与当前约束判定严格地更早；从 `candidate.occurredAt.getTime` 读取严格地更早。
   * @param candidate - 决定是否启用“candidate”分支的布尔选项。
   * @param current - 用于严格地更早的领域对象，包含 `occurredAt`、`id` 字段。
   * @returns 满足严格地更早约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
   * 根据`event`、`now`与当前约束判定已过期的；从 `now.getTime` 读取已过期的。
   * @param event - 触发已过期的的领域事件，包含 `occurredAt` 字段。
   * @param now - 用于过期、排序或租约判定的时间基准。
   * @returns 满足已过期的约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isExpired(event: QqbotMessageEvent, now: Date): boolean {
    return (
      now.getTime() >=
      event.occurredAt.getTime() + SYSTEM_MESSAGE_RETRY_WINDOW_MS
    );
  }

  /**
   * 按租约标识和到期时间判定当前执行权。
   * @param event - 触发按租约标识和到期时间判定当前执行权的领域事件，包含 `id`、`fanoutStatus`、`fanoutAttemptCount`、`fanoutLeaseUntil` 字段。
   * @param token - 用于按租约标识和到期时间判定当前执行权的领域对象，包含 `event`、`attempt`、`leaseUntil` 字段。
   * @returns 满足按租约标识和到期时间判定当前执行权约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
   * 根据`readiness`与当前约束判定可渲染的变量是否存在。
   * @param readiness - 用于可渲染的变量是否存在的领域对象，包含 `status` 字段。
   * @returns 满足可渲染的变量是否存在约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
   * 仅把 MySQL `ER_DUP_ENTRY` 或错误号 1062 识别为唯一键冲突，其他错误一律返回 `false`。
   * @param error - 待转换为稳定业务错误或日志文本的未知异常。
   * @returns 满足Duplicate键错误约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isDuplicateKeyError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const record = error as { code?: unknown; errno?: unknown };
    return record.code === 'ER_DUP_ENTRY' || record.errno === 1062;
  }

  /**
   * 截断并返回可持久化的安全错误消息。
   * @param error - 待转换为稳定业务错误或日志文本的未知异常。
   * @returns 截断并返回可持久化的安全错误消息。
   */
  private safeMessage(error: SystemMessageContractError): string {
    return error.message.slice(0, 500);
  }
}

class EventResourceMismatchError extends Error {
  constructor() {
    super('validated source identity does not match event resource');
  }
}
