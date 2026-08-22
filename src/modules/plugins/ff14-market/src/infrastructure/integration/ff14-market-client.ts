import {
  buildFf14MarketCatalog,
  buildFf14MarketCatalogFromTree,
  PLUGIN_FF14_MARKET_DICT_CODES,
  resolveFf14MarketTarget,
} from '../../domain/ff14-worlds';
import { resolveFf14MarketConfig } from '../../config/ff14-market-config';
import type {
  Ff14HttpMethod,
  Ff14PriceResult,
  Ff14ResolvedItem,
  UniversalisListing,
  UniversalisMarketResponse,
  XivapiSearchItem,
} from '../../domain/ff14-market.types';

export type Ff14MarketPluginHost = {
  getConfig: <T = string>(key: string) => T | undefined;
  getDictItemsByKey: (
    dictCode: string,
  ) => Promise<
    Array<{ childrenCode?: string; label?: string; value?: string }>
  >;
  relationTree: (input: { dictCode: string }) => Promise<
    Array<{
      children?: any[];
      dictCode?: string;
      label?: string;
      value?: string;
    }>
  >;
  requestJson: <T>(options: {
    context: string;
    failureMessage: (statusCode: number) => string;
    invalidJsonMessage: string;
    method?: Ff14HttpMethod;
    timeoutMessage: string;
    timeoutMs: number;
    url: URL;
  }) => Promise<T>;
};

export class Ff14MarketClient {
  private readonly xivapiBaseUrl: string;
  private readonly xivapiChsBaseUrl: string;
  private readonly universalisBaseUrl: string;

  constructor(private readonly host: Ff14MarketPluginHost) {
    const config = resolveFf14MarketConfig(host);
    this.xivapiBaseUrl = config.xivapiBaseUrl;
    this.xivapiChsBaseUrl = config.xivapiChsBaseUrl;
    this.universalisBaseUrl = config.universalisBaseUrl;
  }

  /**
   * 从`params`解析条目；当 `Number.isInteger(itemId) && itemId > 0` 成立时返回 `this.getItemById(itemId, language)`。
   * @param params - 用于条目的领域对象，包含 `language`、`itemId`、`item` 字段。
   * @returns 包含 `icon`、`isUntradable`、`itemId`、`itemLevel`、`name` 字段的条目。
   * @throws 当 `!keyword` 成立时拒绝当前输入并抛出 `Error`；当 `!item` 成立时拒绝当前输入并抛出 `Error`。
   */
  async resolveItem(params: {
    item?: string;
    itemId?: number | string;
    language?: string;
  }): Promise<Ff14ResolvedItem> {
    const language = this.normalizeXivapiLanguage(params.language);
    const itemId = Number(params.itemId || params.item);
    if (Number.isInteger(itemId) && itemId > 0) {
      return this.getItemById(itemId, language);
    }

    const keyword = `${params.item || ''}`.trim();
    if (!keyword) throw new Error('请提供 FF14 物品名称或物品 ID');

    const item = await this.searchItem(keyword, language);
    if (!item) throw new Error(`未找到 FF14 物品：${keyword}`);

    return {
      icon: this.normalizeItemIcon(item.fields?.Icon),
      isUntradable: item.fields?.IsUntradable,
      itemId: Number(item.row_id || item.id),
      itemLevel: this.normalizeItemLevel(item.fields?.LevelItem),
      name: item.fields?.Name || item.name || keyword,
    };
  }

  /**
   * 按`params`读取针对FF14 市场插件；当 `item.isUntradable` 成立时返回 `{ hq: params.hq, item, listings: [], replyT…`。
   * @param params - 用于针对FF14 市场插件的领域对象，包含 `hq` 字段。
   * @returns 包含 `averagePrice`、`hq`、`item`、`listings`、`minPrice` 字段的针对FF14 市场插件。
   */
  async getPrice(params: {
    dataCenter?: string;
    hq?: boolean;
    item?: string;
    itemId?: number | string;
    language?: string;
    region?: string;
    world?: string;
  }): Promise<Ff14PriceResult> {
    const marketTarget = await this.resolveMarketTarget(params);
    const item = await this.resolveItem(params);
    if (item.isUntradable) {
      return {
        hq: params.hq,
        item,
        listings: [],
        replyText: `FF14 查价：${item.name}\n该物品不可交易，暂无市场价格。`,
        world: marketTarget.label,
      };
    }

    const url = new URL(
      `${this.universalisBaseUrl}/${encodeURIComponent(marketTarget.target)}/${
        item.itemId
      }`,
    );
    url.searchParams.set('entries', '10');
    url.searchParams.set('listings', '10');
    if (params.hq !== undefined) url.searchParams.set('hq', `${params.hq}`);

    const data = await this.requestJson<UniversalisMarketResponse>(
      url,
      'GET',
      'Universalis 市场查询',
    );
    const listings = (data.listings || []).slice(0, 10);
    const minPrice = this.normalizeMarketPrice(
      this.pickPrice(data, params.hq, 'min'),
      listings,
    );
    const averagePrice = this.normalizeMarketPrice(
      this.pickPrice(data, params.hq, 'average'),
      listings,
    );
    const updatedAt = (() => {
      if (data.lastUploadTime) {
        return formatFf14DateTime(data.lastUploadTime);
      }
      return undefined;
    })();

    return {
      averagePrice,
      hq: params.hq,
      item,
      listings,
      minPrice,
      replyText: this.buildReplyText({
        averagePrice,
        hq: params.hq,
        item,
        listings,
        minPrice,
        updatedAt,
        world: marketTarget.label,
      }),
      updatedAt,
      world: marketTarget.label,
    };
  }

  /**
   * 按`itemId`、`language`、`displayName`读取针对FF14 市场插件。
   * @param itemId - 用于精确定位条目的标识。
   * @param language - 决定针对FF14 市场插件内容、边界或目标的 `language` 值；省略时默认采用 `'chs'`。
   * @param displayName - 决定针对FF14 市场插件内容、边界或目标的 `displayName` 值；为空时采用 ``${itemId}`` 作为兜底。
   * @returns 包含 `icon`、`isUntradable`、`itemId`、`itemLevel`、`name` 字段的针对FF14 市场插件。
   */
  private async getItemById(
    itemId: number,
    language = 'chs',
    displayName?: string,
  ): Promise<Ff14ResolvedItem> {
    const normalizedLanguage = this.normalizeXivapiLanguage(language);
    const url = this.buildXivapiUrl(
      `/sheet/Item/${itemId}`,
      normalizedLanguage,
    );
    url.searchParams.set('fields', 'Name,Icon,LevelItem,IsUntradable');
    url.searchParams.set('language', normalizedLanguage);
    const data = await this.requestJson<Record<string, any>>(
      url,
      'GET',
      'XIVAPI 物品解析',
    );
    const fields = data.fields || data;
    return {
      icon: this.normalizeItemIcon(fields.Icon),
      isUntradable: fields.IsUntradable,
      itemId,
      itemLevel: this.normalizeItemLevel(fields.LevelItem),
      name: displayName || fields.Name || `${itemId}`,
    };
  }

  /**
   * 根据`result`构造针对FF14 市场插件。
   * @param result - 用于针对FF14 市场插件的领域对象，包含 `listings`、`world`、`item` 字段。
   * @returns 针对FF14 市场插件。
   */
  private buildReplyText(result: Omit<Ff14PriceResult, 'replyText'>) {
    const listingText = (() => {
      if (result.listings.length) {
        return result.listings
          .slice(0, 10)
          .map((item) => {
            const hq = (() => {
              if (item.hq) {
                return 'HQ';
              }
              return 'NQ';
            })();
            const price = item.pricePerUnit || 0;
            const quantity = item.quantity || 1;
            const total = item.total || price * quantity;
            const retainerName = item.retainerName || '未知雇员';
            const worldName = item.worldName || result.world;
            return `[${hq}]${this.formatPrice(
              price,
            )} x ${quantity} = ${this.formatPrice(
              total,
            )} ${retainerName} (${worldName})`;
          })
          .join('\n');
      }
      return '暂无在售记录';
    })();

    return [
      `服务器 ${result.world} 上的物品 ${result.item.name} (ID: ${result.item.itemId}) 市场价格如下:`,
      listingText,
    ].join('\n');
  }

  /**
   * 从`data`、`hq`、`type`筛选Price，并保持保留项的原有顺序与键名；当 `type === 'min'` 成立时返回 `data.minPriceHQ`。
   * @param data - 用于Price的领域对象，包含 `minPriceHQ`、`minPriceNQ`、`minPrice`、`currentAveragePriceHQ` 字段。
   * @param hq - 决定Price内容、边界或目标的 `hq` 值。
   * @param type - 决定Price内容、边界或目标的 `type` 值。
   * @returns 规范化后的Price；主值为空时采用 `data.currentAveragePriceHQ` 兜底。
   */
  private pickPrice(
    data: UniversalisMarketResponse,
    hq: boolean | undefined,
    type: 'average' | 'min',
  ) {
    if (type === 'min') {
      if (hq === true) return data.minPriceHQ;
      if (hq === false) return data.minPriceNQ;
      return data.minPrice ?? data.minPriceNQ ?? data.minPriceHQ;
    }
    if (hq === true) return data.currentAveragePriceHQ;
    if (hq === false) return data.currentAveragePriceNQ;
    return (
      data.currentAveragePrice ??
      data.currentAveragePriceNQ ??
      data.currentAveragePriceHQ
    );
  }

  /**
   * 将`price`、`listings`规范为市场数据Price，使等价输入得到一致表示。
   * @param price - 决定市场数据Price内容、边界或目标的 `price` 值。
   * @param listings - 用于市场数据Price的领域对象，包含 `length` 字段。
   * @returns 市场数据Price；没有可用结果或提前结束时为 `undefined`。
   */
  private normalizeMarketPrice(
    price: number | undefined,
    listings: UniversalisListing[],
  ) {
    if (!listings.length && (!price || price <= 0)) return undefined;
    return price;
  }

  /**
   * 将`value`转换为针对FF14 市场插件。
   * @param value - 待转换为针对FF14 市场插件的原始值。
   * @returns 针对FF14 市场插件。
   */
  private formatPrice(value: number) {
    return Math.round(value).toLocaleString('en-US');
  }

  /**
   * 将`world`、`fallback`规范为针对FF14 市场插件，使等价输入得到一致表示；从 `host.getConfig` 读取针对FF14 市场插件。
   * @param world - 决定针对FF14 市场插件内容、边界或目标的 `world` 值；为空时采用 `''` 作为兜底。
   * @param fallback - 主值缺失、为空或不合法时采用的兜底结果；为空时采用 `''` 作为兜底。
   * @returns 针对FF14 市场插件。
   */
  private normalizeWorld(world?: string, fallback?: string) {
    const raw = `${
      world ||
      this.host.getConfig<string>('FF14_DEFAULT_WORLD') ||
      fallback ||
      ''
    }`.trim();
    return raw;
  }

  /**
   * 从`params`解析市场数据Target；从 `getMarketCatalog` 读取市场数据Target。
   * @param params - 用于市场数据Target的领域对象，包含 `dataCenter`、`world`、`region` 字段。
   * @returns 市场数据Target。
   */
  private async resolveMarketTarget(params: {
    dataCenter?: string;
    region?: string;
    world?: string;
  }) {
    const catalog = await this.getMarketCatalog();
    return resolveFf14MarketTarget(catalog, {
      dataCenter: params.dataCenter,
      fallback: this.normalizeWorld(params.world, catalog.defaultRegion),
      region: params.region,
      world: params.world,
    });
  }

  /**
   * 按当前运行态读取针对FF14 市场插件；从 `host.getDictItemsByKey` 读取针对FF14 市场插件。
   * @returns 针对FF14 市场插件。
   */
  async getMarketCatalog() {
    const treeCatalog = buildFf14MarketCatalogFromTree(
      await this.host.relationTree({
        dictCode: PLUGIN_FF14_MARKET_DICT_CODES.region,
      }),
    );
    if (treeCatalog.dataCenters.length > 0) return treeCatalog;

    const [regions, dataCenters, worlds] = await Promise.all([
      this.host.getDictItemsByKey(PLUGIN_FF14_MARKET_DICT_CODES.region),
      this.host.getDictItemsByKey(PLUGIN_FF14_MARKET_DICT_CODES.dataCenter),
      this.host.getDictItemsByKey(PLUGIN_FF14_MARKET_DICT_CODES.world),
    ]);
    return buildFf14MarketCatalog({
      dataCenters,
      regions,
      worlds,
    });
  }

  /**
   * 将`language`规范为针对FF14 市场插件，使等价输入得到一致表示；当 `['en', 'ja', 'de', 'fr'].includes(value)` 成立时返回 `value`。
   * @param language - 决定针对FF14 市场插件内容、边界或目标的 `language` 值；为空时采用 `'chs'` 作为兜底。
   * @returns 当前状态对应的针对FF14 市场插件，取值为 `'chs'`、`'en'`。
   */
  private normalizeXivapiLanguage(language?: string) {
    const value = `${language || 'chs'}`.trim().toLowerCase();
    if (['zh', 'zh-cn', 'zh_hans', 'cn', 'chs'].includes(value)) return 'chs';
    if (['en', 'ja', 'de', 'fr'].includes(value)) {
      return value;
    }
    return 'en';
  }

  /**
   * 根据`path`、`language`构造针对FF14 市场插件。
   * @param path - 必须保持在受控根目录内的路径。
   * @param language - 决定针对FF14 市场插件内容、边界或目标的 `language` 值。
   * @returns 完成初始化并携带当前边界配置的针对FF14 市场插件。
   */
  private buildXivapiUrl(path: string, language: string) {
    const baseUrl =
      (() => {
        if (language === 'chs') {
          return this.xivapiChsBaseUrl;
        }
        return this.xivapiBaseUrl;
      })();
    return new URL(`${baseUrl.replace(/\/+$/, '')}${path}`);
  }

  /**
   * 根据`keyword`、`language`处理针对FF14 市场插件；当 `language !== 'en'` 成立时返回 `enItem`。
   * @param keyword - 决定针对FF14 市场插件内容、边界或目标的 `keyword` 值。
   * @param language - 决定针对FF14 市场插件内容、边界或目标的 `language` 值。
   * @returns 针对FF14 市场插件。
   */
  private async searchItem(keyword: string, language: string) {
    const item = this.pickFirstSearchItem(
      await this.searchItemsByLanguage(keyword, language, '='),
    );
    if (item) return item;

    if (language !== 'en') {
      const enItem = this.pickFirstSearchItem(
        await this.searchItemsByLanguage(keyword, 'en', '='),
      );
      if (enItem) return enItem;
    }

    const fuzzyItems = await this.searchItemsByLanguage(keyword, language, '~');
    const fuzzyItem = this.pickSingleFuzzySearchItem(fuzzyItems);
    if (fuzzyItem || language === 'en') return fuzzyItem;

    const enFuzzyItems = await this.searchItemsByLanguage(keyword, 'en', '~');
    return this.pickSingleFuzzySearchItem(enFuzzyItems);
  }

  /**
   * 根据`keyword`、`language`、`operator`处理针对FF14 市场插件。
   * @param keyword - 决定针对FF14 市场插件内容、边界或目标的 `keyword` 值。
   * @param language - 决定针对FF14 市场插件内容、边界或目标的 `language` 值。
   * @param operator - 决定针对FF14 市场插件内容、边界或目标的 `operator` 值。
   * @returns 针对FF14 市场插件。
   */
  private async searchItemsByLanguage(
    keyword: string,
    language: string,
    operator: '=' | '~',
  ) {
    const url = this.buildXivapiUrl('/search', language);
    url.searchParams.set('sheets', 'Item');
    url.searchParams.set('fields', 'Name,Icon,LevelItem,IsUntradable');
    url.searchParams.set(
      'query',
      `Name${operator}"${this.escapeXivapiValue(keyword)}"`,
    );
    url.searchParams.set('language', language);
    url.searchParams.set('limit', '10');

    const data = await this.requestJson<{ results?: XivapiSearchItem[] }>(
      url,
      'GET',
      'XIVAPI 物品解析',
    );
    return (data.results || []).filter(
      (result) => result.sheet === 'Item' || result.fields?.Name || result.name,
    );
  }

  /**
   * 从`items`筛选Search条目，并保持保留项的原有顺序与键名。
   * @param items - 按原有顺序参与Search条目筛选、合并或汇总的集合。
   * @returns Search条目。
   */
  private pickFirstSearchItem(items: XivapiSearchItem[]) {
    return items[0];
  }

  /**
   * 从`items`筛选针对FF14 市场插件，并保持保留项的原有顺序与键名。
   * @param items - 按原有顺序参与针对FF14 市场插件筛选、合并或汇总的集合。
   * @returns 针对FF14 市场插件。
   * @throws 当前函数此前所有接受或成功分支均未返回时拒绝当前输入并抛出 `Error`。
   */
  private pickSingleFuzzySearchItem(items: XivapiSearchItem[]) {
    if (items.length <= 1) return items[0];
    throw new Error(
      `找到多个相似物品，请输入更完整名称或物品 ID：${this.formatSearchCandidates(
        items,
      )}`,
    );
  }

  /**
   * 将`items`转换为针对FF14 市场插件。
   * @param items - 按原有顺序参与针对FF14 市场插件筛选、合并或汇总的集合。
   * @returns 针对FF14 市场插件。
   */
  private formatSearchCandidates(items: XivapiSearchItem[]) {
    return items
      .slice(0, 5)
      .map((item) => {
        const name = item.fields?.Name || item.name || '未知物品';
        const id = item.row_id || item.id;
        if (id) {
          return `${name}(ID:${id})`;
        }
        return name;
      })
      .join('、');
  }

  /**
   * 将`icon`规范为条目图标，使等价输入得到一致表示；当 `icon && typeof icon === 'object'` 成立时返回 `item.path_hr1 || item.path`。
   * @param icon - 决定条目图标内容、边界或目标的 `icon` 值。
   * @returns 规范化后的条目图标；主值为空时采用 `item.path` 兜底；没有可用结果或提前结束时为 `undefined`。
   */
  private normalizeItemIcon(icon: unknown) {
    if (typeof icon === 'string') return icon;
    if (icon && typeof icon === 'object') {
      const item = icon as { path?: string; path_hr1?: string };
      return item.path_hr1 || item.path;
    }
    return undefined;
  }

  /**
   * 将`level`规范为条目Level，使等价输入得到一致表示；当 `level && typeof level === 'object'` 成立时返回 `item.row_id ?? item.value`。
   * @param level - 决定条目Level内容、边界或目标的 `level` 值。
   * @returns 规范化后的条目Level；主值为空时采用 `item.value` 兜底；没有可用结果或提前结束时为 `undefined`。
   */
  private normalizeItemLevel(level: unknown) {
    if (typeof level === 'number') return level;
    if (level && typeof level === 'object') {
      const item = level as { row_id?: number; value?: number };
      return item.row_id ?? item.value;
    }
    return undefined;
  }

  /**
   * 将`value`中的针对FF14 市场插件特殊字符转义，使结果可安全嵌入查询或脚本文本。
   * @param value - 待转换为针对FF14 市场插件的原始值。
   * @returns 完成特殊字符转义的针对FF14 市场插件。
   */
  private escapeXivapiValue(value: string) {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  /**
   * 针对FF14 市场插件，按 `this.host.requestJson<T>({ context, failureMessage: (statusCode) => `${context}失败：${statusC…` 计算并返回结果。
   * @param url - 待规范化、请求或同源校验的URL 地址 URL。
   * @param method - 决定JSON 数据内容、边界或目标的 `method` 值。
   * @param context - 决定JSON 数据内容、边界或目标的 `context` 值。
   * @returns JSON 数据。
   */
  private requestJson<T>(url: URL, method: Ff14HttpMethod, context: string) {
    return this.host.requestJson<T>({
      context,
      failureMessage: (statusCode) => `${context}失败：${statusCode}`,
      invalidJsonMessage: 'FF14 接口返回不是合法 JSON',
      method,
      timeoutMessage: 'FF14 接口请求超时',
      timeoutMs: 8000,
      url,
    });
  }
}

/**
 * 将`value`转换为针对FF14 市场插件；从 `date.getFullYear` 读取针对FF14 市场插件。
 * @param value - 待转换为针对FF14 市场插件的原始值。
 * @returns 针对FF14 市场插件。
 */
function formatFf14DateTime(value: number) {
  const date = new Date(value);
  const pad = (input: number) => `${input}`.padStart(2, '0');
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    ' ',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
    ':',
    pad(date.getSeconds()),
  ].join('');
}
