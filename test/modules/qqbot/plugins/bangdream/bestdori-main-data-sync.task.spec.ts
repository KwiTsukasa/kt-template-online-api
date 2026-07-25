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
      getConfig: (key) =>
        key === BANGDREAM_TSUGU_ENV_KEYS.cacheRoot ? cacheRoot : undefined,
      readJsonFile: async (filePath) =>
        JSON.parse(readFileSync(filePath, 'utf8')),
      readExcelRows: async () => [],
      renameFile: async (from, to) => {
        mkdirSync(dirname(to), { recursive: true });
        renameSync(from, to);
      },
      requestJson: async <T = unknown>(url: string) => {
        requestedUrls.push(`${url}`);
        return { body: { ok: true, url } as T };
      },
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
      getConfig: (key) =>
        key === BANGDREAM_TSUGU_ENV_KEYS.cacheRoot ? cacheRoot : undefined,
      readJsonFile: async (filePath) =>
        JSON.parse(readFileSync(filePath, 'utf8')),
      readExcelRows: async () => [],
      renameFile: async (from, to) => {
        mkdirSync(dirname(to), { recursive: true });
        renameSync(from, to);
      },
      requestJson: async <T = unknown>(url: string) => {
        if (`${url}`.includes('/api/songs/meta/')) {
          throw new Error('network failed');
        }
        return { body: { ok: true } as T };
      },
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
