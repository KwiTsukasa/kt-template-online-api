import { QqbotPluginRegistryService } from '../../../../src/modules/qqbot/plugin-platform/application/registry/qqbot-plugin-registry.service';
import type { QqbotIntegrationPlugin } from '../../../../src/modules/qqbot/core/contract/qqbot.types';

const createPlugin = (
  key: string,
  legacyKeys: string[],
): QqbotIntegrationPlugin => ({
  key,
  legacyKeys,
  name: key,
  operations: [
    {
      execute: jest.fn(async () => ({ ok: true })),
      key: `${key}.operation`,
      name: 'Operation',
    },
  ],
  version: '1.0.0',
});

describe('QQBot plugin registry platform key compatibility', () => {
  it('activates builtin command plugins before they are registered', async () => {
    const activate = jest.fn(async () => undefined);
    const plugin = {
      ...createPlugin('demo-plugin', []),
      activate,
    };
    const registry = new QqbotPluginRegistryService({
      loadCommandPlugins: () => [plugin],
    } as any);

    await registry.onModuleInit();

    expect(activate).toHaveBeenCalledTimes(1);
    expect(registry.listPlugins().map((item) => item.key)).toEqual([
      'demo-plugin',
    ]);
  });

  it('uses platform plugin keys as primary keys while resolving legacy command keys', async () => {
    const bangdream = createPlugin('bangdream', ['bangDream']);
    const ff14Plugin = createPlugin('ff14-market', ['ff14Market']);
    const fflogs = createPlugin('fflogs', []);
    const registry = new QqbotPluginRegistryService();

    registry.register(bangdream);
    registry.register(ff14Plugin);
    registry.register(fflogs);

    expect(registry.listPlugins().map((plugin) => plugin.key)).toEqual([
      'bangdream',
      'ff14-market',
      'fflogs',
    ]);
    expect(registry.listOperations('bangDream')[0].pluginKey).toBe('bangdream');
    expect(registry.listOperations('ff14Market')[0].pluginKey).toBe(
      'ff14-market',
    );

    await expect(
      registry.execute('bangDream', 'bangdream.operation', {}),
    ).resolves.toEqual({ ok: true });
    await expect(
      registry.execute('ff14Market', 'ff14-market.operation', {}),
    ).resolves.toEqual({ ok: true });
  });
});
