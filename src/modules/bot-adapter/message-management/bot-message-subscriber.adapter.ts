import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { In, type EntityManager } from 'typeorm';
import { KtDateTime } from '@/common';
import type {
  MessageSubscriberAdapter,
  MessageSubscriberInput,
  MessageSubscriberReceipt,
  MessageSubscriberSubscriptionCancellation,
  UnifiedMessageTemplate,
} from '@/modules/message-management/application/subscriber/message-subscriber.adapter';
import { MessageSubscriberRegistry } from '@/modules/message-management/application/subscriber/message-subscriber.registry';
import { SYSTEM_MESSAGE_RETRY_WINDOW_MS } from '@/modules/message-management/application/system-message-runner.constants';
import {
  BotAccountExtensionRegistry,
  type BotAccountExtension,
} from '@/modules/bot-adapter/core/application/account/bot-account-extension.registry';
import { BotAccount } from '@/modules/bot-adapter/core/infrastructure/persistence/account/bot-account.entity';
import { BotMessageDelivery } from './bot-message-delivery.entity';
import { SystemMessageDeliveryRunnerService } from './bot-message-delivery-runner.service';
import { BotMessagePublishBinding } from './bot-message-publish-binding.entity';
import { BotMessagePublishTarget } from './bot-message-publish-target.entity';
import type { BotMessageDeliveryStatus } from './bot-message-subscriber.types';

const SUPERSEDED_STATUSES = ['pending', 'retry'];

@Injectable()
export class BotMessageSubscriberAdapter
  implements
    MessageSubscriberAdapter,
    OnModuleDestroy,
    OnModuleInit,
    BotAccountExtension
{
  readonly definition = {
    description: '通过 Bot 账号和 OneBot 目标投递统一消息',
    displayName: 'Bot',
    subscriberKey: 'bot',
    version: 1 as const,
  };
  readonly extensionKey = 'message-management';

  constructor(
    private readonly subscriberRegistry: MessageSubscriberRegistry,
    private readonly accountExtensionRegistry: BotAccountExtensionRegistry,
    private readonly deliveryRunner: SystemMessageDeliveryRunnerService,
  ) {}

  onModuleInit(): void {
    this.subscriberRegistry.register(this);
    this.accountExtensionRegistry.register(this);
  }

  onModuleDestroy(): void {
    this.subscriberRegistry.unregister(this);
    this.accountExtensionRegistry.unregister(this);
  }

  /**
   * 将订阅停用或身份变化映射为 Bot 私有未完成投递的取消状态。
   * @param manager - 与消息订阅变更共享事务的实体管理器。
   * @param input - 待取消订阅及是否包含处理中投递的约束。
   */
  async cancelSubscriptionDeliveries(
    manager: EntityManager,
    input: MessageSubscriberSubscriptionCancellation,
  ): Promise<void> {
    const statuses: BotMessageDeliveryStatus[] = ['pending', 'retry'];
    if (input.includeProcessing) statuses.push('processing');
    await manager.getRepository(BotMessageDelivery).update(
      {
        status: In(statuses),
        subscriptionId: input.subscriptionId,
      },
      {
        nextAttemptAt: null,
        processingLeaseUntil: null,
        status: 'cancelled',
      },
    );
  }

  /**
   * 账号停用或删除时把该账号的 `pending/retry` 私有投递转为 `cancelled`，通用消息事件保持不变。
   * @param manager - 与 Bot 账号变更共享事务的实体管理器。
   * @param accountId - 需要清理消息订阅资源的 Bot 账号标识。
   */
  async cancelAccountResources(
    manager: EntityManager,
    accountId: string,
  ): Promise<void> {
    const bindings = await manager
      .getRepository(BotMessagePublishBinding)
      .find({
        select: { id: true },
        where: { accountId: String(accountId) },
      });
    if (bindings.length === 0) return;
    await manager.getRepository(BotMessageDelivery).update(
      {
        bindingId: In(bindings.map((binding) => binding.id)),
        status: In(['pending', 'retry']),
      },
      {
        nextAttemptAt: null,
        processingLeaseUntil: null,
        status: 'cancelled',
      },
    );
  }

  /**
   * 接收消息管理已转换的全部模板结果，并按 Bot 私有目标策略生成投递快照。
   * @param input - 统一消息或其取消、取代引用，以及共享事务上下文。
   */
  async receive(
    input: MessageSubscriberInput,
  ): Promise<MessageSubscriberReceipt | void> {
    if (input.lifecycle === 'supersede') {
      await this.supersedeCurrentEventDeliveries(
        input.manager,
        input.message.messageEventId,
        input.message.subscriptionId,
      );
      return;
    }
    if (input.lifecycle === 'cancel') {
      await this.cancelCurrentEventDeliveries(
        input.manager,
        input.message.messageEventId,
        input.message.subscriptionId,
      );
      return;
    }
    await this.supersedeMessageDeliveries(
      input.manager,
      input.message.supersededMessageEventIds,
      input.message.subscriptionId,
    );
    await this.createDeliveries(input);
  }

  /**
   * 在通用订阅删除或切换订阅者前检查 Bot 私有绑定，防止账号配置成为悬空引用。
   * @param manager - 执行引用查询的实体管理器。
   * @param subscriptionId - 需要检查的通用消息订阅标识。
   * @returns 存在至少一个 Bot 有效配置时返回 true。
   */
  async hasSubscriptionReferences(
    manager: EntityManager,
    subscriptionId: string,
  ): Promise<boolean> {
    const count = await manager.getRepository(BotMessagePublishBinding).count({
      where: { isDeleted: false, subscriptionId },
    });
    return count > 0;
  }

  /**
   * 委托 Bot 私有执行器在当前批次内发送已冻结投递。
   * @param now - 本轮租约、重试与过期判断的统一时间基准。
   * @returns 本轮 Bot 实际领取的投递数量。
   */
  runOnce(now: Date): Promise<number> {
    return this.deliveryRunner.runOnce(now);
  }

  /**
   * 将同一事件与订阅下尚未完成的 Bot 投递标记为已被取代。
   * @param manager - 执行 Bot 投递状态更新的实体管理器。
   * @param eventId - 被取代的通用消息事件标识。
   * @param subscriptionId - 与事件匹配的通用消息订阅标识。
   */
  private async supersedeCurrentEventDeliveries(
    manager: EntityManager,
    eventId: string,
    subscriptionId: string,
  ): Promise<void> {
    await manager.getRepository(BotMessageDelivery).update(
      {
        messageEventId: eventId,
        status: In(SUPERSEDED_STATUSES),
        subscriptionId,
      },
      { status: 'superseded' },
    );
  }

  /**
   * 将统一协议列出的历史事件对应 Bot 投递标记为已被当前消息取代。
   * @param manager - 与统一消息路由共享事务的实体管理器。
   * @param messageEventIds - 消息管理已完成顺序判定的历史事件标识。
   * @param subscriptionId - 当前统一消息匹配的订阅标识。
   */
  private async supersedeMessageDeliveries(
    manager: EntityManager,
    messageEventIds: string[],
    subscriptionId: string,
  ): Promise<void> {
    if (messageEventIds.length === 0) return;
    await manager.getRepository(BotMessageDelivery).update(
      {
        messageEventId: In(messageEventIds),
        status: In(SUPERSEDED_STATUSES),
        subscriptionId,
      },
      { status: 'superseded' },
    );
  }

  /**
   * 将统一协议明确取消的当前消息对应 Bot 未完成投递标记为已取消。
   * @param manager - 与统一消息路由共享事务的实体管理器。
   * @param eventId - 被取消的通用消息事件标识。
   * @param subscriptionId - 与事件匹配的通用消息订阅标识。
   */
  private async cancelCurrentEventDeliveries(
    manager: EntityManager,
    eventId: string,
    subscriptionId: string,
  ): Promise<void> {
    await manager.getRepository(BotMessageDelivery).update(
      {
        messageEventId: eventId,
        status: In(SUPERSEDED_STATUSES),
        subscriptionId,
      },
      { status: 'cancelled' },
    );
  }

  /**
   * 对每个有效 Bot 账号目标逐一处理统一消息中的全部已转换模板。
   * @param input - 仅包含 deliver 生命周期的统一消息输入。
   */
  private async createDeliveries(
    input: Extract<MessageSubscriberInput, { lifecycle: 'deliver' }>,
  ): Promise<void> {
    const bindings = await input.manager
      .getRepository(BotMessagePublishBinding)
      .find({
        order: { id: 'ASC' },
        where: {
          enabled: true,
          isDeleted: false,
          subscriptionId: input.message.subscriptionId,
        },
      });
    const accounts = await input.manager.getRepository(BotAccount).find({
      where: { enabled: true, isDeleted: false },
    });
    const targets = await input.manager
      .getRepository(BotMessagePublishTarget)
      .find({
        order: { id: 'ASC' },
        where: { enabled: true, isDeleted: false },
      });
    const accountById = new Map(
      accounts.map((account) => [account.id, account]),
    );

    for (const binding of bindings) {
      const account = accountById.get(binding.accountId);
      if (!account || account.selfId !== binding.selfId) continue;
      for (const target of targets.filter(
        (item) => item.bindingId === binding.id,
      )) {
        if (target.targetType !== 'group' && target.targetType !== 'private') {
          continue;
        }
        for (const template of input.message.templates) {
          await this.createDeliveryIfAbsent(input, binding, template, target);
        }
      }
    }
  }

  /**
   * 按事件、Bot 目标和模板唯一键冻结一条私有投递，并把并发冲突视为幂等成功。
   * @param input - 消息管理已经转换全部模板的统一消息输入。
   * @param binding - Bot 账号与通用订阅的私有配置。
   * @param template - 消息管理已经转换完成的单个模板结果。
   * @param target - QQ 群聊或私聊发布目标。
   * @throws 保存失败且不能确认同一事件、目标、模板记录已存在时重新抛出数据库异常。
   */
  private async createDeliveryIfAbsent(
    input: Extract<MessageSubscriberInput, { lifecycle: 'deliver' }>,
    binding: BotMessagePublishBinding,
    template: UnifiedMessageTemplate,
    target: BotMessagePublishTarget,
  ): Promise<void> {
    const deliveries = input.manager.getRepository(BotMessageDelivery);
    const key = {
      messageEventId: input.message.messageEventId,
      publishTargetId: target.id,
      templateId: template.templateId,
    };
    if (await deliveries.findOne({ where: key })) return;
    const delivery = deliveries.create({
      attemptCount: 0,
      bindingId: binding.id,
      expiresAt: new KtDateTime(
        input.message.occurredAt.getTime() + SYSTEM_MESSAGE_RETRY_WINDOW_MS,
      ),
      lastErrorCode: null,
      lastErrorMessage: null,
      messageEventId: input.message.messageEventId,
      nextAttemptAt: new KtDateTime(input.now),
      processingLeaseUntil: null,
      publishTargetId: target.id,
      renderedMessage: template.renderedMessage,
      selfId: binding.selfId,
      sendLogId: null,
      status: 'pending',
      subscriptionId: input.message.subscriptionId,
      targetId: target.targetId,
      targetType: target.targetType,
      templateContent: template.templateContent,
      templateId: template.templateId,
      variableSnapshot: structuredClone(input.message.variables),
    });
    try {
      await deliveries.save(delivery);
    } catch (error) {
      if (!this.isDuplicateKeyError(error)) throw error;
      const existing = await deliveries.findOne({
        lock: { mode: 'pessimistic_read' },
        where: key,
      });
      if (!existing) throw error;
    }
  }

  /**
   * 仅识别 MySQL 唯一键冲突，使其他数据库异常继续暴露给消息管理重试策略。
   * @param error - 订阅者持久化捕获的未知异常。
   * @returns 异常属于 MySQL 唯一键冲突时返回 true。
   */
  private isDuplicateKeyError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const record = error as { code?: unknown; errno?: unknown };
    return record.code === 'ER_DUP_ENTRY' || record.errno === 1062;
  }
}
