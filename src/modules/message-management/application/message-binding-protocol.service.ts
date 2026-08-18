import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { MessageSubscription } from '../infrastructure/persistence/message-subscription.entity';
import { MessageSubscriptionTemplate } from '../infrastructure/persistence/message-subscription-template.entity';
import { MessageTemplate } from '../infrastructure/persistence/message-template.entity';
import { MessageSubscriberRegistry } from './subscriber/message-subscriber.registry';
import { MessageSubscriptionService } from './message-subscription.service';
import { SystemMessageSourceRegistry } from './system-message-source.registry';
import { SystemMessageTemplateRendererService } from './system-message-template-renderer.service';

export interface MessageBindingInspection {
  available: boolean;
  invalidReasonCode: null | string;
  sourceKey: string;
  sourceName: string;
  subscriberKey: string;
  subscriberName: string;
  subscriptionName: string;
  templates: Array<{
    id: string;
    name: string;
    sortOrder: number;
  }>;
}

@Injectable()
export class MessageBindingProtocolService {
  constructor(
    private readonly subscriptionService: MessageSubscriptionService,
    private readonly sourceRegistry: SystemMessageSourceRegistry,
    private readonly subscriberRegistry: MessageSubscriberRegistry,
    private readonly renderer: SystemMessageTemplateRendererService,
  ) {}

  /**
   * 由消息管理检查订阅是否归属调用方订阅者，并从订阅绑定模板派生来源状态。
   * @param manager - 读取通用订阅与模板的实体管理器。
   * @param subscriptionId - 订阅者私有配置引用的消息订阅标识。
   * @param subscriberKey - 调用方订阅者适配器的稳定协议键。
   * @returns 不暴露消息源适配器实例的统一绑定检查结果。
   */
  async inspect(
    manager: EntityManager,
    subscriptionId: string,
    subscriberKey: string,
  ): Promise<MessageBindingInspection> {
    const subscription = await manager
      .getRepository(MessageSubscription)
      .findOne({
        where: { id: subscriptionId },
      });
    let expectedTemplateCount = 0;
    let templates: Array<{
      binding: MessageSubscriptionTemplate;
      template: MessageTemplate;
    }> = [];
    if (subscription) {
      const bindings = await manager
        .getRepository(MessageSubscriptionTemplate)
        .find({
          order: { sortOrder: 'ASC' },
          where: { subscriptionId: subscription.id },
        });
      expectedTemplateCount = bindings.length;
      const templateRecords = await Promise.all(
        bindings.map((binding) =>
          manager.getRepository(MessageTemplate).findOne({
            where: { id: binding.templateId },
          }),
        ),
      );
      templates = bindings.flatMap((binding, index) => {
        const template = templateRecords[index];
        if (!template) return [];
        return [{ binding, template }];
      });
    }
    const base = this.baseInspection(
      subscription,
      templates,
      subscriberKey,
      expectedTemplateCount,
    );
    if (!subscription || !base.available) return base;

    try {
      const subscriber = this.subscriberRegistry.require(subscriberKey);
      base.subscriberName = subscriber.definition.displayName;
      const source = this.sourceRegistry.get(templates[0].template.sourceKey);
      base.sourceName = source.definition.displayName;
      const inspection = await source.inspectSubscription(
        subscription.sourceConfig,
      );
      if (!inspection.valid) {
        base.available = false;
        base.invalidReasonCode =
          inspection.invalidReasonCode || 'invalid_source_config';
        return base;
      }
      for (const { template } of templates) {
        this.renderer.validate(
          template.content,
          source.definition.variables.map((variable) => variable.key),
        );
      }
      return base;
    } catch {
      base.available = false;
      base.invalidReasonCode = 'invalid_source_config';
      return base;
    }
  }

  /**
   * 集中执行订阅者私有绑定的启用门禁，避免外部适配器直接读取消息源实现或模板仓储。
   * @param manager - 与订阅者私有配置写入共享事务的实体管理器。
   * @param subscriptionId - 订阅者准备配置的通用消息订阅标识。
   * @param subscriberKey - 当前订阅者适配器的稳定协议键。
   * @param bindingEnabled - 是否要求订阅、模板和消息源当前均可投递。
   */
  async requireAvailable(
    manager: EntityManager,
    subscriptionId: string,
    subscriberKey: string,
    bindingEnabled: boolean,
  ): Promise<void> {
    const context = await this.subscriptionService.requireAvailableForBinding(
      manager,
      subscriptionId,
      subscriberKey,
      bindingEnabled,
    );
    if (!bindingEnabled) return;
    const source = this.sourceRegistry.get(context.templates[0].sourceKey);
    for (const template of context.templates) {
      this.renderer.validate(
        template.content,
        source.definition.variables.map((variable) => variable.key),
      );
    }
  }

  /**
   * 将通用订阅、唯一模板及预期订阅者投影为不依赖具体来源实现的初始检查结果。
   * @param subscription - 订阅者私有配置引用的通用订阅；不存在时为 null。
   * @param templates - 订阅直接绑定的全部有序模板及其关联记录。
   * @param expectedSubscriberKey - 发起检查的订阅者协议键。
   * @param expectedTemplateCount - 订阅关联表声明的模板总数，用于识别悬空关联。
   * @returns 包含模板、来源、订阅者名称和基础失效原因的检查结果。
   */
  private baseInspection(
    subscription: MessageSubscription | null,
    templates: Array<{
      binding: MessageSubscriptionTemplate;
      template: MessageTemplate;
    }>,
    expectedSubscriberKey: string,
    expectedTemplateCount: number,
  ): MessageBindingInspection {
    let sourceKey = '';
    let subscriptionName = '';
    if (subscription) subscriptionName = subscription.name;
    if (templates.length > 0) sourceKey = templates[0].template.sourceKey;

    const result: MessageBindingInspection = {
      available: true,
      invalidReasonCode: null,
      sourceKey,
      sourceName: sourceKey,
      subscriberKey: expectedSubscriberKey,
      subscriberName: expectedSubscriberKey,
      subscriptionName,
      templates: templates.map(({ binding, template }) => ({
        id: String(template.id),
        name: template.name,
        sortOrder: binding.sortOrder,
      })),
    };
    if (!subscription || subscription.isDeleted) {
      result.available = false;
      result.invalidReasonCode = 'invalid_source_config';
      return result;
    }
    if (subscription.subscriberKey !== expectedSubscriberKey) {
      result.available = false;
      result.invalidReasonCode = 'subscriber_mismatch';
      return result;
    }
    if (!subscription.enabled) {
      result.available = false;
      result.invalidReasonCode = 'subscription_disabled';
      return result;
    }
    if (
      templates.length === 0 ||
      templates.length !== expectedTemplateCount ||
      templates.some(
        ({ template }) =>
          template.isDeleted ||
          !template.enabled ||
          template.sourceKey !== sourceKey,
      )
    ) {
      result.available = false;
      result.invalidReasonCode = 'template_invalid';
    }
    return result;
  }
}
