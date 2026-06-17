import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QqbotAccountService } from '../../../../src/modules/qqbot/core/application/account/qqbot-account.service';
import { QqbotConfigService } from '../../../../src/modules/qqbot/core/application/config/qqbot-config.service';
import { QqbotSendService } from '../../../../src/modules/qqbot/core/application/send/qqbot-send.service';
import { DictService } from '../../../../src/modules/admin/platform-config/dict/dict.service';
import { QqbotPluginHostBridgeService } from '../../../../src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/plugin-host-bridge.service';
import { QqbotPluginHttpClientService } from '../../../../src/modules/qqbot/plugin-platform/infrastructure/integration/sdk/plugin-http-client.service';
import type { QqbotPluginPackageDescriptor } from '../../../../src/modules/qqbot/plugin-platform/infrastructure/integration/package/plugin-package.types';

describe('QQBot plugin host bridge', () => {
  let tempRoot: string;
  let bridge: QqbotPluginHostBridgeService;
  let configValues: Record<string, string | undefined>;
  let httpClient: { requestBuffer: jest.Mock; requestJson: jest.Mock };
  let accountService: {
    bindEventPlugin: jest.Mock;
    getBoundEventPluginKeys: jest.Mock;
    unbindEventPlugin: jest.Mock;
  };
  let sendService: { sendText: jest.Mock };

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'qqbot-plugin-host-'));
    configValues = {
      SAMPLE_TOKEN: 'token-1',
      SAMPLE_EMPTY: undefined,
    };
    const configService = new QqbotConfigService(
      createConfigRepository(configValues),
    );
    const dictService = {
      getDictByKey: jest.fn(),
      getDictItemsByKey: jest.fn(),
      relationTree: jest.fn(),
    } as unknown as DictService;
    httpClient = {
      requestBuffer: jest.fn(),
      requestJson: jest.fn().mockResolvedValue({ ok: true }),
    };
    accountService = {
      bindEventPlugin: jest.fn().mockResolvedValue(true),
      getBoundEventPluginKeys: jest.fn(),
      unbindEventPlugin: jest.fn(),
    };
    sendService = {
      sendText: jest.fn().mockResolvedValue({ messageId: 'msg-1' }),
    };
    bridge = new QqbotPluginHostBridgeService(
      configService,
      dictService,
      httpClient as unknown as QqbotPluginHttpClientService,
      accountService as unknown as QqbotAccountService,
      sendService as unknown as QqbotSendService,
    );
  });

  afterEach(() => {
    rmSync(tempRoot, { force: true, recursive: true });
  });

  it('reads many package-owned config keys through the QQBot config service', async () => {
    await expect(
      bridge.handleHostCall(createDescriptor(), {
        args: { keys: ['SAMPLE_TOKEN', 'SAMPLE_EMPTY', 'SAMPLE_MISSING'] },
        method: 'getConfigMany',
        pluginKey: 'sample',
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        SAMPLE_EMPTY: undefined,
        SAMPLE_MISSING: undefined,
        SAMPLE_TOKEN: 'token-1',
      },
    });
  });

  it('preserves configured empty string values in config snapshots', async () => {
    configValues.SAMPLE_EMPTY = '';

    await expect(
      bridge.handleHostCall(createDescriptor(), {
        args: { keys: ['SAMPLE_EMPTY'] },
        method: 'getConfigMany',
        pluginKey: 'sample',
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        SAMPLE_EMPTY: '',
      },
    });
  });

  it('rejects JSON reads that try to escape the package root', async () => {
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

  it('delegates requestJson host calls to the plugin HTTP client', async () => {
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

  it('delegates event binding and text sends to core QQBot services', async () => {
    const descriptor = createDescriptor();
    const sendInput = {
      message: 'hello',
      selfId: '10001',
      targetId: '20001',
      targetType: 'group',
    };

    await expect(
      bridge.handleHostCall(descriptor, {
        args: { selfId: '10001', pluginKey: 'sample' },
        method: 'bindEventPlugin',
        pluginKey: 'sample',
      }),
    ).resolves.toEqual({ ok: true, value: true });
    await expect(
      bridge.handleHostCall(descriptor, {
        args: { input: sendInput },
        method: 'sendText',
        pluginKey: 'sample',
      }),
    ).resolves.toEqual({ ok: true, value: { messageId: 'msg-1' } });

    expect(accountService.bindEventPlugin).toHaveBeenCalledWith(
      '10001',
      'sample',
    );
    expect(sendService.sendText).toHaveBeenCalledWith(sendInput);
  });

  it('reads JSON files from descriptor package roots', async () => {
    const descriptor = createDescriptor();
    const filePath = join(tempRoot, 'data', 'sample.json');
    mkdirSync(join(tempRoot, 'data'), { recursive: true });
    writeFileSync(filePath, '{"enabled":true}\n');

    await expect(
      bridge.handleHostCall(descriptor, {
        args: { path: 'data/sample.json' },
        method: 'readJsonFile',
        pluginKey: 'sample',
      }),
    ).resolves.toEqual({ ok: true, value: { enabled: true } });
  });

  /**
   * Creates a descriptor fixture rooted at this test's temporary package directory.
   * @returns Descriptor used to constrain host bridge file-system access.
   */
  function createDescriptor(): QqbotPluginPackageDescriptor {
    return {
      entry: 'src/index.ts',
      entryFile: join(tempRoot, 'src', 'index.ts'),
      manifest: {
        key: 'sample',
        pluginKey: 'sample',
        name: 'Sample',
        version: '1.0.0',
        minApiSdkVersion: '1.0.0',
        entry: 'src/index.ts',
        runtime: {
          configKeys: ['SAMPLE_TOKEN'],
          maxConcurrency: 1,
          memoryMb: 128,
          timeoutMs: 5000,
          workerType: 'thread',
        },
        operations: [],
        events: [],
        tasks: [],
        assets: [],
        configSchema: {},
        legacyAliases: [],
        migrations: [],
        permissions: [],
      },
      packageRoot: tempRoot,
      pluginKey: 'sample',
    };
  }
});

/**
 * Creates a minimal config repository that lets QqbotConfigService read fixture values through its real raw-value method.
 * @param values - Config key/value fixture; absent keys behave like missing records.
 * @returns Repository-shaped fixture used by QqbotConfigService in host bridge tests.
 */
function createConfigRepository(
  values: Record<string, string | undefined>,
): ConstructorParameters<typeof QqbotConfigService>[0] {
  /**
   * Finds one QQBot config fixture using the TypeORM `where.configKey` query shape.
   * @param query - TypeORM-style lookup object produced by QqbotConfigService.
   * @returns Fixture record with the stored config value, or `null` when the key is not present.
   */
  const findOne = async (query: { where?: { configKey?: string } }) => {
    const configKey = query.where?.configKey;
    if (
      !configKey ||
      !Object.prototype.hasOwnProperty.call(values, configKey)
    ) {
      return null;
    }
    return { configValue: values[configKey] };
  };

  return {
    findOne: jest.fn(findOne),
  } as unknown as ConstructorParameters<typeof QqbotConfigService>[0];
}
