import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

export interface QqbotAccountExtension {
  readonly extensionKey: string;
  cancelAccountResources(
    manager: EntityManager,
    accountId: string,
  ): Promise<void>;
}

@Injectable()
export class QqbotAccountExtensionRegistry {
  private readonly extensions = new Map<string, QqbotAccountExtension>();

  /**
   * 注册一个 QQBot 账号扩展，并拒绝重复键以保证账号清理副作用唯一。
   * @param extension - 需要参与账号生命周期的外部扩展。
   * @throws 同一扩展键已有实例时抛出重复注册错误。
   */
  register(extension: QqbotAccountExtension): void {
    if (this.extensions.has(extension.extensionKey)) {
      throw new Error(
        `Duplicate QQBot account extension: ${extension.extensionKey}`,
      );
    }
    this.extensions.set(extension.extensionKey, extension);
  }

  /**
   * 仅移除当前实例对应的 QQBot 账号扩展注册。
   * @param extension - 准备退出账号生命周期的外部扩展。
   */
  unregister(extension: QqbotAccountExtension): void {
    if (this.extensions.get(extension.extensionKey) !== extension) return;
    this.extensions.delete(extension.extensionKey);
  }

  /**
   * 按扩展键稳定排序后在账号事务内执行清理，确保 QQBot Core 不反向依赖扩展资源表。
   * @param manager - 与 QQBot 账号变更共享事务的实体管理器。
   * @param accountId - 需要清理扩展资源的 QQBot 账号标识。
   */
  async cancelAccountResources(
    manager: EntityManager,
    accountId: string,
  ): Promise<void> {
    const extensions = [...this.extensions.values()].sort((left, right) =>
      left.extensionKey.localeCompare(right.extensionKey),
    );
    for (const extension of extensions) {
      await extension.cancelAccountResources(manager, accountId);
    }
  }
}
