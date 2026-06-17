import { QqbotPluginRegistryService } from '../../../../src/modules/qqbot/plugin-platform/application/registry/qqbot-plugin-registry.service';

describe('QQBot plugin registry operation timeout', () => {
  it('enforces manifest operation timeout for direct built-in command execution', async () => {
    const commandRegistry = new QqbotPluginRegistryService({
      /**
       * 执行 插件平台回调。
       */
      loadCommandPlugins: () => [
        {
          key: 'demo-plugin',
          name: 'Demo Plugin',
          operations: [
            {
              execute: jest.fn(
                () => new Promise((resolve) => setTimeout(resolve, 1000)),
              ),
              key: 'demo.slow',
              name: 'slow',
              timeoutMs: 5,
            },
          ],
          version: '0.1.0',
        },
      ],
    } as any);
    await commandRegistry.onModuleInit();

    await expect(
      Promise.race([
        commandRegistry.execute('demo-plugin', 'demo.slow', {}, {}),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('test timeout waiting')), 50),
        ),
      ]),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        msg: 'QQBot 插件能力执行超时：demo.slow',
      }),
    });
  });
});
