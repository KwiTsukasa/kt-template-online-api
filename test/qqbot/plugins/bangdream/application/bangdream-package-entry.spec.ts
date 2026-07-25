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

function getConfiguredRuntimeIo(): BangDreamRuntimeIo {
  const io = mockConfigureBangDreamRuntimeIo.mock.calls.at(-1)?.[0];
  if (!io) throw new Error('BangDream runtime IO was not configured');
  return io as BangDreamRuntimeIo;
}

function createWorkbookBuffer() {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet([
    { name: 'Test Card', score: 42 },
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
}

function normalizeGenericBangDreamError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getGenericBangDreamNow() {
  return new Date('2026-06-18T00:00:00.000Z');
}

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
    await expect(plugin.health()).resolves.toMatchObject({
      message: 'BangDream 插件可用',
      status: 'healthy',
    });
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

  it('reports degraded health when catalog health fails instead of throwing', async () => {
    mockContext.checkHealth.mockRejectedValueOnce(
      new Error('Bestdori unavailable'),
    );
    const plugin = createPlugin({
      operations: manifestOperations,
    });

    await expect(plugin.health()).resolves.toMatchObject({
      message: 'Bestdori unavailable',
      status: 'degraded',
    });
  });

  it('normalizes operation errors without an application-service wrapper', async () => {
    const plugin = createPlugin({
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

  it('accepts the generic plugin platform createPlugin contract',
  async () => {
    const plugin = await createGenericBangDreamPlugin({
      getConfig: async () => undefined,
      getConfigMany: async () => ({}),
      getDictItemsByKey: async () => [],
      readAssetFile: async () => Buffer.from([]),
      requestBuffer: async () => Buffer.from([]),
      requestJson: async () => ({}),
      sleep: async () => undefined,
      warn: () => undefined,
    });

    expect(plugin).toEqual(
      expect.objectContaining({
        executeOperation: expect.any(Function),
        health: expect.any(Function),
      }),
    );
  });

  it('maps absolute package asset paths to package-relative generic host reads',
  async () => {
    const readAssetFile = jest.fn(
      async (filePath: string) => Buffer.from(`asset:${filePath}`),
    );
    await createGenericBangDreamPlugin({
      getConfig: async () => undefined,
      getDictItemsByKey: async () => [],
      readAssetFile,
      requestJson: async () => ({}),
      sleep: async () => undefined,
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

  it('preloads sync JSON and parses Excel rows through generic host file reads',
  async () => {
    const fuzzySearchConfig = {
      aliases: { 夏祭り: ['natsumatsuri'] },
      servers: ['cn'],
    };
    const workbookBuffer = createWorkbookBuffer();
    const readJsonFile = jest.fn(
      async (filePath: string) =>
        filePath === 'src/config/static/fuzzy-search-settings.json'
          ? fuzzySearchConfig
          : { filePath },
    );
    const readAssetFile = jest.fn(
      async (filePath: string) =>
        filePath.endsWith('.xlsx') ? workbookBuffer : Buffer.from([]),
    );
    await createGenericBangDreamPlugin({
      getConfig: async () => undefined,
      getDictItemsByKey: async () => [],
      readAssetFile,
      readJsonFile,
      requestJson: async () => ({}),
      sleep: async () => undefined,
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
