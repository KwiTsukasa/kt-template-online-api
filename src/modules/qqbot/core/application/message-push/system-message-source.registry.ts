import { Injectable } from '@nestjs/common';
import {
  SystemMessageContractError,
  type SystemMessageSourceAdapter,
  type SystemMessageSourceDefinition,
} from '../../contract/message-push/qqbot-message-push.types';

@Injectable()
export class SystemMessageSourceRegistry {
  private readonly adapters = new Map<string, SystemMessageSourceAdapter>();

  register(adapter: SystemMessageSourceAdapter): void {
    const key = adapter.definition.sourceKey;
    if (this.adapters.has(key)) {
      throw new SystemMessageContractError('duplicate_message_source');
    }
    this.adapters.set(key, adapter);
  }

  unregister(sourceKey: string, adapter: SystemMessageSourceAdapter): void {
    if (this.adapters.get(sourceKey) === adapter) {
      this.adapters.delete(sourceKey);
    }
  }

  get(sourceKey: string): SystemMessageSourceAdapter {
    const adapter = this.adapters.get(sourceKey);
    if (!adapter) {
      throw new SystemMessageContractError('unknown_message_source');
    }
    return adapter;
  }

  list(): SystemMessageSourceDefinition[] {
    return [...this.adapters.values()]
      .map(({ definition }) => structuredClone(definition))
      .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
  }
}
