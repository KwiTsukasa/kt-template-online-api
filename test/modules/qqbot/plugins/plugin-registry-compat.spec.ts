jest.mock('@/modules/qqbot/plugins/bangDream/qqbot-bangdream.plugin', () => ({
  QqbotBangDreamPluginService: class {},
}));
jest.mock(
  '@/modules/qqbot/plugins/ff14Market/qqbot-ff14-market.plugin',
  () => ({
    QqbotFf14MarketPluginService: class {},
  }),
);
jest.mock('@/modules/qqbot/plugins/fflogs/qqbot-fflogs.plugin', () => ({
  QqbotFflogsPluginService: class {},
}));

import { QqbotPluginRegistryService } from '../../../../src/qqbot/plugin/qqbot-plugin-registry.service';
import type { QqbotIntegrationPlugin } from '../../../../src/qqbot/qqbot.types';

const asPluginService = (plugin: QqbotIntegrationPlugin) =>
  ({
    getPlugin: () => plugin,
  }) as any;

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
  it('uses platform plugin keys as primary keys while resolving legacy command keys', async () => {
    const bangdream = createPlugin('bangdream', ['bangDream']);
    const ff14Market = createPlugin('ff14-market', ['ff14Market']);
    const fflogs = createPlugin('fflogs', []);
    const registry = new QqbotPluginRegistryService(
      asPluginService(bangdream),
      asPluginService(ff14Market),
      asPluginService(fflogs),
    );

    registry.onModuleInit();

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
