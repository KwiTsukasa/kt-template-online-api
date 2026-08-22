import { PluginRegistryService } from '../../../src/modules/plugin-platform/application/registry/plugin-registry.service';

describe('plugin registry operation timeout', () => {
  it('enforces manifest operation timeout for explicitly registered command plugins', async () => {
    const commandRegistry = new PluginRegistryService();
    commandRegistry.register({
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
    });
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
        msg: 'Bot 插件能力执行超时：demo.slow',
      }),
    });
  });
});
