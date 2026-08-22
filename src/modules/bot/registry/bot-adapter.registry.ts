import { Injectable } from '@nestjs/common';
import type { BotAdapterProtocol } from '../contract/bot-protocol';

@Injectable()
export class BotAdapterRegistry {
  private readonly adapters = new Map<string, BotAdapterProtocol>();

  /**
   * 注册一个无状态 Bot 协议适配器，并拒绝同键覆盖以避免运行期路由漂移。
   * @param adapter - 提供稳定键、入站规范化和出站投递的适配器。
   * @throws 适配器键为空或已经注册时抛出错误。
   */
  register(adapter: BotAdapterProtocol) {
    const key = `${adapter.key || ''}`.trim();
    if (!key) throw new Error('Bot adapter key is required');
    if (this.adapters.has(key)) {
      throw new Error(`Bot adapter already registered: ${key}`);
    }
    this.adapters.set(key, adapter);
  }

  /**
   * 按稳定键撤销进程内适配器注册，并确保该操作不触碰任何持久化状态。
   * @param key - 适配器稳定键。
   * @returns 是否实际移除注册项。
   */
  unregister(key: string) {
    return this.adapters.delete(`${key || ''}`.trim());
  }

  /**
   * 读取指定适配器；不存在时失败关闭，避免回退到错误平台协议。
   * @param key - 适配器稳定键。
   * @returns 已注册的无状态适配器。
   * @throws 适配器未注册时抛出错误。
   */
  require(key: string) {
    const normalizedKey = `${key || ''}`.trim();
    const adapter = this.adapters.get(normalizedKey);
    if (!adapter)
      throw new Error(`Bot adapter is not registered: ${normalizedKey}`);
    return adapter;
  }

  /**
   * 返回当前进程注册的适配器键，不包含账号、连接或用户状态。
   * @returns 按注册顺序排列的适配器键。
   */
  listKeys() {
    return [...this.adapters.keys()];
  }
}
