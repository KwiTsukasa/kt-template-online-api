import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type {
  MessageSubscriberAdapter,
  MessageSubscriberInput,
  MessageSubscriberReceipt,
} from '@/modules/message-management/application/subscriber/message-subscriber.adapter';
import { MessageSubscriberRegistry } from '@/modules/message-management/application/subscriber/message-subscriber.registry';
import { AdminNoticeEventStreamService } from './admin-notice-event-stream.service';
import { AdminNoticeService } from './admin-notice.service';
import { StationNoticeMessageBinding } from './station-notice-message-binding.entity';

@Injectable()
export class StationNoticeMessageSubscriberAdapter
  implements MessageSubscriberAdapter, OnModuleDestroy, OnModuleInit
{
  readonly definition = {
    description: '将统一消息按角色写入管理端站内信',
    displayName: '站内信',
    subscriberKey: 'station-notice',
    version: 1 as const,
  };

  constructor(
    private readonly subscriberRegistry: MessageSubscriberRegistry,
    private readonly noticeService: AdminNoticeService,
    private readonly eventStream: AdminNoticeEventStreamService,
  ) {}

  onModuleInit(): void {
    this.subscriberRegistry.register(this);
  }

  onModuleDestroy(): void {
    this.subscriberRegistry.unregister(this);
  }

  /**
   * 保留已生成站内信历史；订阅停用仅阻止后续统一消息进入站内信。
   */
  async cancelSubscriptionDeliveries(): Promise<void> {}

  /**
   * 接收包含全部已转换模板的统一消息，并按站内信策略逐模板写入通知。
   * @param input - 统一消息或其取消、取代引用，以及共享事务上下文。
   * @returns 至少写入一条通知时返回提交后广播回执；无匹配配置或非投递生命周期时不返回回执。
   */
  async receive(
    input: MessageSubscriberInput,
  ): Promise<MessageSubscriberReceipt | void> {
    if (input.lifecycle !== 'deliver') return;
    const bindings = await input.manager
      .getRepository(StationNoticeMessageBinding)
      .find({
        order: { id: 'ASC' },
        where: {
          enabled: true,
          isDeleted: false,
          subscriptionId: input.message.subscriptionId,
        },
      });

    let delivered = false;
    for (const binding of bindings) {
      for (const template of input.message.templates) {
        await this.noticeService.publishMessageSubscriberNotice(input.manager, {
          content: template.renderedMessage,
          dedupeKey: this.deliveryDedupeKey(
            input.message.eventId,
            binding.id,
            template.templateId,
          ),
          eventType: input.message.sourceKey,
          metadata: {
            bindingId: String(binding.id),
            eventId: input.message.eventId,
            messageEventId: input.message.messageEventId,
            subscriberKey: this.definition.subscriberKey,
            subscriptionId: input.message.subscriptionId,
            templateId: template.templateId,
          },
          notifyRoleCode: binding.notifyRoleCode,
          severity: 'info',
          source: 'message-management',
          summary: template.renderedMessage,
          title: binding.title,
        });
        delivered = true;
      }
    }
    if (!delivered) return;
    return {
      afterCommit: () => {
        this.eventStream.publishCommitted('created');
      },
    };
  }

  /**
   * 在通用订阅删除或切换订阅者前检查站内信私有配置，防止产生悬空绑定。
   * @param manager - 执行引用查询的实体管理器。
   * @param subscriptionId - 需要检查的通用消息订阅标识。
   * @returns 存在至少一个未删除站内信配置时返回 true。
   */
  async hasSubscriptionReferences(
    manager: EntityManager,
    subscriptionId: string,
  ): Promise<boolean> {
    const count = await manager
      .getRepository(StationNoticeMessageBinding)
      .count({
        where: { isDeleted: false, subscriptionId },
      });
    return count > 0;
  }

  /**
   * 站内信采用同步落库策略，不需要独立扫描执行器。
   * @returns 固定返回 0，表示没有异步投递被领取。
   */
  async runOnce(): Promise<number> {
    return 0;
  }

  /**
   * 组合事件、站内信配置和模板标识，生成逐模板投递的稳定去重键。
   * @param eventId - 消息生产方提供的稳定事件标识。
   * @param bindingId - 站内信订阅者私有配置标识。
   * @param templateId - 消息管理已转换的模板标识。
   * @returns 限定在站内信订阅者内的逐模板去重键。
   */
  private deliveryDedupeKey(
    eventId: string,
    bindingId: string,
    templateId: string,
  ): string {
    return `message:${eventId}:station-notice:${bindingId}:${templateId}`;
  }
}
