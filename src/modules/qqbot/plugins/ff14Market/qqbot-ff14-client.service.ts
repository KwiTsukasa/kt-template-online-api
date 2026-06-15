import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { formatKtDateTime } from '@/common';
import { DictService } from '@/modules/admin/platform-config/dict/dict.service';
import { QqbotPluginHttpClientService } from '@/modules/qqbot/plugin-platform/sdk';
import {
  buildQqbotFf14MarketCatalog,
  buildQqbotFf14MarketCatalogFromTree,
  QQBOT_FF14_MARKET_DICT_CODES,
  resolveQqbotFf14MarketTarget,
} from './qqbot-ff14-worlds';
import type {
  Ff14HttpMethod,
  QqbotFf14PriceResult,
  QqbotFf14ResolvedItem,
  UniversalisListing,
  UniversalisMarketResponse,
  XivapiSearchItem,
} from './qqbot-ff14-market.types';

@Injectable()
export class QqbotFf14ClientService {
  private readonly xivapiBaseUrl: string;
  private readonly xivapiChsBaseUrl: string;
  private readonly universalisBaseUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly dictService: DictService,
    private readonly httpClient: QqbotPluginHttpClientService,
  ) {
    this.xivapiBaseUrl =
      this.configService.get<string>('FF14_XIVAPI_BASE_URL') ||
      'https://v2.xivapi.com/api';
    this.xivapiChsBaseUrl =
      this.configService.get<string>('FF14_XIVAPI_CHS_BASE_URL') ||
      'https://xivapi-v2.xivcdn.com/api';
    this.universalisBaseUrl =
      this.configService.get<string>('FF14_UNIVERSALIS_BASE_URL') ||
      'https://universalis.app/api/v2';
  }

  async resolveItem(params: {
    item?: string;
    itemId?: number | string;
    language?: string;
  }): Promise<QqbotFf14ResolvedItem> {
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

  async getPrice(params: {
    dataCenter?: string;
    hq?: boolean;
    item?: string;
    itemId?: number | string;
    language?: string;
    region?: string;
    world?: string;
  }): Promise<QqbotFf14PriceResult> {
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
      ? formatKtDateTime(data.lastUploadTime)
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

  private async getItemById(
    itemId: number,
    language = 'chs',
    displayName?: string,
  ): Promise<QqbotFf14ResolvedItem> {
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

  private buildReplyText(result: Omit<QqbotFf14PriceResult, 'replyText'>) {
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

  private normalizeMarketPrice(
    price: number | undefined,
    listings: UniversalisListing[],
  ) {
    if (!listings.length && (!price || price <= 0)) return undefined;
    return price;
  }

  private formatPrice(value: number) {
    return Math.round(value).toLocaleString('en-US');
  }

  private normalizeWorld(world?: string, fallback?: string) {
    const raw = `${
      world ||
      this.configService.get<string>('FF14_DEFAULT_WORLD') ||
      fallback ||
      ''
    }`.trim();
    return raw;
  }

  private async resolveMarketTarget(params: {
    dataCenter?: string;
    region?: string;
    world?: string;
  }) {
    const catalog = await this.getFf14MarketCatalog();
    return resolveQqbotFf14MarketTarget(catalog, {
      dataCenter: params.dataCenter,
      fallback: this.normalizeWorld(params.world, catalog.defaultRegion),
      region: params.region,
      world: params.world,
    });
  }

  private async getFf14MarketCatalog() {
    const treeCatalog = buildQqbotFf14MarketCatalogFromTree(
      await this.dictService.relationTree({
        dictCode: QQBOT_FF14_MARKET_DICT_CODES.region,
      }),
    );
    if (treeCatalog.dataCenters.length > 0) return treeCatalog;

    const [regions, dataCenters, worlds] = await Promise.all([
      this.dictService.getDictItemsByKey(QQBOT_FF14_MARKET_DICT_CODES.region),
      this.dictService.getDictItemsByKey(
        QQBOT_FF14_MARKET_DICT_CODES.dataCenter,
      ),
      this.dictService.getDictItemsByKey(QQBOT_FF14_MARKET_DICT_CODES.world),
    ]);
    return buildQqbotFf14MarketCatalog({
      dataCenters,
      regions,
      worlds,
    });
  }

  private normalizeXivapiLanguage(language?: string) {
    const value = `${language || 'chs'}`.trim().toLowerCase();
    if (['zh', 'zh-cn', 'zh_hans', 'cn', 'chs'].includes(value)) return 'chs';
    return ['en', 'ja', 'de', 'fr'].includes(value) ? value : 'en';
  }

  private buildXivapiUrl(path: string, language: string) {
    const baseUrl =
      language === 'chs' ? this.xivapiChsBaseUrl : this.xivapiBaseUrl;
    return new URL(`${baseUrl.replace(/\/+$/, '')}${path}`);
  }

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

  private pickFirstSearchItem(items: XivapiSearchItem[]) {
    return items[0];
  }

  private pickSingleFuzzySearchItem(items: XivapiSearchItem[]) {
    if (items.length <= 1) return items[0];
    throw new Error(
      `找到多个相似物品，请输入更完整名称或物品 ID：${this.formatSearchCandidates(
        items,
      )}`,
    );
  }

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

  private normalizeItemIcon(icon: unknown) {
    if (typeof icon === 'string') return icon;
    if (icon && typeof icon === 'object') {
      const item = icon as { path?: string; path_hr1?: string };
      return item.path_hr1 || item.path;
    }
    return undefined;
  }

  private normalizeItemLevel(level: unknown) {
    if (typeof level === 'number') return level;
    if (level && typeof level === 'object') {
      const item = level as { row_id?: number; value?: number };
      return item.row_id ?? item.value;
    }
    return undefined;
  }

  private escapeXivapiValue(value: string) {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  private requestJson<T>(url: URL, method: Ff14HttpMethod, context: string) {
    return this.httpClient.requestJson<T>({
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
