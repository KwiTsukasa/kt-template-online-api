import {
  PLUGIN_ALLOWED_PERMISSIONS,
  parsePluginManifest,
  PluginManifestValidationError,
} from '../../../src/modules/plugin-platform/domain/manifest';

const createValidManifest = () => ({
  assets: [
    {
      key: 'song-card-bg',
      path: 'assets/song-card-bg.png',
    },
  ],
  author: 'KT',
  configSchema: {
    properties: {
      apiBaseUrl: {
        default: 'https://example.com',
        type: 'string',
      },
    },
    type: 'object',
  },
  description: 'BangDream query operations',
  entry: 'src/index.ts',
  events: [
    {
      eventName: 'message.group',
      handlerName: 'onGroupMessage',
      key: 'bangdream.group-message',
      name: '群消息事件',
    },
  ],
  homepage: 'https://example.com/bangdream',
  license: 'MIT',
  legacyAliases: ['bangDream'],
  migrations: [
    {
      path: 'migrations/001-init.sql',
      version: '1.0.0',
    },
  ],
  minApiSdkVersion: '1.0.0',
  name: 'BangDream',
  operations: [
    {
      aliases: ['/查歌', '/bd song'],
      description: 'Search songs',
      handlerName: 'searchSong',
      inputSchema: {
        properties: {
          keyword: {
            type: 'string',
          },
        },
        type: 'object',
      },
      key: 'bangdream.song.search',
      name: '查歌',
      outputSchema: {
        type: 'object',
      },
      permissions: ['bot.reply', 'runtime.http', 'asset.read'],
      timeoutMs: 5000,
    },
  ],
  permissions: ['bot.reply', 'runtime.http', 'asset.read'],
  pluginKey: 'bangdream',
  runtime: {
    maxConcurrency: 2,
    memoryMb: 256,
    timeoutMs: 8000,
    workerType: 'node-worker',
  },
  version: '1.2.3',
});

const expectValidationError = (
  manifest: unknown,
  code: string,
  path?: string,
) => {
  try {
    parsePluginManifest(manifest, { pluginRoot: 'D:/plugins/bangdream' });
    throw new Error('Expected manifest validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(PluginManifestValidationError);
    expect((error as PluginManifestValidationError).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code,
          ...(path ? { path } : {}),
        }),
      ]),
    );
  }
};

describe('QQBot plugin manifest contract', () => {
  it('parses a complete manifest and normalizes declared plugin capabilities', () => {
    const manifest = parsePluginManifest(createValidManifest(), {
      pluginRoot: 'D:/plugins/bangdream',
    });

    expect(manifest).toMatchObject({
      entry: 'src/index.ts',
      minApiSdkVersion: '1.0.0',
      pluginKey: 'bangdream',
      legacyAliases: ['bangDream'],
      runtime: {
        maxConcurrency: 2,
        memoryMb: 256,
        timeoutMs: 8000,
        workerType: 'node-worker',
      },
      version: '1.2.3',
    });
    expect(manifest.permissions).toEqual([
      'bot.reply',
      'runtime.http',
      'asset.read',
    ]);
    expect(manifest.operations[0]).toMatchObject({
      aliases: ['/查歌', '/bd song'],
      key: 'bangdream.song.search',
      permissions: ['bot.reply', 'runtime.http', 'asset.read'],
      timeoutMs: 5000,
    });
    expect(manifest.events[0]).toMatchObject({
      eventName: 'message.group',
      key: 'bangdream.group-message',
    });
    expect(manifest.assets[0].path).toBe('assets/song-card-bg.png');
    expect(manifest.migrations[0].path).toBe('migrations/001-init.sql');
    expect(PLUGIN_ALLOWED_PERMISSIONS).toEqual(
      expect.arrayContaining([
        'asset.read',
        'plugin.config.read',
        'plugin.config.write',
        'plugin.storage.read',
        'plugin.storage.write',
        'bot.event.receive',
        'bot.reply',
        'runtime.http',
      ]),
    );
  });

  it('normalizes runtime config keys without platform-owned plugin knowledge', () => {
    const validManifest = createValidManifest();
    const manifest = parsePluginManifest({
      ...validManifest,
      runtime: {
        ...validManifest.runtime,
        configKeys: [
          'SAMPLE_TOKEN',
          ' SAMPLE_TIMEOUT_MS ',
          '',
          'SAMPLE_TOKEN',
        ],
      },
    });

    expect(manifest.runtime.configKeys).toEqual([
      'SAMPLE_TOKEN',
      'SAMPLE_TIMEOUT_MS',
    ]);
  });

  it('accepts package key and thread worker type without platform transfer shims', () => {
    const validManifest = createValidManifest();
    const manifest = parsePluginManifest({
      ...validManifest,
      key: 'sample-plugin',
      pluginKey: undefined,
      runtime: {
        ...validManifest.runtime,
        workerType: 'thread',
      },
    });

    expect(manifest.key).toBe('sample-plugin');
    expect(manifest.pluginKey).toBe('sample-plugin');
    expect(manifest.runtime.workerType).toBe('thread');
  });

  it('rejects unknown permissions from both plugin and operation scopes', () => {
    const manifest = createValidManifest();
    manifest.permissions = ['bot.reply', 'host.env.read'];
    manifest.operations[0].permissions = ['bot.reply', 'host.fs.read'];

    expectValidationError(manifest, 'UNKNOWN_PERMISSION', 'permissions[1]');
    expectValidationError(
      manifest,
      'UNKNOWN_PERMISSION',
      'operations[0].permissions[1]',
    );
  });

  it('rejects duplicate operation keys and duplicate event keys', () => {
    const manifest = createValidManifest();
    manifest.operations.push({
      ...manifest.operations[0],
      handlerName: 'searchSongAgain',
    });
    manifest.events.push({
      ...manifest.events[0],
      handlerName: 'onGroupMessageAgain',
    });

    expectValidationError(manifest, 'DUPLICATE_OPERATION_KEY', 'operations[1]');
    expectValidationError(manifest, 'DUPLICATE_EVENT_KEY', 'events[1]');
  });

  it('rejects manifests without explicit runtime budgets', () => {
    const manifest = createValidManifest();
    manifest.runtime = {
      workerType: 'node-worker',
    } as typeof manifest.runtime;
    delete manifest.operations[0].timeoutMs;

    expectValidationError(manifest, 'MISSING_RUNTIME_BUDGET', 'runtime');
    expectValidationError(
      manifest,
      'MISSING_OPERATION_TIMEOUT',
      'operations[0].timeoutMs',
    );
  });

  it('rejects package paths outside the plugin root', () => {
    const manifest = createValidManifest();
    manifest.entry = '../outside.ts';
    manifest.assets[0].path = 'assets/../../secret.txt';
    manifest.migrations[0].path = 'C:/secrets/drop.sql';

    expectValidationError(manifest, 'PATH_OUTSIDE_PLUGIN_ROOT', 'entry');
    expectValidationError(
      manifest,
      'PATH_OUTSIDE_PLUGIN_ROOT',
      'assets[0].path',
    );
    expectValidationError(
      manifest,
      'PATH_OUTSIDE_PLUGIN_ROOT',
      'migrations[0].path',
    );
  });

  it('rejects incomplete capability metadata', () => {
    const manifest = createValidManifest();
    manifest.operations[0].handlerName = '';
    manifest.events[0].handlerName = '';
    manifest.assets[0].key = '';
    manifest.migrations[0].version = 'v1';
    manifest.legacyAliases = ['../bad'];

    expectValidationError(
      manifest,
      'MISSING_OPERATION_HANDLER',
      'operations[0].handlerName',
    );
    expectValidationError(
      manifest,
      'MISSING_EVENT_HANDLER',
      'events[0].handlerName',
    );
    expectValidationError(manifest, 'MISSING_ASSET_KEY', 'assets[0].key');
    expectValidationError(manifest, 'INVALID_SEMVER', 'migrations[0].version');
    expectValidationError(manifest, 'INVALID_LEGACY_ALIAS', 'legacyAliases[0]');
  });
});
