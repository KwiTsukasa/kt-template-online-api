import { Injectable } from '@nestjs/common';
import {
  SystemMessageContractError,
  type SystemMessageSourceAdapter,
  type SystemMessageSourceDefinition,
} from '../../contract/message-push/qqbot-message-push.types';

/**
 * Holds the process-local system message-source adapters registered by owning modules.
 *
 * Definitions are cloned on listing so management callers cannot mutate adapter state.
 */
@Injectable()
export class SystemMessageSourceRegistry {
  private readonly adapters = new Map<string, SystemMessageSourceAdapter>();

  /**
   * Registers one source adapter once for the current Nest process.
   * @param adapter - Network, Core, or future module-owned source implementation.
   * @throws {SystemMessageContractError} When its source key is already registered.
   */
  register(adapter: SystemMessageSourceAdapter): void {
    const key = adapter.definition.sourceKey;
    if (this.adapters.has(key)) {
      throw new SystemMessageContractError('duplicate_message_source');
    }
    this.adapters.set(key, adapter);
  }

  /**
   * Removes only the exact adapter instance that registered the source key.
   * @param sourceKey - Registered source identity.
   * @param adapter - Instance performing module teardown.
   */
  unregister(sourceKey: string, adapter: SystemMessageSourceAdapter): void {
    if (this.adapters.get(sourceKey) === adapter) {
      this.adapters.delete(sourceKey);
    }
  }

  /**
   * Returns the adapter for a known source key.
   * @param sourceKey - Stable source identity stored by subscriptions.
   * @returns The registered adapter instance.
   * @throws {SystemMessageContractError} When no source owns the requested key.
   */
  get(sourceKey: string): SystemMessageSourceAdapter {
    const adapter = this.adapters.get(sourceKey);
    if (!adapter) {
      throw new SystemMessageContractError('unknown_message_source');
    }
    return adapter;
  }

  /**
   * Lists source definitions in stable source-key order without exposing internal objects.
   * @returns Detached definition snapshots for read-only management use.
   */
  list(): SystemMessageSourceDefinition[] {
    return [...this.adapters.values()]
      .map(({ definition }) => structuredClone(definition))
      .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
  }
}
