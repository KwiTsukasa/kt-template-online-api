import { Server } from '@/modules/plugins/bangdream/src/domain/catalog/server.model';
import {
  BangDreamDictionaryLoader,
  type BangDreamDictionaryItem,
} from '@/modules/plugins/bangdream/src/config/dictionary/dictionary-loader';
import {
  BANGDREAM_TSUGU_ENV_KEYS,
  normalizeBangDreamBoolean,
  splitBangDreamOptionList,
} from '@/modules/plugins/bangdream/src/config/runtime-options';
import {
  fuzzySearch,
  type FuzzySearchResult,
} from '@/modules/plugins/bangdream/src/domain/search/fuzzy-search';
import bangdreamCatalogCache, {
  waitForBangDreamCatalogReady,
} from '@/modules/plugins/bangdream/src/application/catalog/bangdream-catalog-cache';
import type {
  BangDreamCommandInput,
  BangDreamCommandOutput,
  BangDreamOperationKey,
} from '@/modules/plugins/bangdream/src/domain/common/bangdream.types';

const SOURCE_NAME = 'BangDream 内置插件';

export type BangDreamConfigReader = {
  get<T = string>(key: string): T | undefined;
};

export type BangDreamDictionaryReader = {
  getDictItemsByKey(dictCode: string): Promise<
    Array<{
      label: string;
      value: string;
    }>
  >;
};

export type BangDreamCommandContextOptions = {
  configReader?: BangDreamConfigReader;
  dictionaryReader?: BangDreamDictionaryReader;
};

export class BangDreamCommandContext {
  private readonly configReader?: BangDreamConfigReader;
  private readonly dictionaryLoader = new BangDreamDictionaryLoader();
  private readonly dictionaryReader?: BangDreamDictionaryReader;

  constructor(options: BangDreamCommandContextOptions = {}) {
    this.configReader = options.configReader;
    this.dictionaryReader = options.dictionaryReader;
  }

  /**
   * 通过宿主字典查询器刷新 BanG Dream 字典缓存，使后续命令读取最新字典项。
   */
  async refreshDictionaryCache() {
    await this.dictionaryLoader.refresh((dictCode) =>
      this.fetchDictionaryItems(dictCode),
    );
  }

  /**
   * 通过 `waitForBangDreamCatalogReady` 限定异步执行边界。
   * @returns 满足健康状态约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   * @throws 当 `!data.songs` 成立时拒绝当前输入并抛出 `Error`。
   */
  async checkHealth() {
    await waitForBangDreamCatalogReady(['songs']);
    const data = bangdreamCatalogCache as { songs?: unknown };
    if (!data.songs) {
      throw new Error('BangDream 数据配置未加载');
    }
    fuzzySearch('夏祭り');
    return true;
  }

  /**
   * 根据`query`、`render`绘制或格式化模糊搜索结果；当 `Object.keys(matches).length === 0` 成立时返回 `['错误: 没有有效的关键词']`。
   * @param query - 限定模糊搜索结果筛选、排序与分页范围的查询条件。
   * @param render - 负责完成模糊搜索结果外部交互的受控能力。
   * @returns 模糊搜索。
   */
  async drawFuzzyResult(
    query: string,
    render: (matches: FuzzySearchResult) => Promise<Array<Buffer | string>>,
  ) {
    const matches = fuzzySearch(query);
    if (Object.keys(matches).length === 0) {
      return ['错误: 没有有效的关键词'];
    }
    return await render(matches);
  }

  /**
   * 通过 `list.filter` 筛选匹配数据。
   * @param operationKey - 用于读取或更新图片Reply的稳定键。
   * @param query - 限定图片Reply筛选、排序与分页范围的查询条件。
   * @param list - 决定图片Reply内容、边界或目标的 `list` 值。
   * @returns 包含 `imageCount`、`operationKey`、`query`、`replyText`、`source` 字段的图片Reply。
   * @throws 当 `images.length === 0` 成立时拒绝当前输入并抛出 `Error`。
   */
  toImageReply(
    operationKey: BangDreamOperationKey,
    query: string,
    list: Array<Buffer | string>,
  ): BangDreamCommandOutput {
    const images = list.filter((item): item is Buffer => Buffer.isBuffer(item));
    if (images.length === 0) {
      const message =
        list.find((item): item is string => typeof item === 'string') ||
        'BangDream 未返回图片';
      throw new Error(message);
    }
    return {
      imageCount: images.length,
      operationKey,
      query,
      replyText: images
        .map((item) => `[CQ:image,file=base64://${item.toString('base64')}]`)
        .join('\n'),
      source: SOURCE_NAME,
    };
  }

  /**
   * 按`input`、`defaults`读取选项；从 `readConfig` 读取选项。
   * @param input - 用于选项的结构化输入，包含 `compress`、`useEasyBG` 字段。
   * @param defaults - 用于选项的领域对象，包含 `useEasyBG` 字段；省略时默认采用 `{}`。
   * @returns 包含 `compress`、`displayedServerList`、`mainServer`、`useEasyBG` 字段的选项。
   */
  getRenderOptions(
    input: BangDreamCommandInput,
    defaults: { useEasyBG?: boolean } = {},
  ) {
    return {
      compress: normalizeBangDreamBoolean(
        input.compress,
        normalizeBangDreamBoolean(
          this.readConfig(BANGDREAM_TSUGU_ENV_KEYS.compress),
          true,
        ),
      ),
      displayedServerList: this.pickDisplayedServerList(input),
      mainServer: this.pickMainServer(input, []),
      useEasyBG: normalizeBangDreamBoolean(
        input.useEasyBG,
        normalizeBangDreamBoolean(
          this.readConfig(BANGDREAM_TSUGU_ENV_KEYS.useEasyBg),
          defaults.useEasyBG ?? false,
        ),
      ),
    };
  }

  /**
   * 从`input`筛选Displayed服务器，并保持保留项的原有顺序与键名；当 `servers.length > 0` 成立时返回 `[...new Set(servers)]`。
   * @param input - 用于Displayed服务器的结构化输入，包含 `displayedServerList` 字段。
   * @returns Displayed服务器。
   */
  pickDisplayedServerList(input: BangDreamCommandInput) {
    const source =
      input.displayedServerList ||
      this.readConfig(BANGDREAM_TSUGU_ENV_KEYS.displayedServers);
    const defaultServers = this.dictionaryLoader.getDefaultDisplayedServers();
    if (!source) return defaultServers;
    const values = splitBangDreamOptionList(source);
    const servers = values
      .map((item) => this.normalizeServer(item))
      .filter((item) => item !== undefined) as Server[];
    if (servers.length > 0) {
      return [...new Set(servers)];
    }
    return defaultServers;
  }

  /**
   * 从`input`、`tokens`筛选Main服务器，并保持保留项的原有顺序与键名；从 `readConfig` 读取Main服务器。
   * @param input - 用于Main服务器的结构化输入，包含 `mainServer`、`serverName`、`server` 字段。
   * @param tokens - 按原有顺序参与Main服务器筛选、合并或汇总的集合。
   * @returns 规范化后的Main服务器；主值为空时采用 `Server.cn` 兜底。
   */
  pickMainServer(input: BangDreamCommandInput, tokens: string[]): Server {
    const explicit = this.firstDefined(
      input.mainServer,
      input.serverName,
      input.server,
      tokens.find((item) => this.normalizeServer(item) !== undefined) ||
        this.readConfig(BANGDREAM_TSUGU_ENV_KEYS.mainServer),
    );
    return this.normalizeServer(explicit) ?? Server.cn;
  }

  /**
   * 从`value`筛选难度，并保持保留项的原有顺序与键名；当 `typeof matched === 'number'` 成立时返回 `matched`。
   * @param value - 参与难度比较、格式化或输出的候选值。
   * @returns 难度；没有可用结果或提前结束时为 `undefined`。
   */
  pickDifficulty(value: unknown) {
    const source = `${value || ''}`.trim();
    if (!source) return undefined;
    const numeric = this.optionalNumber(source);
    if (numeric !== undefined) return numeric;
    const alias = this.dictionaryLoader.resolveDifficulty(source);
    if (alias !== undefined) return alias;
    const matched = fuzzySearch(source)?.difficulty?.[0];
    if (typeof matched === 'number') {
      return matched;
    }
    return undefined;
  }

  /**
   * 将`value`规范为服务器，使等价输入得到一致表示；当 `Number.isInteger(numeric) && numeric >= 0 && numeric <= 4` 成立时返回 `numeric as Server`。
   * @param value - 待转换为服务器的原始值。
   * @returns 服务器；没有可用结果或提前结束时为 `undefined`。
   */
  normalizeServer(value: unknown): Server | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const raw = `${value}`.trim();
    const numeric = Number(raw);
    if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 4) {
      return numeric as Server;
    }
    const server = this.dictionaryLoader.resolveServer(raw);
    if (server === undefined) {
      return undefined;
    }
    return (server as Server);
  }

  /**
   * 校验`input`、`message`是否满足文本约束，并拒绝不合法输入。
   * @param input - 用于文本的结构化输入。
   * @param message - 包含正文、发送目标与账号身份的待处理消息。
   * @returns 文本。
   * @throws 当 `!text` 成立时拒绝当前输入并抛出 `Error`。
   */
  requireText(input: BangDreamCommandInput, message: string) {
    const text = this.pickText(input);
    if (!text) throw new Error(message);
    return text;
  }

  /**
   * 按 `query`、`text`、`raw` 的优先级选择 BanG Dream 命令文本，并去除首尾空白。
   * @param input - 用于文本的结构化输入，包含 `query`、`text`、`raw` 字段。
   * @returns 文本。
   */
  pickText(input: BangDreamCommandInput) {
    return `${input.query || input.text || input.raw || ''}`.trim();
  }

  /**
   * 通过 `filter` 筛选匹配数据。
   * @param input - 用于分词列表的结构化输入，包含 `args` 字段。
   * @returns 分词列表。
   */
  getTokens(input: BangDreamCommandInput) {
    if (Array.isArray(input.args)) {
      return input.args.map((item) => `${item}`.trim()).filter(Boolean);
    }
    return this.pickText(input).split(/\s+/).filter(Boolean);
  }

  /**
   * 按`input`的原有顺序解析首个有效令牌；没有可用项时返回空值；从 `getTokens` 读取令牌。
   * @param input - 用于令牌的结构化输入。
   * @returns 令牌。
   */
  firstToken(input: BangDreamCommandInput) {
    return this.getTokens(input)[0];
  }

  /**
   * 校验`explicit`、`fallback`、`message`是否满足数值约束，并拒绝不合法输入。
   * @param explicit - 决定数值内容、边界或目标的 `explicit` 值。
   * @param fallback - 主值缺失、为空或不合法时采用的兜底结果。
   * @param message - 包含正文、发送目标与账号身份的待处理消息。
   * @returns 数值。
   * @throws 当 `value === undefined` 成立时拒绝当前输入并抛出 `Error`。
   */
  requireNumber(explicit: unknown, fallback: unknown, message: string) {
    const value =
      this.optionalNumber(explicit) ?? this.optionalNumber(fallback);
    if (value === undefined) throw new Error(message);
    return value;
  }

  /**
   * 根据`value`处理可选值数值；当 `Number.isInteger(parsed)` 成立时返回 `parsed`。
   * @param value - 参与可选值数值比较、格式化或输出的候选值。
   * @returns 可选值数值；没有可用结果或提前结束时为 `undefined`。
   */
  optionalNumber(value: unknown) {
    if (value === undefined || value === null || value === '') return undefined;
    const parsed = Number(value);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
    return undefined;
  }

  /**
   * 按`tokens`的原有顺序解析首个有效数值；没有可用项时返回空值。
   * @param tokens - 按原有顺序参与数值筛选、合并或汇总的集合。
   * @returns 数值；没有可用结果或提前结束时为 `undefined`。
   */
  firstNumber(tokens: string[]) {
    return tokens
      .map((item) => this.optionalNumber(item))
      .find((item) => item !== undefined);
  }

  /**
   * 通过 `filter` 筛选匹配数据。
   * @param tokens - 按原有顺序参与second数值筛选、合并或汇总的集合。
   * @returns second数值；没有可用结果或提前结束时为 `undefined`。
   */
  secondNumber(tokens: string[]) {
    return tokens
      .map((item) => this.optionalNumber(item))
      .filter((item) => item !== undefined)[1];
  }

  /**
   * 将 BanG Dream 命令值交给统一布尔规范化器，非法值按调用方给定的回退值处理。
   * @param value - 待转换为将 BanG Dream 命令值交给统一布尔规范化器，非法值按调用方给定的回退值处理的原始值。
   * @param fallback - 主值缺失、为空或不合法时采用的兜底结果。
   * @returns 布尔值。
   */
  normalizeBoolean(value: unknown, fallback: boolean) {
    return normalizeBangDreamBoolean(value, fallback);
  }

  /**
   * 仅将 `0` 或不含前导零的正十进制数字文本识别为整数输入。
   * @param value - 待判定是否满足仅将 `0` 或不含前导零的正十进制数字文本识别为整数输入约束的候选值。
   * @returns 满足仅将 `0` 或不含前导零的正十进制数字文本识别为整数输入约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  isInteger(value: string) {
    return /^(0|[1-9]\d*)$/.test(value);
  }

  /**
   * 按`values`的原有顺序解析首个有效已提供字段；没有可用项时返回空值。
   * @param values - 按原有顺序参与已提供字段筛选、合并或汇总的集合；按调用方给定的顺序传递全部剩余实参。
   * @returns 已提供字段；无法解析或未命中时为 `null`，没有可用结果或提前结束时为 `undefined`。
   */
  private firstDefined(...values: unknown[]) {
    return values.find(
      (value) => value !== undefined && value !== null && value !== '',
    );
  }

  /**
   * 按`dictCode`读取Dictionary条目集合；从 `dictionaryReader.getDictItemsByKey` 读取Dictionary条目集合。
   * @param dictCode - 决定Dictionary条目集合内容、边界或目标的 `dictCode` 值。
   * @returns 按输入顺序得到的Dictionary条目集合列表；没有匹配项时为空数组。
   */
  private async fetchDictionaryItems(
    dictCode: string,
  ): Promise<BangDreamDictionaryItem[]> {
    if (!this.dictionaryReader) return [];
    const items = await this.dictionaryReader.getDictItemsByKey(dictCode);
    return items.map(({ label, value }) => ({
      label,
      value,
    }));
  }

  /**
   * 按`key`读取配置；从 `configReader.get` 读取配置。
   * @param key - 用于读取或更新配置的稳定键。
   * @returns 配置。
   */
  private readConfig(key: string) {
    return this.configReader?.get<string>(key);
  }
}
