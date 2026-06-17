import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  BANGDREAM_BESTDORI_MAIN_DATA_KEYS,
  createBestdoriMainDataSyncTask,
} from '../../../../../src/modules/qqbot/plugins/bangdream/src/application/tasks/bestdori-main-data-sync.task';
import { BANGDREAM_TSUGU_ENV_KEYS } from '../../../../../src/modules/qqbot/plugins/bangdream/src/config/runtime-options';
import { configureBangDreamRuntimeIo } from '../../../../../src/modules/qqbot/plugins/bangdream/src/infrastructure/integration/runtime-io';

describe('BangDream Bestdori main-data sync task', () => {
  let cacheRoot: string;
  let consoleInfoSpy: jest.SpyInstance;

  beforeEach(() => {
    cacheRoot = mkdtempSync(join(tmpdir(), 'bangdream-sync-'));
    consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation();
  });

  afterEach(() => {
    consoleInfoSpy.mockRestore();
    rmSync(cacheRoot, { force: true, recursive: true });
  });

  it('downloads main JSON data, writes cache atomically, and returns safe summary', async () => {
    const requestedUrls: string[] = [];
    configureBangDreamRuntimeIo({
      /**
       * 读取 BangDream回调数据。
       * @param key - 键名；限定 BangDream查询范围。
       */
      getConfig: (key) =>
        key === BANGDREAM_TSUGU_ENV_KEYS.cacheRoot ? cacheRoot : undefined,
      /**
       * 执行 BangDream回调。
       * @param filePath - BangDream路径；转换 JSON 文本。
       */
      readJsonFile: async (filePath) =>
        JSON.parse(readFileSync(filePath, 'utf8')),
      /**
       * 执行 BangDream回调。
       */
      readExcelRows: async () => [],
      /**
       * 执行 BangDream回调。
       * @param from - from 输入；驱动 `renameSync()` 的 BangDream步骤。
       * @param to - to 输入；驱动 `mkdirSync()`、`renameSync()` 的 BangDream步骤。
       */
      renameFile: async (from, to) => {
        mkdirSync(dirname(to), { recursive: true });
        renameSync(from, to);
      },
      /**
       * 执行 BangDream回调。
       * @param url - 访问地址；影响 requestJson 的返回值。
       */
      requestJson: async <T = unknown>(url: string) => {
        requestedUrls.push(`${url}`);
        return { body: { ok: true, url } as T };
      },
      /**
       * 执行 BangDream回调。
       * @param filePath - BangDream路径；驱动 `mkdirSync()`、`writeFileSync()` 的 BangDream步骤。
       * @param data - 业务数据；承载 BangDream新增、更新、导入或执行字段。
       */
      writeJsonFile: async (filePath, data) => {
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, `${JSON.stringify(data)}\n`);
      },
    });

    const task = createBestdoriMainDataSyncTask();
    const output = await task.execute({ keys: ['songs', 'meta'] });

    expect(output).toMatchObject({
      failedCount: 0,
      successCount: 2,
      syncedKeys: ['songs', 'meta'],
    });
    expect(
      readFileSync(join(cacheRoot, 'bestdori', 'songs.json'), 'utf8'),
    ).toContain('"ok":true');
    expect(
      readFileSync(join(cacheRoot, 'bestdori', 'meta.json'), 'utf8'),
    ).toContain('"ok":true');
    expect(requestedUrls).toHaveLength(2);
    expect(JSON.stringify(output)).not.toContain('/api/songs/all');
  });

  it('keeps existing cache file when one key fails', async () => {
    const metaCachePath = join(cacheRoot, 'bestdori', 'meta.json');
    mkdirSync(dirname(metaCachePath), { recursive: true });
    writeFileSync(metaCachePath, '{"previous":true}\n');
    configureBangDreamRuntimeIo({
      /**
       * 读取 BangDream回调数据。
       * @param key - 键名；限定 BangDream查询范围。
       */
      getConfig: (key) =>
        key === BANGDREAM_TSUGU_ENV_KEYS.cacheRoot ? cacheRoot : undefined,
      /**
       * 执行 BangDream回调。
       * @param filePath - BangDream路径；转换 JSON 文本。
       */
      readJsonFile: async (filePath) =>
        JSON.parse(readFileSync(filePath, 'utf8')),
      /**
       * 执行 BangDream回调。
       */
      readExcelRows: async () => [],
      /**
       * 执行 BangDream回调。
       * @param from - from 输入；驱动 `renameSync()` 的 BangDream步骤。
       * @param to - to 输入；驱动 `mkdirSync()`、`renameSync()` 的 BangDream步骤。
       */
      renameFile: async (from, to) => {
        mkdirSync(dirname(to), { recursive: true });
        renameSync(from, to);
      },
      /**
       * 执行 BangDream回调。
       * @param url - 访问地址；决定 BangDream条件分支。
       */
      requestJson: async <T = unknown>(url: string) => {
        if (`${url}`.includes('/api/songs/meta/')) {
          throw new Error('network failed');
        }
        return { body: { ok: true } as T };
      },
      /**
       * 执行 BangDream回调。
       * @param filePath - BangDream路径；驱动 `mkdirSync()`、`writeFileSync()` 的 BangDream步骤。
       * @param data - 业务数据；承载 BangDream新增、更新、导入或执行字段。
       */
      writeJsonFile: async (filePath, data) => {
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, `${JSON.stringify(data)}\n`);
      },
    });

    const task = createBestdoriMainDataSyncTask();
    await expect(task.execute({ keys: ['songs', 'meta'] })).rejects.toThrow(
      'BangDream Bestdori 主数据同步失败',
    );

    expect(readFileSync(metaCachePath, 'utf8')).toContain('"previous":true');
    expect(existsSync(join(cacheRoot, 'bestdori', 'songs.json'))).toBe(true);
    expect(BANGDREAM_BESTDORI_MAIN_DATA_KEYS).toEqual(
      expect.arrayContaining(['songs', 'meta', 'cards', 'skills', 'events']),
    );
  });
});
