import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  BangDreamCommandInput,
  BangDreamOperationHandlerName,
  BangDreamOperationKey,
} from '@/modules/qqbot/plugins/bangdream/src/domain/common/bangdream.types';

/**
 * 执行 BangDream 插件流程。
 * @param name - 名称文本；影响 mockImageBuffer 的返回值。
 */
const mockImageBuffer = (name: string) => Buffer.from(`image:${name}`);

const mockFuzzySearch = jest.fn(() => ({ song: [136] }));
const mockSongCtor = jest.fn().mockImplementation((songId: number) => ({
  songId,
}));
const mockDrawSongDetail = jest.fn(async () => [
  mockImageBuffer('song-detail'),
]);
const mockDrawSongList = jest.fn(async () => [mockImageBuffer('song-list')]);
const mockDrawSongChart = jest.fn(async () => [mockImageBuffer('song-chart')]);
const mockDrawSongRandom = jest.fn(async () => [
  mockImageBuffer('song-random'),
]);
const mockDrawSongMetaList = jest.fn(async () => [
  mockImageBuffer('song-meta'),
]);

const mockDrawCardDetail = jest.fn(async () => [
  mockImageBuffer('card-detail'),
]);
const mockDrawCardList = jest.fn(async () => [mockImageBuffer('card-list')]);
const mockCardGetTrainingStatusList = jest.fn(() => [false, true]);
const mockCardGetCardIllustrationImageBuffer = jest.fn(
  async (trainingStatus: boolean) =>
    mockImageBuffer(`card-illustration-${trainingStatus}`),
);
const mockCardCtor = jest.fn().mockImplementation((cardId: number) => ({
  cardId,
  getCardIllustrationImageBuffer: mockCardGetCardIllustrationImageBuffer,
  getTrainingStatusList: mockCardGetTrainingStatusList,
  isExist: true,
}));

const mockDrawCharacterDetail = jest.fn(async () => [
  mockImageBuffer('character-detail'),
]);
const mockDrawCharacterList = jest.fn(async () => [
  mockImageBuffer('character-list'),
]);

const mockGetPresentEvent = jest.fn(() => ({ eventId: 50 }));
const mockDrawEventDetail = jest.fn(async () => [
  mockImageBuffer('event-detail'),
]);
const mockDrawEventList = jest.fn(async () => [mockImageBuffer('event-list')]);
const mockDrawEventStage = jest.fn(async () =>
  Array.from({ length: 5 }, (_, index) =>
    mockImageBuffer(`event-stage-${index}`),
  ),
);

const mockDrawPlayerDetail = jest.fn(async () => [
  mockImageBuffer('player-detail'),
]);

const mockDrawGachaDetail = jest.fn(async () => [
  mockImageBuffer('gacha-detail'),
]);
const mockDrawRandomGacha = jest.fn(async () => [
  mockImageBuffer('gacha-simulate'),
]);
const mockGachaCtor = jest.fn().mockImplementation((gachaId: number) => ({
  gachaId,
  type: 'normal',
}));
const mockGetPresentGachaList = jest.fn(async () => [
  {
    gachaId: 300,
    type: 'normal',
  },
]);

const mockDrawCutoffDetail = jest.fn(async () => [
  mockImageBuffer('cutoff-detail'),
]);
const mockDrawCutoffEventTop = jest.fn(async () => [
  mockImageBuffer('cutoff-event-top'),
]);
const mockDrawCutoffAll = jest.fn(async () => [mockImageBuffer('cutoff-all')]);
const mockDrawCutoffListOfRecentEvent = jest.fn(async () => [
  mockImageBuffer('cutoff-recent'),
]);

jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/domain/search/fuzzy-search',
  () => ({
    fuzzySearch: mockFuzzySearch,
  }),
);
jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/domain/song/song.model',
  () => ({
    Song: mockSongCtor,
  }),
);
jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/domain/song/song-detail.renderer',
  () => ({
    drawSongDetail: mockDrawSongDetail,
  }),
);
jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/domain/song/song-search.renderer',
  () => ({
    drawSongList: mockDrawSongList,
  }),
);
jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/domain/song/song-chart.renderer',
  () => ({
    drawSongChart: mockDrawSongChart,
  }),
);
jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/domain/song/song-random.renderer',
  () => ({
    drawSongRandom: mockDrawSongRandom,
  }),
);
jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/domain/song/song-meta.renderer',
  () => ({
    drawSongMetaList: mockDrawSongMetaList,
  }),
);
jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/domain/card/card-detail.renderer',
  () => ({
    drawCardDetail: mockDrawCardDetail,
  }),
);
jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/domain/card/card-search.renderer',
  () => ({
    drawCardList: mockDrawCardList,
  }),
);
jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/domain/card/card.model',
  () => ({
    Card: mockCardCtor,
  }),
);
jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/domain/character/character-detail.renderer',
  () => ({
    drawCharacterDetail: mockDrawCharacterDetail,
  }),
);
jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/domain/character/character-search.renderer',
  () => ({
    drawCharacterList: mockDrawCharacterList,
  }),
);
jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/domain/event/event.model',
  () => ({
    getPresentEvent: mockGetPresentEvent,
  }),
);
jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/domain/event/event-detail.renderer',
  () => ({
    drawEventDetail: mockDrawEventDetail,
  }),
);
jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/domain/event/event-search.renderer',
  () => ({
    drawEventList: mockDrawEventList,
  }),
);
jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/domain/event/event-stage.renderer',
  () => ({
    drawEventStage: mockDrawEventStage,
  }),
);
jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/domain/player/player-detail.renderer',
  () => ({
    drawPlayerDetail: mockDrawPlayerDetail,
  }),
);
jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/domain/gacha/gacha-detail.renderer',
  () => ({
    drawGachaDetail: mockDrawGachaDetail,
  }),
);
jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/domain/gacha/gacha-simulate.renderer',
  () => ({
    drawRandomGacha: mockDrawRandomGacha,
  }),
);
jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/domain/gacha/gacha.model',
  () => ({
    Gacha: mockGachaCtor,
    getPresentGachaList: mockGetPresentGachaList,
  }),
);
jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/domain/policy/gacha.policy',
  () => ({
    BANGDREAM_GACHA_DEFAULT_SPIN_COUNT: 10,
    isBirthdayGachaType: jest.fn(() => false),
  }),
);
jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/domain/cutoff/cutoff-detail.renderer',
  () => ({
    drawCutoffDetail: mockDrawCutoffDetail,
  }),
);
jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/domain/cutoff/cutoff-event-top.renderer',
  () => ({
    drawCutoffEventTop: mockDrawCutoffEventTop,
  }),
);
jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/domain/cutoff/cutoff-all.renderer',
  () => ({
    drawCutoffAll: mockDrawCutoffAll,
  }),
);
jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/domain/cutoff/cutoff-recent.renderer',
  () => ({
    drawCutoffListOfRecentEvent: mockDrawCutoffListOfRecentEvent,
  }),
);

type ManifestOperation = {
  handlerName: BangDreamOperationHandlerName;
  key: BangDreamOperationKey;
};

type BranchCase = {
  assertBranch: () => void;
  expectedImageCount: number;
  expectedQuery: string;
  input: BangDreamCommandInput;
  key: BangDreamOperationKey;
  name: string;
};

const branchCases: BranchCase[] = [
  {
    /**
     * 执行 BangDream回调。
     */
    assertBranch: () => expect(mockDrawSongDetail).toHaveBeenCalledTimes(1),
    expectedImageCount: 1,
    expectedQuery: '136',
    input: { text: '136' },
    key: 'bangdream.song.search',
    name: 'song.search numeric detail',
  },
  {
    /**
     * 执行 BangDream回调。
     */
    assertBranch: () => expect(mockDrawSongList).toHaveBeenCalledTimes(1),
    expectedImageCount: 1,
    expectedQuery: '夏祭',
    input: { text: '夏祭' },
    key: 'bangdream.song.search',
    name: 'song.search fuzzy list',
  },
  {
    /**
     * 执行 BangDream回调。
     */
    assertBranch: () => expect(mockDrawSongChart).toHaveBeenCalledTimes(1),
    expectedImageCount: 1,
    expectedQuery: '136 3',
    input: { text: '136 expert' },
    key: 'bangdream.song.chart',
    name: 'song.chart explicit difficulty',
  },
  {
    /**
     * 执行 BangDream回调。
     */
    assertBranch: () => expect(mockDrawSongRandom).toHaveBeenCalledTimes(1),
    expectedImageCount: 1,
    expectedQuery: '随机曲',
    input: { text: '' },
    key: 'bangdream.song.random',
    name: 'song.random empty query',
  },
  {
    /**
     * 执行 BangDream回调。
     */
    assertBranch: () => expect(mockDrawSongMetaList).toHaveBeenCalledTimes(1),
    expectedImageCount: 1,
    expectedQuery: 'cn',
    input: { text: 'cn' },
    key: 'bangdream.song.meta',
    name: 'song.meta server',
  },
  {
    /**
     * 执行 BangDream回调。
     */
    assertBranch: () => expect(mockDrawCardDetail).toHaveBeenCalledTimes(1),
    expectedImageCount: 1,
    expectedQuery: '1001',
    input: { text: '1001' },
    key: 'bangdream.card.search',
    name: 'card.search numeric detail',
  },
  {
    /**
     * 执行 BangDream回调。
     */
    assertBranch: () => expect(mockDrawCardList).toHaveBeenCalledTimes(1),
    expectedImageCount: 1,
    expectedQuery: '香澄',
    input: { text: '香澄' },
    key: 'bangdream.card.search',
    name: 'card.search fuzzy list',
  },
  {
    /**
     * 执行 BangDream回调。
     */
    assertBranch: () => {
      expect(mockCardCtor).toHaveBeenCalledWith(1001);
      expect(mockCardGetCardIllustrationImageBuffer).toHaveBeenCalledTimes(2);
    },
    expectedImageCount: 2,
    expectedQuery: '1001',
    input: { text: '1001' },
    key: 'bangdream.card.illustration',
    name: 'card.illustration trained variants',
  },
  {
    /**
     * 执行 BangDream回调。
     */
    assertBranch: () =>
      expect(mockDrawCharacterDetail).toHaveBeenCalledTimes(1),
    expectedImageCount: 1,
    expectedQuery: '1',
    input: { text: '1' },
    key: 'bangdream.character.search',
    name: 'character.search numeric detail',
  },
  {
    /**
     * 执行 BangDream回调。
     */
    assertBranch: () => expect(mockDrawCharacterList).toHaveBeenCalledTimes(1),
    expectedImageCount: 1,
    expectedQuery: '香澄',
    input: { text: '香澄' },
    key: 'bangdream.character.search',
    name: 'character.search fuzzy list',
  },
  {
    /**
     * 执行 BangDream回调。
     */
    assertBranch: () => expect(mockDrawEventDetail).toHaveBeenCalledTimes(1),
    expectedImageCount: 1,
    expectedQuery: '50',
    input: { text: '50' },
    key: 'bangdream.event.search',
    name: 'event.search numeric detail',
  },
  {
    /**
     * 执行 BangDream回调。
     */
    assertBranch: () => expect(mockDrawEventList).toHaveBeenCalledTimes(1),
    expectedImageCount: 1,
    expectedQuery: 'summer',
    input: { text: 'summer' },
    key: 'bangdream.event.search',
    name: 'event.search fuzzy list',
  },
  {
    /**
     * 执行 BangDream回调。
     */
    assertBranch: () =>
      expect(mockDrawEventStage).toHaveBeenCalledWith(50, 3, true, true),
    expectedImageCount: 5,
    expectedQuery: '50',
    input: { text: '50 -m cn' },
    key: 'bangdream.event.stage',
    name: 'event.stage meta split output',
  },
  {
    /**
     * 执行 BangDream回调。
     */
    assertBranch: () => expect(mockDrawPlayerDetail).toHaveBeenCalledTimes(1),
    expectedImageCount: 1,
    expectedQuery: '123456',
    input: { text: '123456 cn' },
    key: 'bangdream.player.search',
    name: 'player.search server detail',
  },
  {
    /**
     * 执行 BangDream回调。
     */
    assertBranch: () => expect(mockDrawGachaDetail).toHaveBeenCalledTimes(1),
    expectedImageCount: 1,
    expectedQuery: '300',
    input: { text: '300' },
    key: 'bangdream.gacha.search',
    name: 'gacha.search detail',
  },
  {
    /**
     * 执行 BangDream回调。
     */
    assertBranch: () => {
      expect(mockGachaCtor).toHaveBeenCalledWith(300);
      expect(mockDrawRandomGacha).toHaveBeenCalledTimes(1);
    },
    expectedImageCount: 1,
    expectedQuery: '10 300',
    input: { text: '10 300' },
    key: 'bangdream.gacha.simulate',
    name: 'gacha.simulate explicit gacha',
  },
  {
    /**
     * 执行 BangDream回调。
     */
    assertBranch: () => {
      expect(mockGetPresentGachaList).toHaveBeenCalledWith(3);
      expect(mockDrawRandomGacha).toHaveBeenCalledTimes(1);
    },
    expectedImageCount: 1,
    expectedQuery: '10',
    input: { text: '10 cn' },
    key: 'bangdream.gacha.simulate',
    name: 'gacha.simulate present gacha fallback',
  },
  {
    /**
     * 执行 BangDream回调。
     */
    assertBranch: () => expect(mockDrawCutoffDetail).toHaveBeenCalledTimes(1),
    expectedImageCount: 1,
    expectedQuery: '1000 50',
    input: { text: 'ycx 1000 cn', eventId: 50 },
    key: 'bangdream.cutoff.detail',
    name: 'cutoff.detail tier detail',
  },
  {
    /**
     * 执行 BangDream回调。
     */
    assertBranch: () => expect(mockDrawCutoffEventTop).toHaveBeenCalledTimes(1),
    expectedImageCount: 1,
    expectedQuery: '10 50',
    input: { eventId: 50, mainServer: 'cn', tier: 10 },
    key: 'bangdream.cutoff.detail',
    name: 'cutoff.detail top10 branch',
  },
  {
    /**
     * 执行 BangDream回调。
     */
    assertBranch: () => expect(mockDrawCutoffAll).toHaveBeenCalledTimes(1),
    expectedImageCount: 1,
    expectedQuery: '50',
    input: { eventId: 50, text: 'cn' },
    key: 'bangdream.cutoff.all',
    name: 'cutoff.all event',
  },
  {
    /**
     * 执行 BangDream回调。
     */
    assertBranch: () =>
      expect(mockDrawCutoffListOfRecentEvent).toHaveBeenCalledTimes(1),
    expectedImageCount: 1,
    expectedQuery: '1000 50',
    input: { text: '1000 50 cn' },
    key: 'bangdream.cutoff.recent',
    name: 'cutoff.recent tier',
  },
];

const manifestOperations: ManifestOperation[] = JSON.parse(
  readFileSync(
    join(process.cwd(), 'src/modules/qqbot/plugins/bangdream/plugin.json'),
    'utf8',
  ),
).operations;
let operationsByKey: Map<BangDreamOperationKey, any>;

describe('BangDream operation branch matrix', () => {
  beforeAll(async () => {
    const { getBangDreamOperationsByHandlerName } =
      await import('@/modules/qqbot/plugins/bangdream/src/operations');
    const operationsByHandlerName = getBangDreamOperationsByHandlerName();
    operationsByKey = new Map(
      manifestOperations.map((operation) => [
        operation.key,
        operationsByHandlerName.get(operation.handlerName),
      ]),
    );
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('covers every manifest command operation in the branch matrix', () => {
    expect([...new Set(branchCases.map((item) => item.key))].sort()).toEqual(
      manifestOperations.map((operation) => operation.key).sort(),
    );
  });

  it.each(branchCases)(
    'executes $name and compares output contract',
    async (branchCase) => {
      const operation = operationsByKey.get(branchCase.key);
      expect(operation).toBeDefined();

      const output = await operation!.execute(
        branchCase.input,
        createCommandContext(),
      );

      expect(output).toMatchObject({
        imageCount: branchCase.expectedImageCount,
        operationKey: branchCase.key,
        query: branchCase.expectedQuery,
        source: 'BangDream 内置插件',
      });
      expect(
        output.replyText.match(/\[CQ:image,file=base64:\/\//g),
      ).toHaveLength(branchCase.expectedImageCount);
      branchCase.assertBranch();
    },
  );
});

/**
 * 创建 BangDream 插件对象或配置。
 */
function createCommandContext() {
  /**
   * 执行 BangDream 插件局部步骤。
   * @param input - input 输入；使用 `query`、`text`、`raw` 字段生成结果。
   */
  const pickText = (input: BangDreamCommandInput) =>
    `${input.query || input.text || input.raw || ''}`.trim();
  /**
   * 执行 BangDream 插件局部步骤。
   * @param value - 待转换值；驱动 `Number()` 的 BangDream步骤。
   */
  const optionalNumber = (value: unknown) => {
    if (value === undefined || value === null || value === '') return undefined;
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : undefined;
  };
  /**
   * 收集 BangDream 插件数据。
   * @param input - input 输入；使用 `args` 字段生成结果。
   */
  const getTokens = (input: BangDreamCommandInput) => {
    if (Array.isArray(input.args)) {
      return input.args.map((item) => `${item}`.trim()).filter(Boolean);
    }
    return pickText(input).split(/\s+/).filter(Boolean);
  };
  /**
   * 执行 BangDream 插件局部步骤。
   * @param value - 待转换值；决定 BangDream条件分支。
   */
  const normalizeServer = (value: unknown) => {
    if (value === undefined || value === null || value === '') return undefined;
    const raw = `${value}`.trim().toLowerCase();
    const mapped: Record<string, number> = {
      cn: 3,
      en: 1,
      jp: 0,
      kr: 4,
      tw: 2,
      国服: 3,
      日服: 0,
    };
    const numeric = optionalNumber(raw);
    if (numeric !== undefined && numeric >= 0 && numeric <= 4) {
      return numeric;
    }
    return mapped[raw];
  };
  /**
   * 执行 BangDream 插件局部步骤。
   * @param input - input 输入；使用 `mainServer`、`serverName`、`server` 字段生成结果。
   * @param tokens - 协议 token；执行 `tokens.find()` 对应的 BangDream步骤。
   */
  const pickMainServer = (input: BangDreamCommandInput, tokens: string[]) => {
    const explicit =
      input.mainServer ??
      input.serverName ??
      input.server ??
      tokens.find((item) => normalizeServer(item) !== undefined);
    return normalizeServer(explicit) ?? 3;
  };

  return {
    /**
     * 执行 BangDream回调。
     * @param _query - _query 输入；影响 drawFuzzyResult 的返回值。
     * @param render - render 输入；影响 drawFuzzyResult 的返回值。
     */
    drawFuzzyResult: async (
      _query: string,
      render: (matches: Record<string, unknown>) => Promise<Array<Buffer>>,
    ) => render({ result: [1] }),
    /**
     * 执行 BangDream回调。
     * @param tokens - 协议 token；影响 firstNumber 的返回值。
     */
    firstNumber: (tokens: string[]) =>
      tokens
        .map((item) => optionalNumber(item))
        .find((item) => item !== undefined),
    /**
     * 执行 BangDream回调。
     * @param input - input 输入；驱动 `getTokens()` 的 BangDream步骤。
     */
    firstToken: (input: BangDreamCommandInput) => getTokens(input)[0],
    /**
     * 读取 BangDream回调数据。
     * @param input - input 输入；使用 `compress`、`useEasyBG` 字段生成结果。
     * @param defaults - BangDream列表；使用 `useEasyBG` 字段生成结果。
     */
    getRenderOptions: (
      input: BangDreamCommandInput,
      defaults: { useEasyBG?: boolean } = {},
    ) => ({
      compress: input.compress === undefined ? true : input.compress !== false,
      displayedServerList: [3, 0],
      mainServer: pickMainServer(input, getTokens(input)),
      useEasyBG:
        input.useEasyBG === undefined
          ? (defaults.useEasyBG ?? false)
          : input.useEasyBG !== false,
    }),
    getTokens,
    /**
     * 判断 BangDream回调条件。
     * @param value - 待转换值；驱动 `test()` 的 BangDream步骤。
     */
    isInteger: (value: string) => /^(0|[1-9]\d*)$/.test(value),
    /**
     * 执行 BangDream回调。
     * @param value - 待转换值；决定 BangDream条件分支。
     * @param fallback - 兜底值；影响 normalizeBoolean 的返回值。
     */
    normalizeBoolean: (value: unknown, fallback: boolean) => {
      if (value === undefined || value === null || value === '')
        return fallback;
      if (typeof value === 'boolean') return value;
      return ['1', 'true', 'yes', 'y', '-m'].includes(
        `${value}`.trim().toLowerCase(),
      );
    },
    optionalNumber,
    /**
     * 执行 BangDream回调。
     * @param value - 待转换值；驱动 `optionalNumber()` 的 BangDream步骤。
     */
    pickDifficulty: (value: unknown) => {
      const numeric = optionalNumber(value);
      if (numeric !== undefined) return numeric;
      const mapped: Record<string, number> = {
        easy: 0,
        expert: 3,
        hard: 2,
        normal: 1,
        special: 4,
      };
      return mapped[`${value || ''}`.trim().toLowerCase()];
    },
    pickMainServer,
    pickText,
    /**
     * 执行 BangDream回调。
     * @param explicit - explicit 输入；驱动 `optionalNumber()` 的 BangDream步骤。
     * @param fallback - 兜底值；驱动 `optionalNumber()` 的 BangDream步骤。
     * @param message - message 输入；影响 requireNumber 的返回值。
     */
    requireNumber: (explicit: unknown, fallback: unknown, message: string) => {
      const value = optionalNumber(explicit) ?? optionalNumber(fallback);
      if (value === undefined) throw new Error(message);
      return value;
    },
    /**
     * 执行 BangDream回调。
     * @param input - input 输入；驱动 `pickText()` 的 BangDream步骤。
     * @param message - message 输入；影响 requireText 的返回值。
     */
    requireText: (input: BangDreamCommandInput, message: string) => {
      const value = pickText(input);
      if (!value) throw new Error(message);
      return value;
    },
    /**
     * 执行 BangDream回调。
     * @param tokens - 协议 token；影响 secondNumber 的返回值。
     */
    secondNumber: (tokens: string[]) =>
      tokens
        .map((item) => optionalNumber(item))
        .filter((item) => item !== undefined)[1],
    /**
     * 执行 BangDream回调。
     * @param operationKey - operationKey 输入；影响 toImageReply 的返回值。
     * @param query - 查询参数 DTO；限定 BangDream分页、搜索或详情查询条件。
     * @param list - BangDream列表；筛选 BangDream列表项。
     */
    toImageReply: (
      operationKey: BangDreamOperationKey,
      query: string,
      list: Array<Buffer | string>,
    ) => {
      const images = list.filter((item): item is Buffer =>
        Buffer.isBuffer(item),
      );
      if (images.length === 0) {
        throw new Error(
          list.find((item): item is string => typeof item === 'string') ||
            'BangDream 未返回图片',
        );
      }
      return {
        imageCount: images.length,
        operationKey,
        query,
        replyText: images
          .map((item) => `[CQ:image,file=base64://${item.toString('base64')}]`)
          .join('\n'),
        source: 'BangDream 内置插件',
      };
    },
  } as any;
}
