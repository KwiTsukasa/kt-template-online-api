import {
  parseQqbotPluginManifest,
  QqbotPluginManifestValidationError,
} from '../../../../src/modules/qqbot/plugin-platform/domain/manifest';
import { normalizeQqbotPluginTaskCron } from '../../../../src/modules/qqbot/plugin-platform/application/task';

const createManifestWithTask = () => ({
  assets: [],
  configSchema: { type: 'object' },
  entry: 'src/index.ts',
  events: [],
  legacyAliases: [],
  migrations: [],
  minApiSdkVersion: '1.0.0',
  name: 'BangDream',
  operations: [],
  permissions: ['runtime.http', 'plugin.storage.read', 'plugin.storage.write'],
  pluginKey: 'bangdream',
  runtime: {
    maxConcurrency: 1,
    memoryMb: 512,
    timeoutMs: 30000,
    workerType: 'node-worker',
  },
  tasks: [
    {
      defaultCron: '0 */6 * * *',
      description: '同步 BangDream 主数据',
      enabled: true,
      handlerName: 'syncBestdoriMainData',
      key: 'bangdream.bestdori.sync-main-data',
      name: '同步 Bestdori 主数据',
      permissions: [
        'runtime.http',
        'plugin.storage.read',
        'plugin.storage.write',
      ],
      timeoutMs: 120000,
    },
  ],
  version: '2.0.0',
});

describe('QQBot plugin task manifest contract', () => {
  it('parses manifest tasks and normalizes cron whitespace', () => {
    const manifest = createManifestWithTask();
    manifest.tasks[0].defaultCron = ' 0   */6   *   *   * ';

    const parsed = parseQqbotPluginManifest(manifest);

    expect(parsed.tasks).toEqual([
      expect.objectContaining({
        defaultCron: '0 */6 * * *',
        enabled: true,
        handlerName: 'syncBestdoriMainData',
        key: 'bangdream.bestdori.sync-main-data',
        timeoutMs: 120000,
      }),
    ]);
    expect(normalizeQqbotPluginTaskCron('0 */6 * * *')).toBe('0 */6 * * *');
  });

  it('rejects invalid task metadata', () => {
    const manifest = createManifestWithTask();
    manifest.tasks.push({
      ...manifest.tasks[0],
      handlerName: 'syncBestdoriMainDataAgain',
    });
    manifest.tasks.push({
      ...manifest.tasks[0],
      handlerName: '',
      key: 'BangDream.Bad',
      permissions: ['host.fs.read'],
      timeoutMs: undefined,
    } as any);

    expect(() => parseQqbotPluginManifest(manifest)).toThrow(
      QqbotPluginManifestValidationError,
    );
    try {
      parseQqbotPluginManifest(manifest);
    } catch (error) {
      expect((error as QqbotPluginManifestValidationError).issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'DUPLICATE_TASK_KEY' }),
          expect.objectContaining({ code: 'INVALID_CAPABILITY_KEY' }),
          expect.objectContaining({ code: 'MISSING_TASK_HANDLER' }),
          expect.objectContaining({ code: 'MISSING_TASK_TIMEOUT' }),
          expect.objectContaining({ code: 'UNKNOWN_PERMISSION' }),
        ]),
      );
    }
  });

  it('rejects six-field cron and too-frequent task cron', () => {
    expect(() => normalizeQqbotPluginTaskCron('* * * * * *')).toThrow(
      '定时任务 cron 必须是 5 段表达式',
    );
    expect(() => normalizeQqbotPluginTaskCron('* * * * *')).toThrow(
      '定时任务 cron 不允许每分钟执行',
    );
  });
});
