import type { SystemMessageSourceAdapter } from '../../../../src/modules/message-management/contract/message-management.types';
import { SystemMessageSourceRegistry } from '../../../../src/modules/message-management/application/system-message-source.registry';

function createAdapter(sourceKey: string): SystemMessageSourceAdapter {
  return {
    definition: {
      description: 'test',
      displayName: sourceKey,
      sourceKey,
      subscriptionFields: [],
      variables: [],
      version: 1,
    },
    eventResourceKey: jest.fn(),
    inspectSubscription: jest.fn(),
    listSubscriptionOptions: jest.fn(),
    normalizeSubscriptionConfig: jest.fn(),
    resolveDelivery: jest.fn(),
    subscriptionResourceKey: jest.fn(),
    validateEventPayload: jest.fn(),
  };
}

describe('SystemMessageSourceRegistry', () => {
  it('rejects duplicate source registration and returns immutable definitions', () => {
    const registry = new SystemMessageSourceRegistry();
    const adapter = createAdapter('network.stun.mapping-port-changed');
    registry.register(adapter);

    expect(() => registry.register(adapter)).toThrow(
      'duplicate_message_source',
    );
    expect(registry.list()).toEqual([adapter.definition]);
    expect(() => registry.get('missing')).toThrow('unknown_message_source');

    const [definition] = registry.list();
    definition.displayName = 'mutated';
    expect(
      registry.get(adapter.definition.sourceKey).definition.displayName,
    ).toBe(adapter.definition.displayName);
  });

  it('sorts definitions and unregisters only the same adapter instance', () => {
    const registry = new SystemMessageSourceRegistry();
    const first = createAdapter('network.tcp.natmap-endpoint-changed');
    const second = createAdapter('network.stun.mapping-port-changed');
    const replacement = createAdapter('network.tcp.natmap-endpoint-changed');
    registry.register(first);
    registry.register(second);

    registry.unregister('network.tcp.natmap-endpoint-changed', replacement);
    expect(registry.list().map((definition) => definition.sourceKey)).toEqual([
      'network.stun.mapping-port-changed',
      'network.tcp.natmap-endpoint-changed',
    ]);
    registry.unregister('network.tcp.natmap-endpoint-changed', first);
    expect(registry.list().map((definition) => definition.sourceKey)).toEqual([
      'network.stun.mapping-port-changed',
    ]);
  });
});
