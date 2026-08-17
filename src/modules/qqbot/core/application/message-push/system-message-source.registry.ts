import { Injectable } from '@nestjs/common';
import {
  SystemMessageContractError,
  type SystemMessageSourceAdapter,
  type SystemMessageSourceDefinition,
} from '../../contract/message-push/qqbot-message-push.types';

@Injectable()
export class SystemMessageSourceRegistry {
  private readonly adapters = new Map<string, SystemMessageSourceAdapter>();

  /**
   * 根据`adapter`处理系统消息来源注册表记录。
   * @param adapter - 用于系统消息来源注册表记录的领域对象，包含 `definition` 字段。
   * @throws 当 `this.adapters.has(key)` 成立时拒绝当前输入并抛出 `SystemMessageContractError`。
   */
  register(adapter: SystemMessageSourceAdapter): void {
    const key = adapter.definition.sourceKey;
    if (this.adapters.has(key)) {
      throw new SystemMessageContractError('duplicate_message_source');
    }
    this.adapters.set(key, adapter);
  }

  /**
   * 仅在注册表中的适配器仍是调用方提供的实例时删除来源注册，避免移除并发替换项。
   * @param sourceKey - 用于读取或更新仅在注册表中的适配器仍是调用方提供的实例时删除来源注册，避免移除并发替换项的稳定键。
   * @param adapter - 决定仅在注册表中的适配器仍是调用方提供的实例时删除来源注册，避免移除并发替换项内容、边界或目标的 `adapter` 值。
   */
  unregister(sourceKey: string, adapter: SystemMessageSourceAdapter): void {
    if (this.adapters.get(sourceKey) === adapter) {
      this.adapters.delete(sourceKey);
    }
  }

  /**
   * 按`sourceKey`读取系统消息来源注册表记录；从 `adapters.get` 读取系统消息来源注册表记录。
   * @param sourceKey - 用于读取或更新系统消息来源注册表记录的稳定键。
   * @returns 系统消息来源注册表记录。
   * @throws 当 `!adapter` 成立时拒绝当前输入并抛出 `SystemMessageContractError`。
   */
  get(sourceKey: string): SystemMessageSourceAdapter {
    const adapter = this.adapters.get(sourceKey);
    if (!adapter) {
      throw new SystemMessageContractError('unknown_message_source');
    }
    return adapter;
  }

  /**
   * 按当前运行态读取系统消息来源注册表记录。
   * @returns 按输入顺序得到的系统消息来源注册表记录列表；没有匹配项时为空数组。
   */
  list(): SystemMessageSourceDefinition[] {
    return [...this.adapters.values()]
      .map(({ definition }) => structuredClone(definition))
      .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
  }
}
