import {
  buildFf14MarketCatalog,
  buildFf14MarketCatalogFromTree,
  QQBOT_FF14_MARKET_DICT_CODES,
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

  /**
   * 初始化 Ff14MarketClient 实例。
   * @param host - host 输入；驱动 `resolveFf14MarketConfig()` 的 FF14 市场步骤。
   */
  constructor(private readonly host: Ff14MarketPluginHost) {
    const config = resolveFf14MarketConfig(host);
    this.xivapiBaseUrl = config.xivapiBaseUrl;
    this.xivapiChsBaseUrl = config.xivapiChsBaseUrl;
    this.universalisBaseUrl = config.universalisBaseUrl;
  }

  /**
   * 解析Item。
   * @param params - FF14 市场列表；使用 `language`、`itemId`、`item` 字段生成结果。
   * @returns FF14 市场插件转换后的值。
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
   * 查询 FF14 市场插件数据。
   * @param params - FF14 市场列表；使用 `hq` 字段生成结果。
   * @returns FF14 市场插件查询结果。
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
    const updatedAt = data.lastUploadTime
      ? formatFf14DateTime(data.lastUploadTime)
      : undefined;

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
   * 查询 FF14 市场插件数据。
   * @param itemId - FF14 市场 ID；定位本次读取、更新、删除或关联的FF14 市场。
   * @param language - language 输入；驱动 `this.normalizeXivapiLanguage()`、`searchParams.set()` 的 FF14 市场步骤。
   * @param displayName - displayName 输入；驱动 `this.normalizeItemIcon()` 的 FF14 市场步骤。
   * @returns FF14 市场插件查询结果。
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
   * 创建 FF14 市场插件对象或配置。
   * @param result - result 输入；使用 `listings`、`world`、`item` 字段生成结果。
   */
  private buildReplyText(result: Omit<Ff14PriceResult, 'replyText'>) {
    const listingText = result.listings.length
      ? result.listings
          .slice(0, 10)
          .map((item) => {
            const hq = item.hq ? 'HQ' : 'NQ';
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
          .join('\n')
      : '暂无在售记录';

    return [
      `服务器 ${result.world} 上的物品 ${result.item.name} (ID: ${result.item.itemId}) 市场价格如下:`,
      listingText,
    ].join('\n');
  }

  /**
   * 执行 FF14 市场插件流程。
   * @param data - 业务数据；承载 FF14 市场新增、更新、导入或执行字段。
   * @param hq - hq 输入；决定 FF14 市场条件分支。
   * @param type - type 输入；决定 FF14 市场条件分支。
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
   * 转换 FF14 市场插件输入。
   * @param price - price 输入；决定 FF14 市场条件分支。
   * @param listings - FF14 市场列表；使用 `length` 字段生成结果。
   */
  private normalizeMarketPrice(
    price: number | undefined,
    listings: UniversalisListing[],
  ) {
    if (!listings.length && (!price || price <= 0)) return undefined;
    return price;
  }

  /**
   * 转换 FF14 市场插件输入。
   * @param value - 待转换时间值；驱动 `Math.round()` 的 FF14 市场步骤。
   */
  private formatPrice(value: number) {
    return Math.round(value).toLocaleString('en-US');
  }

  /**
   * 转换 FF14 市场插件输入。
   * @param world - world 输入；影响 normalizeWorld 的返回值。
   * @param fallback - 兜底值；影响 normalizeWorld 的返回值。
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
   * 解析Market Target。
   * @param params - FF14 市场列表；使用 `dataCenter`、`world`、`region` 字段生成结果。
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
   * 查询 FF14 市场插件数据。
   */
  async getMarketCatalog() {
    const treeCatalog = buildFf14MarketCatalogFromTree(
      await this.host.relationTree({
        dictCode: QQBOT_FF14_MARKET_DICT_CODES.region,
      }),
    );
    if (treeCatalog.dataCenters.length > 0) return treeCatalog;

    const [regions, dataCenters, worlds] = await Promise.all([
      this.host.getDictItemsByKey(QQBOT_FF14_MARKET_DICT_CODES.region),
      this.host.getDictItemsByKey(QQBOT_FF14_MARKET_DICT_CODES.dataCenter),
      this.host.getDictItemsByKey(QQBOT_FF14_MARKET_DICT_CODES.world),
    ]);
    return buildFf14MarketCatalog({
      dataCenters,
      regions,
      worlds,
    });
  }

  /**
   * 转换 FF14 市场插件输入。
   * @param language - language 输入；影响 normalizeXivapiLanguage 的返回值。
   */
  private normalizeXivapiLanguage(language?: string) {
    const value = `${language || 'chs'}`.trim().toLowerCase();
    if (['zh', 'zh-cn', 'zh_hans', 'cn', 'chs'].includes(value)) return 'chs';
    return ['en', 'ja', 'de', 'fr'].includes(value) ? value : 'en';
  }

  /**
   * 创建 FF14 市场插件对象或配置。
   * @param path - 路由或文件路径；生成 FF14 市场对象。
   * @param language - language 输入；生成 FF14 市场对象。
   */
  private buildXivapiUrl(path: string, language: string) {
    const baseUrl =
      language === 'chs' ? this.xivapiChsBaseUrl : this.xivapiBaseUrl;
    return new URL(`${baseUrl.replace(/\/+$/, '')}${path}`);
  }

  /**
   * 执行 FF14 市场插件流程。
   * @param keyword - keyword 输入；驱动 `this.pickFirstSearchItem()`、`this.searchItemsByLanguage()` 的 FF14 市场步骤。
   * @param language - language 输入；驱动 `this.pickFirstSearchItem()`、`this.searchItemsByLanguage()` 的 FF14 市场步骤。
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
   * 执行 FF14 市场插件流程。
   * @param keyword - keyword 输入；驱动 `this.escapeXivapiValue()` 的 FF14 市场步骤。
   * @param language - language 输入；驱动 `this.buildXivapiUrl()`、`searchParams.set()` 的 FF14 市场步骤。
   * @param operator - SQL 条件连接符；限定 FF14 市场查询范围。
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
   * 执行 FF14 市场插件流程。
   * @param items - FF14 市场列表；影响 pickFirstSearchItem 的返回值。
   */
  private pickFirstSearchItem(items: XivapiSearchItem[]) {
    return items[0];
  }

  /**
   * 执行 FF14 市场插件流程。
   * @param items - FF14 市场列表；使用 `length` 字段生成结果。
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
   * 转换 FF14 市场插件输入。
   * @param items - FF14 市场列表；影响 formatSearchCandidates 的返回值。
   */
  private formatSearchCandidates(items: XivapiSearchItem[]) {
    return items
      .slice(0, 5)
      .map((item) => {
        const name = item.fields?.Name || item.name || '未知物品';
        const id = item.row_id || item.id;
        return id ? `${name}(ID:${id})` : name;
      })
      .join('、');
  }

  /**
   * 转换 FF14 市场插件输入。
   * @param icon - icon 输入；决定 FF14 市场条件分支。
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
   * 转换 FF14 市场插件输入。
   * @param level - level 输入；决定 FF14 市场条件分支。
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
   * 执行 FF14 市场插件流程。
   * @param value - 待转换值；生成规范化文本。
   */
  private escapeXivapiValue(value: string) {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  /**
   * 执行 FF14 市场插件流程。
   * @param url - 访问地址；影响 requestJson 的返回值。
   * @param method - HTTP 方法名；影响 requestJson 的返回值。
   * @param context - context 输入；影响 requestJson 的返回值。
   */
  private requestJson<T>(url: URL, method: Ff14HttpMethod, context: string) {
    return this.host.requestJson<T>({
      context,
      /**
       * 执行 FF14 市场回调。
       * @param statusCode - statusCode 输入；影响 failureMessage 的返回值。
       */
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
 * 转换 FF14 市场插件输入。
 * @param value - 待转换时间值；构造时间对象。
 */
function formatFf14DateTime(value: number) {
  const date = new Date(value);
  /**
   * 补齐 FF14 市场插件展示文本。
   * @param input - input 输入；影响 pad 的返回值。
   */
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
