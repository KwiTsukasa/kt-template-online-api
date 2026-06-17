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

const manifestOperations = mockManifestOperations.map(([key, handlerName]) => ({
  handlerName,
  key,
}));

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
});
