import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as http from 'node:http';
import * as https from 'node:https';
import { resolveQqbotFf14MarketTarget } from './qqbot-ff14-worlds';

type HttpMethod = 'GET';

type XivapiSearchItem = {
  fields?: {
    Icon?: string;
    IsUntradable?: boolean;
    LevelItem?: number;
    Name?: string;
  };
  id?: number;
  name?: string;
  row_id?: number;
  sheet?: string;
};

type UniversalisListing = {
  hq?: boolean;
  lastReviewTime?: number;
  pricePerUnit?: number;
  quantity?: number;
  worldName?: string;
};

type UniversalisMarketResponse = {
  currentAveragePrice?: number;
  currentAveragePriceHQ?: number;
  currentAveragePriceNQ?: number;
  itemID?: number;
  lastUploadTime?: number;
  listings?: UniversalisListing[];
  minPrice?: number;
  minPriceHQ?: number;
  minPriceNQ?: number;
  worldName?: string;
};

export type QqbotFf14ResolvedItem = {
  icon?: string;
  isUntradable?: boolean;
  itemId: number;
  itemLevel?: number;
  name: string;
};

export type QqbotFf14PriceResult = {
  averagePrice?: number;
  hq?: boolean;
  item: QqbotFf14ResolvedItem;
  listings: UniversalisListing[];
  minPrice?: number;
  replyText: string;
  updatedAt?: string;
  world: string;
};

@Injectable()
export class QqbotFf14ClientService {
  private readonly xivapiBaseUrl: string;
  private readonly universalisBaseUrl: string;
  private readonly cnItemAliases = new Map<
    string,
    { itemId: number; name: string }
  >([
    ['小鸣鼠', { itemId: 43590, name: '小鸣鼠角笛' }],
    ['小鸣鼠角笛', { itemId: 43590, name: '小鸣鼠角笛' }],
  ]);

  constructor(private readonly configService: ConfigService) {
    this.xivapiBaseUrl =
      this.configService.get<string>('FF14_XIVAPI_BASE_URL') ||
      'https://v2.xivapi.com/api';
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

    const alias = this.resolveCnItemAlias(keyword);
    if (alias) {
      return this.getItemById(alias.itemId, language, alias.name);
    }

    const url = new URL(`${this.xivapiBaseUrl}/search`);
    url.searchParams.set('sheets', 'Item');
    url.searchParams.set('fields', 'Name,Icon,LevelItem,IsUntradable');
    url.searchParams.set('query', `Name~"${this.escapeXivapiValue(keyword)}"`);
    url.searchParams.set('language', language);
    url.searchParams.set('limit', '10');

    const data = await this.requestJson<{ results?: XivapiSearchItem[] }>(
      url,
      'GET',
      'XIVAPI 物品解析',
    );
    const item = (data.results || []).find(
      (result) =>
        result.sheet === 'Item' || result.fields?.Name || result.name,
    );
    if (!item) throw new Error(`未找到 FF14 物品：${keyword}`);

    return {
      icon: item.fields?.Icon,
      isUntradable: item.fields?.IsUntradable,
      itemId: Number(item.row_id || item.id),
      itemLevel: item.fields?.LevelItem,
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
    const marketTarget = this.resolveMarketTarget(params);
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
      `${this.universalisBaseUrl}/${encodeURIComponent(
        marketTarget.target,
      )}/${item.itemId}`,
    );
    url.searchParams.set('entries', '5');
    url.searchParams.set('listings', '5');
    if (params.hq !== undefined) url.searchParams.set('hq', `${params.hq}`);

    const data = await this.requestJson<UniversalisMarketResponse>(
      url,
      'GET',
      'Universalis 市场查询',
    );
    const listings = (data.listings || []).slice(0, 5);
    const minPrice = this.normalizeMarketPrice(
      this.pickPrice(data, params.hq, 'min'),
      listings,
    );
    const averagePrice = this.normalizeMarketPrice(
      this.pickPrice(data, params.hq, 'average'),
      listings,
    );
    const updatedAt = data.lastUploadTime
      ? new Date(data.lastUploadTime).toISOString()
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
    language = 'zh',
    displayName?: string,
  ): Promise<QqbotFf14ResolvedItem> {
    const url = new URL(`${this.xivapiBaseUrl}/sheet/Item/${itemId}`);
    url.searchParams.set('fields', 'Name,Icon,LevelItem,IsUntradable');
    url.searchParams.set('language', this.normalizeXivapiLanguage(language));
    const data = await this.requestJson<Record<string, any>>(
      url,
      'GET',
      'XIVAPI 物品解析',
    );
    const fields = data.fields || data;
    return {
      icon: fields.Icon,
      isUntradable: fields.IsUntradable,
      itemId,
      itemLevel: fields.LevelItem,
      name: displayName || fields.Name || `${itemId}`,
    };
  }

  private buildReplyText(result: Omit<QqbotFf14PriceResult, 'replyText'>) {
    const quality = result.hq === undefined ? '' : result.hq ? ' HQ' : ' NQ';
    const minPrice =
      result.minPrice === undefined ? '暂无' : `${result.minPrice}`;
    const averagePrice =
      result.averagePrice === undefined ? '暂无' : `${result.averagePrice}`;
    const listingText = result.listings.length
      ? result.listings
          .slice(0, 3)
          .map((item, index) => {
            const hq = item.hq ? 'HQ' : 'NQ';
            return `${index + 1}. ${item.pricePerUnit} x${item.quantity || 1} ${hq}`;
          })
          .join('\n')
      : '暂无在售记录';

    return [
      `FF14 查价：${result.item.name}${quality}`,
      `查询范围：${result.world}`,
      `最低价：${minPrice}`,
      `均价：${averagePrice}`,
      `近期挂单：`,
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

  private normalizeWorld(world?: string) {
    const raw =
      `${world || this.configService.get<string>('FF14_DEFAULT_WORLD') || '中国'}`.trim();
    return raw;
  }

  private resolveMarketTarget(params: {
    dataCenter?: string;
    region?: string;
    world?: string;
  }) {
    return resolveQqbotFf14MarketTarget({
      dataCenter: params.dataCenter,
      fallback: this.normalizeWorld(params.world),
      region: params.region,
      world: params.world,
    });
  }

  private normalizeXivapiLanguage(language?: string) {
    const value = `${language || 'en'}`.trim().toLowerCase();
    return ['en', 'ja', 'de', 'fr'].includes(value) ? value : 'en';
  }

  private resolveCnItemAlias(keyword: string) {
    return this.cnItemAliases.get(keyword.trim());
  }

  private escapeXivapiValue(value: string) {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  private requestJson<T>(url: URL, method: HttpMethod, context: string) {
    return new Promise<T>((resolve, reject) => {
      const client = url.protocol === 'http:' ? http : https;
      const request = client.request(
        url,
        {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'kt-template-online-api/qqbot',
          },
          method,
          timeout: 8000,
        },
        (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => {
            body += chunk;
          });
          response.on('end', () => {
            if ((response.statusCode || 500) >= 400) {
              reject(
                new Error(`${context}失败：${response.statusCode}`),
              );
              return;
            }
            try {
              resolve(JSON.parse(body) as T);
            } catch {
              reject(new Error('FF14 接口返回不是合法 JSON'));
            }
          });
        },
      );
      request.on('timeout', () => {
        request.destroy(new Error('FF14 接口请求超时'));
      });
      request.on('error', reject);
      request.end();
    });
  }
}
