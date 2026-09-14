import {
  buildFf14MarketCatalog,
  buildFf14MarketCatalogFromTree,
  PLUGIN_FF14_MARKET_DICT_CODES,
  resolveFf14MarketTarget,
} from '../../domain/ff14-worlds';
import { resolveFf14MarketConfig } from '../../config/ff14-market-config';
import { parseChineseItemCatalog } from './chinese-item-catalog';
import { MarketScan, type MarketScanStorage } from '../storage/market-scan';
import {
  marketTimeRange,
  summarizeMarketSales,
} from '../../application/market-statistics';
import type {
  Ff14HttpMethod,
  Ff14PriceResult,
  Ff14ResolvedItem,
  UniversalisListing,
  UniversalisMarketResponse,
  XivapiSearchItem,
} from '../../domain/ff14-market.types';

export type Ff14MarketPluginHost = MarketScanStorage & {
  requestBuffer?: (options: {
    context: string;
    timeoutMs: number;
    maxResponseBytes: number;
    url: URL;
  }) => Promise<Uint8Array>;
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
  private readonly marketScan: MarketScan;
  private chineseCatalog?: {
    expiresAt: number;
    data: Promise<Map<number, XivapiSearchItem>>;
  };

  constructor(private readonly host: Ff14MarketPluginHost) {
    const config = resolveFf14MarketConfig(host);
    this.xivapiBaseUrl = config.xivapiBaseUrl;
    this.xivapiChsBaseUrl = config.xivapiChsBaseUrl;
    this.universalisBaseUrl = config.universalisBaseUrl;
    this.marketScan = new MarketScan(host);
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
   * 返回真实物品候选、正式名称和版本；支持名称关键词及游戏原生市场分类筛选。
   * @param params - 名称关键词、原生市场分类和语言。
   * @returns 最多一百个候选及目录完整性，不把模糊命中自动认成用户指定物品。
   * @throws 查询为空时拒绝请求整个物品数据库。
   */
  async findItems(params: {
    item?: string;
    category?: string;
    searchCategory?: string;
    language?: string;
  }) {
    const language = this.normalizeXivapiLanguage(params.language);
    const keyword = String(params.item || params.category || '')
      .trim()
      .normalize('NFKC')
      .replace(/:/gu, '：');
    if (!keyword && !params.searchCategory)
      throw new Error('提供物品关键词或市场分类名');
    const clauses: string[] = [];
    if (keyword) clauses.push(`+Name~"${this.escapeXivapiValue(keyword)}"`);
    if (params.searchCategory)
      clauses.push(
        `+ItemSearchCategory.Name="${this.escapeXivapiValue(params.searchCategory)}"`,
      );
    const url = this.buildXivapiUrl('/search', language);
    url.search = new URLSearchParams({
      sheets: 'Item',
      fields: 'Name,IsUntradable,ItemSearchCategory.Name',
      language,
      limit: '100',
      query: clauses.join(' '),
    }).toString();
    const data = await this.requestJson<any>(url, 'GET', 'XIVAPI物品目录');
    let items = (data.results || []).map((row: any) => ({
      itemId: Number(row.row_id),
      name: row.fields?.Name,
      isUntradable: row.fields?.IsUntradable,
      searchCategory: row.fields?.ItemSearchCategory?.fields?.Name,
    }));
    const supplementalSources: string[] = [];
    const warnings: string[] = [];
    if (language === 'chs' && keyword && !params.searchCategory) {
      let catalog = new Map<number, XivapiSearchItem>();
      try {
        catalog = await this.getChineseCatalog();
      } catch (error) {
        if (!items.length) throw error;
        warnings.push(`最新中文目录读取失败，保留API候选：${String(error)}`);
      }
      const merged = new Map<number, any>(
        items.map((item: any) => [item.itemId, item]),
      );
      for (const row of catalog.values()) {
        if (
          !row.fields?.Name?.normalize('NFKC').includes(
            keyword.normalize('NFKC'),
          )
        )
          continue;
        const itemId = Number(row.row_id);
        merged.set(itemId, {
          ...merged.get(itemId),
          itemId,
          name: row.fields.Name,
          isUntradable: row.fields.IsUntradable,
        });
      }
      items = [...merged.values()];
      if (catalog.size)
        supplementalSources.push(this.chineseCatalogUrl().toString());
    }
    const complete = items.length < 100 && !data.next;
    items = items.slice(0, 100);
    return {
      keyword,
      items,
      complete,
      version: data.version,
      source: url.toString(),
      supplementalSources,
      warnings,
      replyText: `${items.length}个物品候选：\n${items.map((item: any) => `${item.itemId} ${item.name}`).join('\n')}`,
    };
  }

  /**
   * 按统一时间范围分批读取多个物品的真实成交，并由代码完成统计和排名。
   * @param params - 可选物品范围、地区、时间范围和品质筛选；省略范围时扫描完整可交易目录。
   * @returns 带每项来源覆盖、缺失项及确定性排名的成交统计。
   * @throws 数量、排序参数或上游目录无效时拒绝计算。
   */
  async getStatistics(params: Record<string, any>) {
    const metric = String(params.metric || 'turnover');
    if (
      !['turnover', 'quantity', 'transactions', 'weightedAverage'].includes(
        metric,
      )
    )
      throw new Error(
        'metric支持turnover、quantity、transactions、weightedAverage',
      );
    const range = marketTimeRange(params);
    const target = await this.resolveMarketTarget(params);
    let items: Array<{ itemId: number; name: string }>;
    let catalogComplete = true;
    let catalogSource = '';
    let allMarket = false;
    if (params.items) {
      const ids = String(params.items).split(/[,，]/u).map(Number);
      if (
        !ids.length ||
        ids.length > 100 ||
        ids.some((id) => !Number.isSafeInteger(id) || id <= 0)
      )
        throw new Error('items必须为最多100个真实物品ID，以逗号分隔');
      items = [...new Set(ids)].map((itemId) => ({
        itemId,
        name: `物品${itemId}`,
      }));
    } else if (params.category || params.searchCategory) {
      const catalog = await this.findItems(params);
      items = catalog.items.filter((item: any) => item.isUntradable !== true);
      catalogComplete = catalog.complete;
      catalogSource = catalog.source;
    } else if (params.item || params.itemId) {
      const item = await this.resolveItem(params);
      items = [item];
    } else {
      catalogSource = `${this.universalisBaseUrl}/marketable`;
      const ids = await this.requestJson<unknown>(
        new URL(catalogSource),
        'GET',
        'Universalis可交易物品目录',
      );
      if (
        !Array.isArray(ids) ||
        !ids.length ||
        ids.some((id) => !Number.isSafeInteger(id) || id <= 0)
      )
        throw new Error('Universalis可交易物品目录无效，未生成排名');
      items = [...new Set<number>(ids)].map((itemId) => ({
        itemId,
        name: `物品${itemId}`,
      }));
      allMarket = true;
    }
    if (allMarket) {
      return this.getFullMarketStatistics(
        items.map((item) => item.itemId),
        params,
        range,
        target,
        metric,
        catalogSource,
      );
    }
    if (!items.length)
      return {
        status: 'no_items',
        items: [],
        catalogSource,
        replyText: '该目录未找到可交易物品，未生成虚构的零成交排名。',
      };
    const batches: Array<typeof items> = [];
    for (let index = 0; index < items.length; index += 100)
      batches.push(items.slice(index, index + 100));
    const rows: Array<ReturnType<typeof summarizeMarketSales>> = [];
    const sources: string[] = [];
    const failures: Array<{ itemIds: number[]; error: string }> = [];
    // 使用上游允许的每批一百项；固定自然日窗口，分批聚合后释放原始成交记录。
    for (let offset = 0; offset < batches.length; offset += 4) {
      await Promise.all(
        batches.slice(offset, offset + 4).map(async (batch) => {
          const url = new URL(
            `${this.universalisBaseUrl}/history/${encodeURIComponent(target.target)}/${batch.map((item) => item.itemId).join(',')}`,
          );
          url.search = new URLSearchParams({
            entriesToReturn: '99999',
            entriesWithin: String(range.end - 1 - range.start),
            entriesUntil: String(range.end - 1),
          }).toString();
          sources.push(url.toString());
          try {
            const data = await this.requestJson<any>(
              url,
              'GET',
              'Universalis成交统计',
            );
            for (const item of batch) {
              let history = data.items?.[String(item.itemId)];
              if (data.itemID === item.itemId) history = data;
              rows.push(
                summarizeMarketSales(item, history, {
                  ...range,
                  hq: params.hq,
                  sourceLimit: 99999,
                }),
              );
            }
          } catch (error) {
            let message = '成交接口读取失败';
            if (error instanceof Error) message = error.message;
            failures.push({
              itemIds: batch.map((item) => item.itemId),
              error: message,
            });
            for (const item of batch)
              rows.push(summarizeMarketSales(item, undefined, range));
          }
        }),
      );
    }
    const ranked = rows
      .filter((row) => row.status === 'available')
      .sort(
        (a, b) =>
          Number(b[metric] || 0) - Number(a[metric] || 0) ||
          a.itemId - b.itemId,
      );
    const scannedItems = rows.length;
    const scanComplete = scannedItems === items.length;
    const complete =
      catalogComplete && scanComplete && rows.every((row) => row.complete);
    const rankings = ranked.filter((row) => Number(row.transactions) > 0);
    const warnings: string[] = [];
    return {
      range: { ...range, timezone: 'Asia/Shanghai' },
      world: target.label,
      metric,
      catalogComplete,
      complete,
      scanComplete,
      allMarket,
      catalogItems: items.length,
      scannedItems,
      unscannedItems: items.length - scannedItems,
      availableItems: ranked.length,
      itemsWithSales: rankings.length,
      truncatedItems: rows
        .filter(
          (row) => row.status === 'available' && row.sourceRecords >= 99999,
        )
        .map((row) => row.itemId),
      warnings,
      catalogSource,
      sources,
      failures,
      unavailable: rows.filter((row) => row.status === 'unavailable'),
      rankings,
      coverage:
        'Universalis玩家上传的成交记录；不代表游戏服务器全部成交。单物品最多99999条，complete仅表示本次接口窗口未发现截断或缺失；缺失项不当作零成交，扫描未完成不能宣称全区前20。',
      replyText: `${target.label}成交统计（${params.date || '最近' + (params.days || 1) + '天'}，已查询${scannedItems}/${items.length}件物品，排序${metric}）\n${rankings
        .slice(0, 20)
        .map(
          (row, index) =>
            `${index + 1}. ${row.name}：销量${row.quantity}，成交额${row.turnover}，成交笔数${row.transactions}`,
        )
        .join(
          '\n',
        )}\n数据为玩家上传成交；完整性=${complete}，缺失${rows.length - ranked.length}项，未查询${items.length - scannedItems}项。`,
    };
  }

  /**
   * 通过私有扫描检查点完成全目录查询，慢请求续查而不丢弃尚未读取的物品。
   * @param ids - 上游返回的完整可交易物品目录。
   * @param params - 用户指定的日期、品质及语言。
   * @param range - 全部批次共用的固定时间窗口。
   * @param target - 已解析的真实地区或服务器。
   * @param metric - 已校验的排序指标。
   * @param catalogSource - 目录来源地址。
   * @returns 完整扫描榜单或可继续执行的进度，不将局部排名作为最终答案。
   */
  private async getFullMarketStatistics(
    ids: number[],
    params: Record<string, any>,
    range: { start: number; end: number },
    target: { target: string; label: string },
    metric: string,
    catalogSource: string,
  ) {
    const result = await this.marketScan.run({
      ids,
      range,
      world: target.target,
      metric,
      hq: params.hq,
      windowKey: params.date || `days=${Number(params.days ?? 1)}`,
      readBatch: async (batch, fixedRange) => {
        const url = new URL(
          `${this.universalisBaseUrl}/history/${encodeURIComponent(target.target)}/${batch.join(',')}`,
        );
        url.search = new URLSearchParams({
          entriesToReturn: '99999',
          entriesWithin: String(fixedRange.end - 1 - fixedRange.start),
          entriesUntil: String(fixedRange.end - 1),
        }).toString();
        return this.requestJson<any>(url, 'GET', 'Universalis成交统计');
      },
    });
    const warnings: string[] = [];
    const rankings: any[] = result.rankings;
    if (rankings.length) {
      const language = this.normalizeXivapiLanguage(params.language);
      const url = this.buildXivapiUrl('/sheet/Item', language);
      url.search = new URLSearchParams({
        rows: rankings.map((row) => row.itemId).join(','),
        fields: 'Name,Icon',
        language,
      }).toString();
      try {
        const names = await this.requestJson<{ rows?: XivapiSearchItem[] }>(
          url,
          'GET',
          'XIVAPI排行榜物品名称',
        );
        for (const row of rankings) {
          const item = names.rows?.find((entry) => entry.row_id === row.itemId);
          if (item?.fields?.Name) row.name = item.fields.Name;
          row.icon = this.normalizeItemIcon(item?.fields?.Icon);
        }
      } catch {
        warnings.push('名称接口读取失败，保留真实物品ID与详情入口');
      }
      if (language === 'chs') {
        try {
          const names = await this.getChineseCatalog();
          for (const row of rankings) {
            const name = names.get(row.itemId)?.fields?.Name;
            if (name) row.name = name;
          }
        } catch {
          warnings.push('最新中文目录读取失败，保留已核实名称');
        }
      }
      for (const row of rankings) {
        row.itemUrl = `https://universalis.app/market/${row.itemId}`;
        row.nameStatus = 'source_name';
        if (/^(?:物品\d+|追加.+\d+)$/u.test(row.name)) {
          row.nameStatus = 'unresolved_placeholder';
          row.sourceName = row.name;
          row.name = `${row.name}（ID ${row.itemId}，正式名称待核实）`;
        }
      }
    }
    let replyText = `全区扫描进度${result.scannedItems}/${ids.length}；尚未完成，不生成局部前20。请继续同一查询以复用进度。`;
    if (result.scanComplete) {
      replyText = `${target.label}成交统计（${params.date || '固定时间窗口'}，${result.scannedItems}/${ids.length}件，${metric}）\n${rankings.map((row, index) => `${index + 1}. ${row.name}：销量${row.quantity}，成交额${row.turnover}，成交笔数${row.transactions}；${row.itemUrl}`).join('\n')}\n玩家上传成交；缺失${result.unavailableCount}项，完整性=${result.complete}。`;
    }
    return {
      ...result,
      allMarket: true,
      catalogComplete: true,
      catalogSource,
      range: { ...result.range, timezone: 'Asia/Shanghai' },
      world: target.label,
      metric,
      warnings,
      rankings,
      resume: { ...params, mode: 'stats' },
      sources: [
        catalogSource,
        `${this.universalisBaseUrl}/history/${encodeURIComponent(target.target)}`,
      ],
      coverage:
        'Universalis玩家上传成交；扫描完成不代表官方全部流水。缺失项不视为零，未扫描完不返回全区排名。',
      replyText,
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
      source: url.toString(),
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
    let fields = data.fields || data;
    if (normalizedLanguage === 'chs' && !fields.Name) {
      const current = (await this.getChineseCatalog()).get(itemId);
      if (current?.fields) fields = { ...fields, ...current.fields };
    }
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
    const baseUrl = (() => {
      if (language === 'chs') {
        return this.xivapiChsBaseUrl;
      }
      return this.xivapiBaseUrl;
    })();
    return new URL(`${baseUrl.replace(/\/+$/, '')}${path}`);
  }

  /**
   * 优先完成当前语言的精确与模糊查找；拉丁文本才回退英文源，避免中文简称被无关网络失败阻断。
   * @param keyword - 用户提供的原始物品名称或简称。
   * @param language - 本次物品目录语言。
   * @returns 唯一命中的真实物品；没有命中时返回空值。
   * @throws 精确名称不存在但有同类候选时返回候选查询入口，不将同类物品认作目标。
   */
  private async searchItem(keyword: string, language: string) {
    keyword = keyword.normalize('NFKC').replace(/:/gu, '：');
    const item = this.pickFirstSearchItem(
      await this.searchItemsByLanguage(keyword, language, '='),
    );
    if (item) return item;

    const fuzzyItems = await this.searchItemsByLanguage(keyword, language, '~');
    const fuzzyItem = this.pickSingleFuzzySearchItem(fuzzyItems);
    if (fuzzyItem) return fuzzyItem;

    if (language !== 'en' && !/\p{Script=Han}/u.test(keyword)) {
      const enItem = this.pickFirstSearchItem(
        await this.searchItemsByLanguage(keyword, 'en', '='),
      );
      if (enItem) return enItem;
      const enFuzzyItems = await this.searchItemsByLanguage(keyword, 'en', '~');
      const fallback = this.pickSingleFuzzySearchItem(enFuzzyItems);
      if (fallback) return fallback;
    }
    if (language === 'chs') {
      const catalog = await this.getChineseCatalog();
      const normalized = keyword.normalize('NFKC');
      const candidates = [...catalog.values()].filter((row) =>
        row.fields?.Name?.normalize('NFKC').includes(normalized),
      );
      const exact = candidates.find(
        (row) => row.fields?.Name?.normalize('NFKC') === normalized,
      );
      if (exact) return exact;
      const current = this.pickSingleFuzzySearchItem(candidates);
      if (current) return current;
    }
    const category = keyword.split('：')[0];
    if (category !== keyword && category.length >= 2) {
      const candidates = await this.findItems({ category, language });
      if (candidates.items.length)
        throw new Error(
          `未找到名称“${keyword}”（目录版本${candidates.version}）。请使用用户原始简称查询，不要自行补写正式名称。真实同类候选：${candidates.items.map((item: any) => `${item.name}(ID:${item.itemId})`).join('、')}。不能直接把同类物品当作目标。`,
        );
    }
    return undefined;
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
   * 在中文API落后时读取同一维护方的最新原始目录，按需缓存十五分钟且失败不缓存。
   * @returns 可供精确或唯一简称匹配的中文物品表；旧宿主未提供二进制读取时返回空表。
   */
  private async getChineseCatalog(): Promise<Map<number, XivapiSearchItem>> {
    if (!this.host.requestBuffer) return new Map();
    if (this.chineseCatalog && this.chineseCatalog.expiresAt > Date.now())
      return this.chineseCatalog.data;
    const url = this.chineseCatalogUrl();
    const data = this.retryRead(
      async () => {
        const bytes = await this.host.requestBuffer!({
          url,
          context: '最新中文物品目录',
          timeoutMs: 20000,
          maxResponseBytes: 32 * 1024 * 1024,
        });
        return parseChineseItemCatalog(Buffer.from(bytes).toString('utf8'));
      },
      url,
      '最新中文物品目录',
    );
    this.chineseCatalog = { data, expiresAt: Date.now() + 15 * 60_000 };
    data.catch(() => {
      if (this.chineseCatalog?.data === data) this.chineseCatalog = undefined;
    });
    return data;
  }

  /**
   * 从插件配置解析维护方原始目录地址，供下载和来源说明共用。
   * @returns 当前中文目录URL。
   */
  private chineseCatalogUrl(): URL {
    return new URL(
      this.host.getConfig<string>('FF14_CHINESE_ITEM_DATA_URL') ||
        'https://raw.githubusercontent.com/thewakingsands/ffxiv-datamining-cn/master/Item.csv',
    );
  }

  /**
   * 对只读上游查询的临时连接、限流和服务错误退避重试，保留最终失败来源而不关闭TLS校验。
   * @param url - 本次配置解析出的上游地址。
   * @param method - 只读请求方法。
   * @param context - 失败时保留的市场或目录查询阶段。
   * @returns 成功解析的上游JSON数据。
   * @throws 非临时错误或三次尝试耗尽时带上来源域名和原始错误抛出。
   */
  private async requestJson<T>(
    url: URL,
    method: Ff14HttpMethod,
    context: string,
  ): Promise<T> {
    return this.retryRead(
      () =>
        this.host.requestJson<T>({
          context,
          failureMessage: (statusCode) => `${context}失败：${statusCode}`,
          invalidJsonMessage: 'FF14 接口返回不是合法 JSON',
          method,
          timeoutMessage: 'FF14 接口请求超时',
          timeoutMs: 8000,
          url,
        }),
      url,
      context,
    );
  }

  /**
   * 对幂等数据读取执行最多三次退避重试，永久错误立即返回给调用方。
   * @param read - 单次只读上游请求。
   * @param url - 错误中显示来源域名的目标地址。
   * @param context - 物品或成交查询阶段。
   * @returns 首次成功读取的结果。
   * @throws 永久错误或临时错误重试耗尽时保留原始原因抛出。
   */
  private async retryRead<T>(
    read: () => Promise<T>,
    url: URL,
    context: string,
  ): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await read();
      } catch (error) {
        let message = String(error);
        if (error instanceof Error) message = error.message;
        const transient =
          /ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|disconnected before secure TLS|fetch failed|请求超时|失败[：:]\s*(?:429|500|502|503|504)\b/iu.test(
            message,
          );
        if (!transient || attempt >= 3)
          throw new Error(
            `${context}（${url.hostname}，尝试${attempt}次）：${message}`,
          );
        await new Promise((resolve) => setTimeout(resolve, attempt * 400));
      }
    }
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
