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
import mainAPI, {
  waitForMainDataReady,
} from '@/modules/qqbot/plugins/bangdream/src/application/main-data-store';
import type {
  QqbotBangDreamCommandInput,
  QqbotBangDreamCommandOutput,
  QqbotBangDreamOperationKey,
} from '@/modules/qqbot/plugins/bangdream/src/domain/common/qqbot-bangdream.types';

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

  async refreshDictionaryCache() {
    await this.dictionaryLoader.refresh((dictCode) =>
      this.fetchDictionaryItems(dictCode),
    );
  }

  async checkHealth() {
    await waitForMainDataReady();
    const data = mainAPI as { cards?: unknown; songs?: unknown };
    if (!data.songs || !data.cards) {
      throw new Error('BangDream 数据配置未加载');
    }
    fuzzySearch('夏祭り');
    return true;
  }

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

  toImageReply(
    operationKey: QqbotBangDreamOperationKey,
    query: string,
    list: Array<Buffer | string>,
  ): QqbotBangDreamCommandOutput {
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

  getRenderOptions(
    input: QqbotBangDreamCommandInput,
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

  pickDisplayedServerList(input: QqbotBangDreamCommandInput) {
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

  pickMainServer(input: QqbotBangDreamCommandInput, tokens: string[]): Server {
    const explicit = this.firstDefined(
      input.mainServer,
      input.serverName,
      input.server,
      tokens.find((item) => this.normalizeServer(item) !== undefined) ||
        this.readConfig(BANGDREAM_TSUGU_ENV_KEYS.mainServer),
    );
    return this.normalizeServer(explicit) ?? Server.cn;
  }

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

  requireText(input: QqbotBangDreamCommandInput, message: string) {
    const text = this.pickText(input);
    if (!text) throw new Error(message);
    return text;
  }

  pickText(input: QqbotBangDreamCommandInput) {
    return `${input.query || input.text || input.raw || ''}`.trim();
  }

  getTokens(input: QqbotBangDreamCommandInput) {
    if (Array.isArray(input.args)) {
      return input.args.map((item) => `${item}`.trim()).filter(Boolean);
    }
    return this.pickText(input).split(/\s+/).filter(Boolean);
  }

  firstToken(input: QqbotBangDreamCommandInput) {
    return this.getTokens(input)[0];
  }

  requireNumber(explicit: unknown, fallback: unknown, message: string) {
    const value =
      this.optionalNumber(explicit) ?? this.optionalNumber(fallback);
    if (value === undefined) throw new Error(message);
    return value;
  }

  optionalNumber(value: unknown) {
    if (value === undefined || value === null || value === '') return undefined;
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : undefined;
  }

  firstNumber(tokens: string[]) {
    return tokens
      .map((item) => this.optionalNumber(item))
      .find((item) => item !== undefined);
  }

  secondNumber(tokens: string[]) {
    return tokens
      .map((item) => this.optionalNumber(item))
      .filter((item) => item !== undefined)[1];
  }

  normalizeBoolean(value: unknown, fallback: boolean) {
    return normalizeBangDreamBoolean(value, fallback);
  }

  isInteger(value: string) {
    return /^(0|[1-9]\d*)$/.test(value);
  }

  private firstDefined(...values: unknown[]) {
    return values.find(
      (value) => value !== undefined && value !== null && value !== '',
    );
  }

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

  private readConfig(key: string) {
    return this.configReader?.get<string>(key);
  }
}
