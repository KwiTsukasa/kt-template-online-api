import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DictService } from '../../../src/modules/admin/platform-config/dict/dict.service';
import { PluginHostBridgeService } from '../../../src/modules/plugin-platform/infrastructure/integration/runtime/plugin-host-bridge.service';
import { PluginHttpClientService } from '../../../src/modules/plugin-platform/infrastructure/integration/sdk/plugin-http-client.service';
import type { PluginPackageDescriptor } from '../../../src/modules/plugin-platform/infrastructure/integration/package/plugin-package.types';

describe('plugin protocol host bridge', () => {
  let tempRoot: string;
  let bridge: PluginHostBridgeService;
  const httpClient = {
    requestBuffer: jest.fn(),
    requestJson: jest.fn().mockResolvedValue({ ok: true }),
    resolveRedirect: jest.fn(),
  };

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'plugin-host-'));
    const dictService = {
      getDictByKey: jest.fn(),
      getDictItemsByKey: jest.fn(),
      relationTree: jest.fn(),
    } as unknown as DictService;
    bridge = new PluginHostBridgeService(
      dictService,
      httpClient as unknown as PluginHttpClientService,
    );
  });

  afterEach(() => {
    rmSync(tempRoot, { force: true, recursive: true });
    jest.clearAllMocks();
  });

  it('rejects file reads that escape the plugin package root', async () => {
    await expect(
      bridge.handleHostCall(createDescriptor(), {
        args: { path: '../escape.json' },
        method: 'readJsonFile',
        pluginKey: 'sample',
      }),
    ).resolves.toEqual({
      message: 'Plugin host file path must stay inside the package root',
      ok: false,
    });
  });

  it('delegates protocol-neutral HTTP calls to the controlled client', async () => {
    const options = {
      context: 'sample call',
      url: 'https://example.test/data',
    };
    await expect(
      bridge.handleHostCall(createDescriptor(), {
        args: { options },
        method: 'requestJson',
        pluginKey: 'sample',
      }),
    ).resolves.toEqual({ ok: true, value: { ok: true } });
    expect(httpClient.requestJson).toHaveBeenCalledWith(options);
  });

  it('reads package-owned JSON without exposing adapter services', async () => {
    mkdirSync(join(tempRoot, 'data'), { recursive: true });
    writeFileSync(join(tempRoot, 'data', 'sample.json'), '{"enabled":true}\n');
    await expect(
      bridge.handleHostCall(createDescriptor(), {
        args: { path: 'data/sample.json' },
        method: 'readJsonFile',
        pluginKey: 'sample',
      }),
    ).resolves.toEqual({ ok: true, value: { enabled: true } });
  });

  /**
   * 构造仅声明协议中立能力的测试插件描述。
   * @returns 临时包目录绑定的插件描述。
   */
  function createDescriptor(): PluginPackageDescriptor {
    return {
      entry: 'src/index.ts',
      entryFile: join(tempRoot, 'src', 'index.ts'),
      manifest: {
        assets: [],
        configSchema: {},
        entry: 'src/index.ts',
        events: [],
        key: 'sample',
        legacyAliases: [],
        migrations: [],
        minApiSdkVersion: '1.0.0',
        name: 'Sample',
        operations: [],
        permissions: [],
        pluginKey: 'sample',
        runtime: {
          configKeys: [],
          maxConcurrency: 1,
          memoryMb: 128,
          timeoutMs: 5000,
          workerType: 'thread',
        },
        tasks: [],
        version: '1.0.0',
      },
      packageRoot: tempRoot,
      pluginKey: 'sample',
    };
  }
});
