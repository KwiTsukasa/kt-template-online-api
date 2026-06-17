import * as path from 'path';
import * as XLSX from 'xlsx';

jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/application/catalog/bangdream-catalog-cache',
  () => ({
    __esModule: true,
    default: {},
    waitForBangDreamCatalogReady: jest.fn().mockResolvedValue(undefined),
  }),
);

const mockContext = {
  checkHealth: jest.fn(),
  refreshDictionaryCache: jest.fn(),
};
const mockConfigureBangDreamRuntimeIo = jest.fn();
const mockReadBangDreamRuntimeConfig = jest.fn(() => undefined);
const mockPreloadBangDreamRenderAssets = jest.fn();
const mockOperationModules = new Map<string, jest.Mock>();
const mockManifestOperations = [
  ['bangdream.song.search', 'searchSong'],
  ['bangdream.song.chart', 'getSongChart'],
  ['bangdream.song.random', 'randomSong'],
  ['bangdream.song.meta', 'getSongMeta'],
  ['bangdream.card.search', 'searchCard'],
  ['bangdream.card.illustration', 'getCardIllustration'],
  ['bangdream.character.search', 'searchCharacter'],
  ['bangdream.event.search', 'searchEvent'],
  ['bangdream.event.stage', 'getEventStage'],
  ['bangdream.player.search', 'searchPlayer'],
  ['bangdream.gacha.search', 'searchGacha'],
  ['bangdream.gacha.simulate', 'simulateGacha'],
  ['bangdream.cutoff.detail', 'getCutoffDetail'],
  ['bangdream.cutoff.all', 'getCutoffAll'],
  ['bangdream.cutoff.recent', 'getCutoffRecent'],
] as const;

jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/application/bangdream-command-context',
  () => ({
    BangDreamCommandContext: jest.fn(() => mockContext),
  }),
);

jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/runtime-io',
  () => ({
    configureBangDreamRuntimeIo: mockConfigureBangDreamRuntimeIo,
    readBangDreamRuntimeConfig: mockReadBangDreamRuntimeConfig,
  }),
);

jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/application/render-assets',
  () => ({
    preloadBangDreamRenderAssets: mockPreloadBangDreamRenderAssets,
  }),
);

jest.mock('@/modules/qqbot/plugins/bangdream/src/operations', () => ({
  /**
   * 读取 BangDream回调数据。
   */
  getBangDreamOperationsByHandlerName: () =>
    new Map(
      mockManifestOperations.map(([key, handlerName]) => {
        const execute = jest.fn();
        mockOperationModules.set(key, execute);
        return [
          handlerName,
          {
            catalogKeys:
              key === 'bangdream.song.search'
                ? ['songs', 'meta', 'singer', 'bands', 'characters', 'events']
                : undefined,
            execute,
            handlerName,
          },
        ];
      }),
    ),
}));

import { createPlugin } from '@/modules/qqbot/plugins/bangdream/src';
import { BangDreamCommandContext } from '@/modules/qqbot/plugins/bangdream/src/application/bangdream-command-context';
import { waitForBangDreamCatalogReady } from '@/modules/qqbot/plugins/bangdream/src/application/catalog/bangdream-catalog-cache';
import {
  fuzzySearchPath,
  projectRoot,
} from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import type { BangDreamRuntimeIo } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/runtime-io';

const manifestOperations = mockManifestOperations.map(([key, handlerName]) => ({
  handlerName,
  key,
}));
const bangDreamPackageRoot = path.resolve(projectRoot, '..');

/**
 * Creates a minimal generic BangDream manifest for package-entry adapter tests.
 * @returns Manifest descriptor fields required by the generic worker `createPlugin` contract.
 */
function createGenericBangDreamManifest() {
  return {
    key: 'bangdream',
    pluginKey: 'bangdream',
    name: 'BangDream',
    version: '1.0.0',
    entry: 'src/index.ts',
    runtime: {
      configKeys: ['BANGDREAM_TSUGU_BESTDORI_BASE_URL'],
      maxConcurrency: 1,
      memoryMb: 256,
      timeoutMs: 30000,
      workerType: 'thread',
    },
    operations: manifestOperations,
    tasks: [],
    events: [],
  };
}

/**
 * Returns the BangDream runtime IO adapter that the package entry registered during generic creation.
 * @returns Runtime IO object passed to `configureBangDreamRuntimeIo`.
 */
function getConfiguredRuntimeIo(): BangDreamRuntimeIo {
  const io = mockConfigureBangDreamRuntimeIo.mock.calls.at(-1)?.[0];
  if (!io) throw new Error('BangDream runtime IO was not configured');
  return io as BangDreamRuntimeIo;
}

/**
 * Creates a deterministic XLSX workbook buffer for generic readExcelRows adapter tests.
 * @returns XLSX buffer containing one data row on the first worksheet.
 */
function createWorkbookBuffer() {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet([
    { name: 'Test Card', score: 42 },
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
}

/**
 * Normalizes arbitrary BangDream package errors the same way the generic worker passes errors to entries.
 * @param error - Error or thrown value produced while creating or executing the plugin.
 * @returns Stable message string consumed by the package-local error adapter.
 */
function normalizeGenericBangDreamError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Provides a deterministic generic worker clock for package entry creation.
 * @returns Fixed Date used to prove the entry accepts the generic `now` callback.
 */
function getGenericBangDreamNow() {
  return new Date('2026-06-18T00:00:00.000Z');
}

/**
 * Creates the generic BangDream plugin with a supplied host and default config snapshot.
 * @param host - Generic host facade whose methods are inspected by adapter tests.
 * @returns Plugin instance created through the generic worker contract.
 */
async function createGenericBangDreamPlugin(host: Record<string, unknown>) {
  return await createPlugin({
    host,
    manifest: createGenericBangDreamManifest(),
    normalizeError: normalizeGenericBangDreamError,
    now: getGenericBangDreamNow,
    runtime: {
      configSnapshot: {
        BANGDREAM_TSUGU_BESTDORI_BASE_URL: 'https://example.invalid/bestdori',
      },
      installationId: 'install-bangdream',
    },
  });
}

describe('BangDream package entry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOperationModules.clear();
    mockContext.refreshDictionaryCache.mockResolvedValue(undefined);
    mockContext.checkHealth.mockResolvedValue(true);
    mockPreloadBangDreamRenderAssets.mockResolvedValue(undefined);
  });

  it('binds every manifest operation directly to the package operation modules', async () => {
    const io = {
      requestJson: jest.fn(),
    } as any;
    const plugin = createPlugin({
      io,
      operations: manifestOperations,
    });
    const songSearch = mockOperationModules.get('bangdream.song.search');
    songSearch?.mockResolvedValueOnce({
      imageCount: 1,
      operationKey: 'bangdream.song.search',
      query: '夏祭り',
      replyText: '[CQ:image,file=base64://base64-song-card]',
      source: 'BangDream 内置插件',
    });

    expect(mockConfigureBangDreamRuntimeIo).toHaveBeenCalledWith(io);
    expect(BangDreamCommandContext).toHaveBeenCalledWith({
      io,
      operations: manifestOperations,
    });

    await plugin.activate();
    await expect(plugin.health()).resolves.toBe(true);
    await expect(
      plugin.executeOperation('bangdream.song.search', { text: '夏祭り' }),
    ).resolves.toMatchObject({
      imageCount: 1,
      query: '夏祭り',
    });

    expect(mockContext.refreshDictionaryCache).toHaveBeenCalledTimes(1);
    expect(mockPreloadBangDreamRenderAssets).toHaveBeenCalledTimes(1);
    expect(waitForBangDreamCatalogReady).toHaveBeenCalledWith([
      'songs',
      'meta',
      'singer',
      'bands',
      'characters',
      'events',
    ]);
    expect(songSearch).toHaveBeenCalledWith({ text: '夏祭り' }, mockContext);
    expect(manifestOperations).toHaveLength(15);
  });

  it('normalizes operation errors without an application-service wrapper', async () => {
    const plugin = createPlugin({
      /**
       * 执行 BangDream回调。
       * @param error - 异常或失败对象；提取状态码、错误体、堆栈或失败原因。
       */
      normalizeError: (error) => `normalized:${error}`,
      operations: manifestOperations,
    });
    mockOperationModules
      .get('bangdream.event.search')
      ?.mockRejectedValueOnce('图片渲染失败');

    await expect(
      plugin.executeOperation('bangdream.event.search', { text: '50' }),
    ).rejects.toThrow('normalized:图片渲染失败');
  });

  it('accepts the generic plugin platform createPlugin contract', /**
   * Verifies the BangDream package entry can be created from the generic worker descriptor contract.
   * @returns Assertion promise proving the entry exposes command execution and health hooks.
   */
  async () => {
    const plugin = await createGenericBangDreamPlugin({
      /**
       * Simulates the generic host config RPC; the BangDream adapter should prefer runtime.configSnapshot for sync config reads.
       * @returns No value so the test fails if sync package code depends on this async RPC path.
       */
      getConfig: async () => undefined,
      /**
       * Simulates the generic host batch config RPC that is present on real worker hosts.
       * @returns Empty config map because this contract test uses the startup snapshot as its config source.
       */
      getConfigMany: async () => ({}),
      /**
       * Simulates dictionary lookup for BangDream alias/server mappings during plugin activation.
       * @returns Empty dictionary list because this test only checks entry construction.
       */
      getDictItemsByKey: async () => [],
      /**
       * Simulates package asset reads through the generic worker host boundary.
       * @returns Empty buffer because no render asset is consumed while creating the plugin instance.
       */
      readAssetFile: async () => Buffer.from([]),
      /**
       * Simulates binary HTTP requests for BangDream resource downloads.
       * @returns Empty buffer because this contract test never executes a networked operation.
       */
      requestBuffer: async () => Buffer.from([]),
      /**
       * Simulates JSON HTTP requests for BangDream catalog/data clients.
       * @returns Empty object because this contract test only asserts the created plugin shape.
       */
      requestJson: async () => ({}),
      /**
       * Simulates host-mediated sleep used by retry logic.
       * @returns Resolved promise without delaying the package-entry contract test.
       */
      sleep: async () => undefined,
      /**
       * Simulates host warning logging for non-fatal worker adapter notices.
       * @returns Nothing because warning output is irrelevant to plugin construction.
       */
      warn: () => undefined,
    });

    expect(plugin).toEqual(
      expect.objectContaining({
        executeOperation: expect.any(Function),
        health: expect.any(Function),
      }),
    );
  });

  it('maps absolute package asset paths to package-relative generic host reads', /**
   * Verifies the generic BangDream IO adapter never sends absolute package paths to host file APIs.
   * @returns Assertion promise covering package-root relative host path normalization.
   */
  async () => {
    const readAssetFile = jest.fn(
      /**
       * Simulates generic host package asset reads and records the normalized path.
       * @param filePath - Package-relative path received by the host bridge.
       * @returns Distinct asset bytes used to prove the adapter returns host content.
       */
      async (filePath: string) => Buffer.from(`asset:${filePath}`),
    );
    await createGenericBangDreamPlugin({
      /**
       * Simulates the generic host config RPC; sync BangDream config must come from the runtime snapshot.
       * @returns No value because this test only exercises file IO path normalization.
       */
      getConfig: async () => undefined,
      /**
       * Simulates dictionary lookup for activation-time cache refresh.
       * @returns Empty list because file IO path normalization is independent of dictionaries.
       */
      getDictItemsByKey: async () => [],
      readAssetFile,
      /**
       * Simulates JSON HTTP host calls that are not used in this path-normalization test.
       * @returns Empty object for unused request paths.
       */
      requestJson: async () => ({}),
      /**
       * Simulates host sleep used by retry paths outside this test.
       * @returns Resolved promise without delay.
       */
      sleep: async () => undefined,
      /**
       * Simulates host warning logging for non-fatal adapter messages.
       * @returns Nothing because warning output is irrelevant here.
       */
      warn: () => undefined,
    });
    const io = getConfiguredRuntimeIo();
    const absoluteAssetPath = path.join(
      bangDreamPackageRoot,
      'src',
      'assets',
      'BG',
      'live.png',
    );

    await expect(io.readAssetFile?.(absoluteAssetPath)).resolves.toEqual(
      Buffer.from('asset:src/assets/BG/live.png'),
    );

    expect(readAssetFile).toHaveBeenCalledWith('src/assets/BG/live.png');
  });

  it('preloads sync JSON and parses Excel rows through generic host file reads', /**
   * Verifies generic BangDream IO supplies sync JSON reads and XLSX parsing without absolute host paths.
   * @returns Assertion promise covering synchronous JSON cache and XLSX buffer parsing.
   */
  async () => {
    const fuzzySearchConfig = {
      aliases: { 夏祭り: ['natsumatsuri'] },
      servers: ['cn'],
    };
    const workbookBuffer = createWorkbookBuffer();
    const readJsonFile = jest.fn(
      /**
       * Simulates generic host JSON reads used to preload synchronous BangDream config files.
       * @param filePath - Package-relative JSON path received by the host bridge.
       * @returns Fuzzy-search config snapshot for sync package consumers.
       */
      async (filePath: string) =>
        filePath === 'src/config/static/fuzzy-search-settings.json'
          ? fuzzySearchConfig
          : { filePath },
    );
    const readAssetFile = jest.fn(
      /**
       * Simulates generic host binary package reads for Excel static patch files.
       * @param filePath - Package-relative asset or config path received by the host bridge.
       * @returns XLSX workbook bytes for static patch parsing.
       */
      async (filePath: string) =>
        filePath.endsWith('.xlsx') ? workbookBuffer : Buffer.from([]),
    );
    await createGenericBangDreamPlugin({
      /**
       * Simulates the generic host config RPC; sync BangDream config must come from the runtime snapshot.
       * @returns No value because this test only exercises package file IO.
       */
      getConfig: async () => undefined,
      /**
       * Simulates dictionary lookup for activation-time cache refresh.
       * @returns Empty list because file IO behavior is independent of dictionaries.
       */
      getDictItemsByKey: async () => [],
      readAssetFile,
      readJsonFile,
      /**
       * Simulates JSON HTTP host calls that are not used in this file IO test.
       * @returns Empty object for unused request paths.
       */
      requestJson: async () => ({}),
      /**
       * Simulates host sleep used by retry paths outside this test.
       * @returns Resolved promise without delay.
       */
      sleep: async () => undefined,
      /**
       * Simulates host warning logging for non-fatal adapter messages.
       * @returns Nothing because warning output is irrelevant here.
       */
      warn: () => undefined,
    });
    const io = getConfiguredRuntimeIo();
    const absoluteExcelPath = path.join(
      bangDreamPackageRoot,
      'src',
      'config',
      'static',
      'cards.xlsx',
    );

    expect(io.readJsonFileSync?.(fuzzySearchPath)).toEqual(fuzzySearchConfig);
    await expect(io.readExcelRows?.(absoluteExcelPath)).resolves.toEqual([
      { name: 'Test Card', score: 42 },
    ]);

    expect(readJsonFile).toHaveBeenCalledWith(
      'src/config/static/fuzzy-search-settings.json',
    );
    expect(readAssetFile).toHaveBeenCalledWith('src/config/static/cards.xlsx');
  });
});
