import { Injectable, Logger } from '@nestjs/common';
import { Brackets, DataSource, In, type EntityManager } from 'typeorm';
import { KtDateTime } from '@/common';
import {
  SystemMessageContractError,
  type SystemMessageSourceAdapter,
} from '../contract/message-management.types';
import { MessageEvent } from '../infrastructure/persistence/message-event.entity';
import { MessageSubscription } from '../infrastructure/persistence/message-subscription.entity';
import { MessageSubscriptionTemplate } from '../infrastructure/persistence/message-subscription-template.entity';
import { MessageTemplate } from '../infrastructure/persistence/message-template.entity';
import {
  SYSTEM_MESSAGE_BATCH_SIZE,
  SYSTEM_MESSAGE_DEFERRED_RECHECK_MS,
  SYSTEM_MESSAGE_LEASE_MS,
  SYSTEM_MESSAGE_RETRY_BASE_MS,
  SYSTEM_MESSAGE_RETRY_MAX_MS,
  SYSTEM_MESSAGE_RETRY_WINDOW_MS,
} from './system-message-runner.constants';
import type {
  MessageSubscriberReceipt,
  UnifiedMessageEnvelope,
  UnifiedMessageReference,
  UnifiedMessageTemplate,
} from './subscriber/message-subscriber.adapter';
import { MessageSubscriberRegistry } from './subscriber/message-subscriber.registry';
import { SystemMessageSourceRegistry } from './system-message-source.registry';
import { SystemMessageTemplateRendererService } from './system-message-template-renderer.service';

const TRANSIENT_ERROR_CODE = 'fanout_transient_error';
const EVENT_EXPIRED_ERROR_CODE = 'fanout_expired';
const EVENT_RESOURCE_MISMATCH_ERROR_CODE = 'event_resource_mismatch';

interface ClaimToken {
  attempt: number;
  event: MessageEvent;
  leaseUntil: KtDateTime;
}

type SubscriptionFanOutOutcome =
  | { kind: 'deferred'; reasonCode: string }
  | { kind: 'handled'; receipt?: MessageSubscriberReceipt | void }
  | { kind: 'stale_claim' };

@Injectable()
export class SystemMessageFanoutService {
  private readonly logger = new Logger(SystemMessageFanoutService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly sourceRegistry: SystemMessageSourceRegistry,
    private readonly subscriberRegistry: MessageSubscriberRegistry,
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
   * 将全部等待消息源条件的事件推进到当前时间，由消息管理重新完成来源适配和统一封装。
   * @param now - 依赖变化发生后允许重新领取事件的时间基准。
   * @returns 被提前唤醒的延迟事件数量。
   */
  async wakeDeferred(now: Date = new Date()): Promise<number> {
    const result = await this.dataSource
      .getRepository(MessageEvent)
      .update(
        { fanoutStatus: 'deferred' },
        { nextFanoutAt: new KtDateTime(now) },
      );
    return result.affected || 0;
  }

  /**
   * 在悲观锁事务中跳过已锁记录，领取最早到期的事件或投递并写入新的处理租约。
   * @param now - 用于过期、排序或租约判定的时间基准。
   * @returns 返回带新租约的事件或投递令牌；没有到期记录时为 `null`。
   */
  private async claimOne(now: Date): Promise<ClaimToken | null> {
    return this.dataSource.transaction(async (manager) => {
      const events = manager.getRepository(MessageEvent);
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
                    { due: ['accepted', 'deferred', 'retry'], now },
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
      let deferredReasonCode: null | string = null;

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
          if (outcome.kind === 'stale_claim') return;
          if (outcome.kind === 'deferred') {
            deferredReasonCode = outcome.reasonCode;
          }
          if (outcome.kind === 'handled') {
            await this.runAfterCommit(outcome.receipt);
          }
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
      if (deferredReasonCode) {
        await this.defer(token, now, deferredReasonCode);
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
    event: MessageEvent,
    adapter: SystemMessageSourceAdapter,
  ): Promise<MessageSubscription[]> {
    const templates = await this.dataSource
      .getRepository(MessageTemplate)
      .find({
        select: { id: true },
        where: {
          enabled: true,
          isDeleted: false,
          sourceKey: event.sourceKey,
        },
      });
    if (templates.length === 0) return [];
    const bindings = await this.dataSource
      .getRepository(MessageSubscriptionTemplate)
      .find({
        select: { subscriptionId: true },
        where: { templateId: In(templates.map((template) => template.id)) },
      });
    if (bindings.length === 0) return [];
    const subscriptions = await this.dataSource
      .getRepository(MessageSubscription)
      .find({
        where: {
          enabled: true,
          id: In([
            ...new Set(bindings.map((binding) => binding.subscriptionId)),
          ]),
          isDeleted: false,
        },
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
   * @returns 消息源已转换、等待依赖或租约失效的统一处理结果。
   */
  private async fanOutSubscription(
    manager: EntityManager,
    token: ClaimToken,
    subscriptionId: string,
    adapter: SystemMessageSourceAdapter,
    now: Date,
  ): Promise<SubscriptionFanOutOutcome> {
    const events = manager.getRepository(MessageEvent);
    const event = await events.findOne({
      where: { id: token.event.id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!event || !this.ownsClaim(event, token)) {
      return { kind: 'stale_claim' };
    }

    const subscriptions = manager.getRepository(MessageSubscription);
    const subscription = await subscriptions.findOne({
      where: { id: subscriptionId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!subscription) return { kind: 'handled' };
    const templates = await this.findSubscriptionTemplates(
      manager,
      subscription.id,
      event.sourceKey,
    );
    if (templates.length === 0) return { kind: 'handled' };
    const subscriber = this.subscriberRegistry.require(
      subscription.subscriberKey,
    );

    const superseded = await this.hasStrictlyNewerEvent(manager, event);
    if (superseded) {
      const receipt = await subscriber.receive({
        lifecycle: 'supersede',
        manager,
        message: this.toReference(event, subscription),
        now,
      });
      return { kind: 'handled', receipt };
    }

    if (!this.matchesSubscription(subscription, event, adapter)) {
      return { kind: 'handled' };
    }

    const payload = adapter.validateEventPayload(event.payload);
    this.assertResourceIdentity(event, adapter.eventResourceKey(payload));
    const readiness = await adapter.resolveDelivery({
      eventPayload: payload,
      subscriptionConfig: subscription.sourceConfig,
    });
    if (readiness.status === 'deferred') {
      return { kind: 'deferred', reasonCode: readiness.reasonCode };
    }
    if (readiness.status === 'cancelled') {
      const receipt = await subscriber.receive({
        lifecycle: 'cancel',
        manager,
        message: this.toReference(event, subscription),
        now,
      });
      return { kind: 'handled', receipt };
    }
    if (readiness.status === 'superseded') {
      const receipt = await subscriber.receive({
        lifecycle: 'supersede',
        manager,
        message: this.toReference(event, subscription),
        now,
      });
      return { kind: 'handled', receipt };
    }
    const variables = structuredClone(readiness.variables);
    const supersededMessageEventIds = await this.findStrictlyEarlierEventIds(
      manager,
      event,
    );
    const renderedTemplates: UnifiedMessageTemplate[] = templates.map(
      ({ binding, template }) => ({
        renderedMessage: this.templateRenderer.render(
          template.content,
          variables,
        ),
        sortOrder: binding.sortOrder,
        templateContent: template.content,
        templateId: String(template.id),
        templateName: template.name,
      }),
    );
    const receipt = await subscriber.receive({
      lifecycle: 'deliver',
      manager,
      message: this.toEnvelope(
        event,
        subscription,
        renderedTemplates,
        variables,
        supersededMessageEventIds,
      ),
      now,
    });
    return { kind: 'handled', receipt };
  }

  /**
   * 在订阅者事务已经提交后执行其可选副作用，失败时仅记录告警而不回滚已落库投递。
   * @param receipt - 订阅者返回的提交后回执；未声明回调时无需执行额外动作。
   */
  private async runAfterCommit(
    receipt?: MessageSubscriberReceipt | void,
  ): Promise<void> {
    if (!receipt || !receipt.afterCommit) return;
    try {
      await receipt.afterCommit();
    } catch (error) {
      this.logger.warn(
        `message subscriber afterCommit failed: ${this.safeMessage(error)}`,
      );
    }
  }

  /**
   * 加载订阅绑定的全部有序模板，并在任一模板缺失、禁用或不同源时拒绝部分转换。
   * @param manager - 与统一消息扇出共享事务的实体管理器。
   * @param subscriptionId - 需要解析模板集合的消息订阅标识。
   * @param sourceKey - 当前消息事件已经由消息管理适配的来源键。
   * @returns 全部可转换时返回有序关联与模板；否则返回空数组。
   */
  private async findSubscriptionTemplates(
    manager: EntityManager,
    subscriptionId: string,
    sourceKey: string,
  ): Promise<
    Array<{
      binding: MessageSubscriptionTemplate;
      template: MessageTemplate;
    }>
  > {
    const bindings = await manager
      .getRepository(MessageSubscriptionTemplate)
      .find({
        order: { sortOrder: 'ASC' },
        where: { subscriptionId },
      });
    if (bindings.length === 0) return [];
    const templates = await manager.getRepository(MessageTemplate).find({
      where: {
        enabled: true,
        id: In(bindings.map((binding) => binding.templateId)),
        isDeleted: false,
        sourceKey,
      },
    });
    if (templates.length !== bindings.length) return [];
    const templateById = new Map(
      templates.map((template) => [String(template.id), template]),
    );
    const result: Array<{
      binding: MessageSubscriptionTemplate;
      template: MessageTemplate;
    }> = [];
    for (const binding of bindings) {
      const template = templateById.get(binding.templateId);
      if (!template) return [];
      result.push({ binding, template });
    }
    return result;
  }

  /**
   * 将事件和订阅身份投影为取消或取代通知使用的统一消息引用。
   * @param event - 已通过消息源适配器验证身份的通用消息事件。
   * @param subscription - 声明唯一订阅者的消息订阅。
   * @returns 不包含模板正文或消息源适配器实现的统一消息引用。
   */
  private toReference(
    event: MessageEvent,
    subscription: MessageSubscription,
  ): UnifiedMessageReference {
    return {
      eventId: event.eventId,
      messageEventId: String(event.id),
      occurredAt: new Date(event.occurredAt),
      resourceKey: event.resourceKey,
      sourceKey: event.sourceKey,
      subscriberKey: subscription.subscriberKey,
      subscriptionId: String(subscription.id),
    };
  }

  /**
   * 将消息源事件、订阅及其绑定模板投影为订阅者共同消费的统一消息封装。
   * @param event - 已通过消息源适配器验证身份的通用消息事件。
   * @param subscription - 直接绑定模板和订阅者的消息订阅。
   * @param templates - 消息管理已全部转换完成的有序模板结果集。
   * @param variables - 消息源适配器输出的标准标量变量。
   * @param supersededMessageEventIds - 由消息管理排序后判定应被当前事件取代的历史事件标识。
   * @returns 不暴露消息源适配器实现的统一消息封装。
   */
  private toEnvelope(
    event: MessageEvent,
    subscription: MessageSubscription,
    templates: UnifiedMessageTemplate[],
    variables: Record<string, boolean | number | string>,
    supersededMessageEventIds: string[],
  ): UnifiedMessageEnvelope {
    return {
      ...this.toReference(event, subscription),
      supersededMessageEventIds: [...supersededMessageEventIds],
      templates: structuredClone(templates),
      variables: structuredClone(variables),
    };
  }

  /**
   * 由消息管理按来源资源、发生时间和雪花标识找出严格早于当前事件的历史事件。
   * @param manager - 与统一消息扇出共享事务的实体管理器。
   * @param event - 当前正在转换为统一消息的事件。
   * @returns 应由各消息订阅者标记为已取代的历史消息事件标识。
   */
  private async findStrictlyEarlierEventIds(
    manager: EntityManager,
    event: MessageEvent,
  ): Promise<string[]> {
    const candidates = await manager.getRepository(MessageEvent).find({
      where: {
        resourceKey: event.resourceKey,
        sourceKey: event.sourceKey,
      },
    });
    return candidates
      .filter((candidate) => {
        const difference =
          candidate.occurredAt.getTime() - event.occurredAt.getTime();
        if (difference < 0) return true;
        if (difference > 0) return false;
        return BigInt(candidate.id) < BigInt(event.id);
      })
      .map((candidate) => String(candidate.id));
  }

  /**
   * 根据`manager`、`event`与当前约束判定严格地更新的事件是否存在；从 `getOne` 读取严格地更新的事件是否存在。
   * @param manager - 保证严格地更新的事件是否存在读写处于同一事务中的实体管理器。
   * @param event - 触发严格地更新的事件是否存在的领域事件，包含 `resourceKey`、`sourceKey`、`occurredAt`、`id` 字段。
   * @returns 满足严格地更新的事件是否存在约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private async hasStrictlyNewerEvent(
    manager: EntityManager,
    event: MessageEvent,
  ): Promise<boolean> {
    const newerEvent = await manager
      .getRepository(MessageEvent)
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
    await this.dataSource.getRepository(MessageEvent).update(
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
    await this.dataSource.getRepository(MessageEvent).update(
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
   * 将尚未满足消息源条件的事件保留在消息管理队列，订阅者在统一消息形成前不会收到它。
   * @param token - 当前消息事件的租约所有权令牌。
   * @param now - 计算下次通用来源检查的时间基准。
   * @param reasonCode - 消息源适配器返回的稳定延迟原因。
   */
  private async defer(
    token: ClaimToken,
    now: Date,
    reasonCode: string,
  ): Promise<void> {
    const next = new KtDateTime(
      now.getTime() + SYSTEM_MESSAGE_DEFERRED_RECHECK_MS,
    );
    const deadline =
      token.event.occurredAt.getTime() + SYSTEM_MESSAGE_RETRY_WINDOW_MS;
    if (next.getTime() >= deadline) {
      await this.finish(
        token,
        'failed',
        EVENT_EXPIRED_ERROR_CODE,
        'fan-out deadline reached',
      );
      return;
    }
    await this.dataSource.getRepository(MessageEvent).update(
      {
        fanoutAttemptCount: token.attempt,
        fanoutLeaseUntil: token.leaseUntil,
        fanoutStatus: 'processing',
        id: token.event.id,
      },
      {
        fanoutLeaseUntil: null,
        fanoutStatus: 'deferred',
        lastErrorCode: reasonCode,
        lastErrorMessage: 'message source dependency is not ready',
        nextFanoutAt: next,
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
    event: MessageEvent,
    resourceKey: string,
  ): void {
    if (resourceKey !== event.resourceKey) {
      throw new EventResourceMismatchError();
    }
  }

  /**
   * 通过使用消息源适配器自己的资源键规则匹配订阅。
   * @param subscription - 由绑定模板筛选到当前消息源的消息订阅。
   * @param event - 触发通过使用消息源适配器自己的资源键规则匹配订阅的领域事件，包含 `sourceKey`、`resourceKey` 字段。
   * @param adapter - 用于通过使用消息源适配器自己的资源键规则匹配订阅的领域对象，包含 `subscriptionResourceKey` 字段。
   * @returns 满足通过使用消息源适配器自己的资源键规则匹配订阅约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private matchesSubscription(
    subscription: MessageSubscription,
    event: MessageEvent,
    adapter: SystemMessageSourceAdapter,
  ): boolean {
    const config = subscription.sourceConfig;
    return (
      subscription.enabled &&
      !subscription.isDeleted &&
      !!config &&
      adapter.subscriptionResourceKey(config) === event.resourceKey
    );
  }

  /**
   * 根据`event`、`now`与当前约束判定已过期的；从 `now.getTime` 读取已过期的。
   * @param event - 触发已过期的的领域事件，包含 `occurredAt` 字段。
   * @param now - 用于过期、排序或租约判定的时间基准。
   * @returns 满足已过期的约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isExpired(event: MessageEvent, now: Date): boolean {
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
  private ownsClaim(event: MessageEvent, token: ClaimToken): boolean {
    return (
      event.id === token.event.id &&
      event.fanoutStatus === 'processing' &&
      event.fanoutAttemptCount === token.attempt &&
      !!event.fanoutLeaseUntil &&
      event.fanoutLeaseUntil.getTime() === token.leaseUntil.getTime()
    );
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
