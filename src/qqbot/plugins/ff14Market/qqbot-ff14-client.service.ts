import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as http from 'node:http';
import * as https from 'node:https';

type HttpMethod = 'GET';

type XivapiSearchItem = {
  fields?: {
    Icon?: string;
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
    const itemId = Number(params.itemId || params.item);
    if (Number.isInteger(itemId) && itemId > 0) {
      return this.getItemById(itemId, params.language);
    }

    const keyword = `${params.item || ''}`.trim();
    if (!keyword) throw new Error('请提供 FF14 物品名称或物品 ID');

    const url = new URL(`${this.xivapiBaseUrl}/search`);
    url.searchParams.set('sheets', 'Item');
    url.searchParams.set('query', keyword);
    url.searchParams.set('language', params.language || 'zh');

    const data = await this.requestJson<{ results?: XivapiSearchItem[] }>(
      url,
      'GET',
    );
    const item = (data.results || []).find(
      (result) =>
        result.sheet === 'Item' || result.fields?.Name || result.name,
    );
    if (!item) throw new Error(`未找到 FF14 物品：${keyword}`);

    return {
      icon: item.fields?.Icon,
      itemId: Number(item.row_id || item.id),
      itemLevel: item.fields?.LevelItem,
      name: item.fields?.Name || item.name || keyword,
    };
  }

  async getPrice(params: {
    hq?: boolean;
    item?: string;
    itemId?: number | string;
    language?: string;
    world?: string;
  }): Promise<QqbotFf14PriceResult> {
    const world = this.normalizeWorld(params.world);
    const item = await this.resolveItem(params);
    const url = new URL(`${this.universalisBaseUrl}/${world}/${item.itemId}`);
    url.searchParams.set('entries', '5');
    url.searchParams.set('listings', '5');
    if (params.hq !== undefined) url.searchParams.set('hq', `${params.hq}`);

    const data = await this.requestJson<UniversalisMarketResponse>(url, 'GET');
    const minPrice = this.pickPrice(data, params.hq, 'min');
    const averagePrice = this.pickPrice(data, params.hq, 'average');
    const listings = (data.listings || []).slice(0, 5);
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
        world,
      }),
      updatedAt,
      world,
    };
  }

  private async getItemById(
    itemId: number,
    language = 'zh',
  ): Promise<QqbotFf14ResolvedItem> {
    const url = new URL(`${this.xivapiBaseUrl}/sheet/Item/${itemId}`);
    url.searchParams.set('language', language);
    const data = await this.requestJson<Record<string, any>>(url, 'GET');
    const fields = data.fields || data;
    return {
      icon: fields.Icon,
      itemId,
      itemLevel: fields.LevelItem,
      name: fields.Name || `${itemId}`,
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
      `服务器：${result.world}`,
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

  private normalizeWorld(world?: string) {
    const raw =
      `${world || this.configService.get<string>('FF14_DEFAULT_WORLD') || '中国'}`.trim();
    return encodeURIComponent(raw);
  }

  private requestJson<T>(url: URL, method: HttpMethod) {
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
              reject(new Error(`FF14 接口请求失败：${response.statusCode}`));
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
