import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import {
  BangDreamDictionaryLoader,
  type BangDreamDictionaryItem,
} from '@/modules/qqbot/plugins/bangdream/src/config/dictionary/dictionary-loader';
import {
  BANGDREAM_TSUGU_ENV_KEYS,
  normalizeBangDreamBoolean,
  splitBangDreamOptionList,
} from '@/modules/qqbot/plugins/bangdream/src/config/runtime-options';
import {
  fuzzySearch,
  type FuzzySearchResult,
} from '@/modules/qqbot/plugins/bangdream/src/domain/search/fuzzy-search';
import bangdreamCatalogCache, {
  waitForBangDreamCatalogReady,
} from '@/modules/qqbot/plugins/bangdream/src/application/catalog/bangdream-catalog-cache';
import type {
  BangDreamCommandInput,
  BangDreamCommandOutput,
  BangDreamOperationKey,
} from '@/modules/qqbot/plugins/bangdream/src/domain/common/bangdream.types';

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

  /**
   * 初始化 BangDreamCommandContext 实例。
   * @param options - BangDream列表；使用 `configReader`、`dictionaryReader` 字段生成结果。
   */
  constructor(options: BangDreamCommandContextOptions = {}) {
    this.configReader = options.configReader;
    this.dictionaryReader = options.dictionaryReader;
  }

  /**
   * 执行 BangDream 插件流程。
   */
  async refreshDictionaryCache() {
    await this.dictionaryLoader.refresh((dictCode) =>
      this.fetchDictionaryItems(dictCode),
    );
  }

  /**
   * 执行 BangDream 插件流程。
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
   * 渲染 BangDream 插件输出。
   * @param query - 查询参数 DTO；限定 BangDream分页、搜索或详情查询条件。
   * @param render - render 输入；影响 drawFuzzyResult 的返回值。
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
   * 执行 BangDream 插件流程。
   * @param operationKey - operationKey 输入；影响 toImageReply 的返回值。
   * @param query - 查询参数 DTO；限定 BangDream分页、搜索或详情查询条件。
   * @param list - BangDream列表；筛选 BangDream列表项。
   * @returns BangDream 插件产出的 BangDreamCommandOutput。
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
   * 查询 BangDream 插件数据。
   * @param input - input 输入；使用 `compress`、`useEasyBG` 字段生成结果。
   * @param defaults - BangDream列表；使用 `useEasyBG` 字段生成结果。
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
   * 执行 BangDream 插件流程。
   * @param input - input 输入；使用 `displayedServerList` 字段生成结果。
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
    return servers.length > 0 ? [...new Set(servers)] : defaultServers;
  }

  /**
   * 执行 BangDream 插件流程。
   * @param input - input 输入；使用 `mainServer`、`serverName`、`server` 字段生成结果。
   * @param tokens - 协议 token；执行 `tokens.find()` 对应的 BangDream步骤。
   * @returns BangDream 插件产出的 Server。
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
   * 执行 BangDream 插件流程。
   * @param value - 待转换值；影响 pickDifficulty 的返回值。
   */
  pickDifficulty(value: unknown) {
    const source = `${value || ''}`.trim();
    if (!source) return undefined;
    const numeric = this.optionalNumber(source);
    if (numeric !== undefined) return numeric;
    const alias = this.dictionaryLoader.resolveDifficulty(source);
    if (alias !== undefined) return alias;
    const matched = fuzzySearch(source)?.difficulty?.[0];
    return typeof matched === 'number' ? matched : undefined;
  }

  /**
   * 转换 BangDream 插件输入。
   * @param value - 待转换值；决定 BangDream条件分支。
   * @returns BangDream 插件转换后的值。
   */
  normalizeServer(value: unknown): Server | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const raw = `${value}`.trim();
    const numeric = Number(raw);
    if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 4) {
      return numeric as Server;
    }
    const server = this.dictionaryLoader.resolveServer(raw);
    return server === undefined ? undefined : (server as Server);
  }

  /**
   * 执行 BangDream 插件流程。
   * @param input - input 输入；驱动 `this.pickText()` 的 BangDream步骤。
   * @param message - message 输入；影响 requireText 的返回值。
   */
  requireText(input: BangDreamCommandInput, message: string) {
    const text = this.pickText(input);
    if (!text) throw new Error(message);
    return text;
  }

  /**
   * 执行 BangDream 插件流程。
   * @param input - input 输入；使用 `query`、`text`、`raw` 字段生成结果。
   */
  pickText(input: BangDreamCommandInput) {
    return `${input.query || input.text || input.raw || ''}`.trim();
  }

  /**
   * 查询 BangDream 插件数据。
   * @param input - input 输入；使用 `args` 字段生成结果。
   */
  getTokens(input: BangDreamCommandInput) {
    if (Array.isArray(input.args)) {
      return input.args.map((item) => `${item}`.trim()).filter(Boolean);
    }
    return this.pickText(input).split(/\s+/).filter(Boolean);
  }

  /**
   * 执行 BangDream 插件流程。
   * @param input - input 输入；驱动 `this.getTokens()` 的 BangDream步骤。
   */
  firstToken(input: BangDreamCommandInput) {
    return this.getTokens(input)[0];
  }

  /**
   * 执行 BangDream 插件流程。
   * @param explicit - explicit 输入；驱动 `this.optionalNumber()` 的 BangDream步骤。
   * @param fallback - 兜底值；驱动 `this.optionalNumber()` 的 BangDream步骤。
   * @param message - message 输入；影响 requireNumber 的返回值。
   */
  requireNumber(explicit: unknown, fallback: unknown, message: string) {
    const value =
      this.optionalNumber(explicit) ?? this.optionalNumber(fallback);
    if (value === undefined) throw new Error(message);
    return value;
  }

  /**
   * 执行 BangDream 插件流程。
   * @param value - 待转换值；驱动 `Number()` 的 BangDream步骤。
   */
  optionalNumber(value: unknown) {
    if (value === undefined || value === null || value === '') return undefined;
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : undefined;
  }

  /**
   * 执行 BangDream 插件流程。
   * @param tokens - 协议 token；影响 firstNumber 的返回值。
   */
  firstNumber(tokens: string[]) {
    return tokens
      .map((item) => this.optionalNumber(item))
      .find((item) => item !== undefined);
  }

  /**
   * 执行 BangDream 插件流程。
   * @param tokens - 协议 token；影响 secondNumber 的返回值。
   */
  secondNumber(tokens: string[]) {
    return tokens
      .map((item) => this.optionalNumber(item))
      .filter((item) => item !== undefined)[1];
  }

  /**
   * 转换 BangDream 插件输入。
   * @param value - 待转换值；驱动 `normalizeBangDreamBoolean()` 的 BangDream步骤。
   * @param fallback - 兜底值；驱动 `normalizeBangDreamBoolean()` 的 BangDream步骤。
   */
  normalizeBoolean(value: unknown, fallback: boolean) {
    return normalizeBangDreamBoolean(value, fallback);
  }

  /**
   * 判断 BangDream 插件条件。
   * @param value - 待转换值；驱动 `test()` 的 BangDream步骤。
   */
  isInteger(value: string) {
    return /^(0|[1-9]\d*)$/.test(value);
  }

  /**
   * 执行 BangDream 插件流程。
   * @param values - 配置值字典；执行 `values.find()` 对应的 BangDream步骤。
   */
  private firstDefined(...values: unknown[]) {
    return values.find(
      (value) => value !== undefined && value !== null && value !== '',
    );
  }

  /**
   * 执行 BangDream 插件流程。
   * @param dictCode - dictCode 输入；驱动 `dictionaryReader.getDictItemsByKey()` 的 BangDream步骤。
   * @returns 异步完成后的 BangDream 插件结果。
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
   * 读取 BangDream 插件资源。
   * @param key - 键名；影响 readConfig 的返回值。
   */
  private readConfig(key: string) {
    return this.configReader?.get<string>(key);
  }
}
