import { Injectable } from '@nestjs/common';
import { SystemMessageContractError } from '../../contract/message-management.types';
import type {
  MessageSubscriberAdapter,
  MessageSubscriberDefinition,
} from './message-subscriber.adapter';

@Injectable()
export class MessageSubscriberRegistry {
  private readonly adapters = new Map<string, MessageSubscriberAdapter>();

  /**
   * 注册一个外部消息订阅者适配器，并拒绝重复订阅者键造成的路由歧义。
   * @param adapter - 实现统一消息订阅者协议的外部适配器。
   * @throws 同一订阅者键已有实例时抛出重复订阅者契约错误。
   */
  register(adapter: MessageSubscriberAdapter): void {
    const key = adapter.definition.subscriberKey;
    if (this.adapters.has(key)) {
      throw new SystemMessageContractError('duplicate_message_subscriber');
    }
    this.adapters.set(key, adapter);
  }

  /**
   * 仅注销当前实例注册的订阅者，避免模块销毁时误删同键的新适配器。
   * @param adapter - 先前注册且准备退出的消息订阅者适配器。
   */
  unregister(adapter: MessageSubscriberAdapter): void {
    const key = adapter.definition.subscriberKey;
    if (this.adapters.get(key) !== adapter) return;
    this.adapters.delete(key);
  }

  /**
   * 按订阅者键读取唯一适配器，供订阅校验和定向消息路由使用。
   * @param subscriberKey - 消息订阅声明的稳定订阅者键。
   * @returns 与订阅者键对应的统一协议适配器。
   * @throws 未注册对应订阅者时抛出统一契约错误。
   */
  require(subscriberKey: string): MessageSubscriberAdapter {
    const adapter = this.adapters.get(subscriberKey);
    if (!adapter) {
      throw new SystemMessageContractError('unknown_message_subscriber');
    }
    return adapter;
  }

  /**
   * 返回按订阅者键排序的适配器快照，供独立投递执行器稳定排空。
   * @returns 当前已注册的消息订阅者适配器数组。
   */
  list(): MessageSubscriberAdapter[] {
    return [...this.adapters.values()].sort((left, right) =>
      left.definition.subscriberKey.localeCompare(
        right.definition.subscriberKey,
      ),
    );
  }

  /**
   * 返回不含实现实例的订阅者定义，供消息订阅管理界面选择统一协议接收方。
   * @returns 按订阅者键排序的只读定义数组。
   */
  listDefinitions(): MessageSubscriberDefinition[] {
    return this.list().map((adapter) => structuredClone(adapter.definition));
  }
}
