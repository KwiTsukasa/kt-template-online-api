import { createServer } from 'node:http';
import { once } from 'node:events';
import {
  marketTimeRange,
  summarizeMarketSales,
} from '@/modules/plugins/ff14-market/src/application/market-statistics';
import { Ff14MarketClient } from '@/modules/plugins/ff14-market/src/infrastructure/integration/ff14-market-client';
import { Ff14MarketApplication } from '@/modules/plugins/ff14-market/src/application/ff14-market-application';
import { createFf14MarketPriceOperation } from '@/modules/plugins/ff14-market/src/operations/market-price';
import { buildFf14MarketCatalog } from '@/modules/plugins/ff14-market/src/domain/ff14-worlds';
import { parseChineseItemCatalog } from '@/modules/plugins/ff14-market/src/infrastructure/integration/chinese-item-catalog';

describe('FF14 候选与真实成交聚合', () => {
  it('parses current Chinese data without splitting quoted multiline descriptions or escaped quotes', () => {
    const csv =
      'key,0,1,2,3\r\n#,Description,Name,IsUntradable,Level{Item}\r\nint32,str,str,bool,int\r\n42,"第一行,描述\n第二行""引号""","发型样式：测试波波头",False,1\r\n43,"描述","不可交易物品",True,2';
    expect([...parseChineseItemCatalog(csv).values()]).toMatchObject([
      {
        row_id: 42,
        fields: {
          Name: '发型样式：测试波波头',
          IsUntradable: false,
          LevelItem: 1,
        },
      },
      { row_id: 43, fields: { Name: '不可交易物品', IsUntradable: true } },
    ]);
    expect(() => parseChineseItemCatalog('invalid')).toThrow('缺少');
    expect(() => parseChineseItemCatalog(csv + ',"')).toThrow('引号');
  });

  it('falls back to current provider data for missing names, caches the directory, and keeps explicit world parameters', async () => {
    const requestBuffer = jest
      .fn()
      .mockResolvedValue(
        Buffer.from(
          '#,Name,IsUntradable,Level{Item}\n42,"发型样式：测试波波头",False,1\n',
        ),
      );
    const urls: URL[] = [];
    const client = new Ff14MarketClient({
      getConfig: () => undefined,
      getDictItemsByKey: async () => [],
      relationTree: async () => [],
      requestBuffer,
      requestJson: async ({ url }) => {
        urls.push(url);
        if (url.pathname.endsWith('/search')) return { results: [] } as never;
        return {
          listings: [{ pricePerUnit: 100, quantity: 1 }],
          minPrice: 100,
        } as never;
      },
    });
    const operation = createFf14MarketPriceOperation(
      new Ff14MarketApplication(client),
    );
    const first: any = await operation.execute({
      raw: '波波头',
      world: '指定服务器',
    });
    const second: any = await operation.execute({
      raw: '发型样式：测试波波头',
      world: '指定服务器',
    });
    expect(first.item).toMatchObject({ itemId: 42, isUntradable: false });
    expect(second.minPrice).toBe(100);
    const byId: any = await operation.execute({
      raw: '42',
      world: '指定服务器',
    });
    expect(byId.item).toMatchObject({
      itemId: 42,
      name: '发型样式：测试波波头',
      isUntradable: false,
    });
    expect(first.source).toContain(encodeURIComponent('指定服务器') + '/42');
    expect(requestBuffer).toHaveBeenCalledTimes(1);
    expect(urls.every((url) => url.hostname !== 'v2.xivapi.com')).toBe(true);
  });
  it('uses Beijing natural-day bounds and rejects impossible dates or zero days', () => {
    expect(marketTimeRange({ date: '2026-09-13' })).toEqual({
      start: Date.parse('2026-09-13T00:00:00+08:00') / 1000,
      end: Date.parse('2026-09-14T00:00:00+08:00') / 1000,
    });
    expect(() => marketTimeRange({ date: '2026-02-30' })).toThrow('不存在');
    expect(() => marketTimeRange({ days: 0 })).toThrow('1至31');
  });
  it('calculates quantity-weighted prices and distinguishes missing, malformed and truncated history', () => {
    const item = { itemId: 1, name: '样本' };
    const range = { start: 100, end: 200 };
    const rows = [
      { timestamp: 100, pricePerUnit: 10, quantity: 2 },
      { timestamp: 150, pricePerUnit: 20, quantity: 1 },
      { timestamp: 200, pricePerUnit: 999, quantity: 100 },
    ];
    expect(summarizeMarketSales(item, { entries: rows }, range)).toMatchObject({
      quantity: 3,
      turnover: 40,
      transactions: 2,
      weightedAverage: 40 / 3,
      complete: true,
    });
    expect(summarizeMarketSales(item, undefined, range)).toMatchObject({
      status: 'unavailable',
      complete: false,
    });
    expect(summarizeMarketSales(item, { entries: [] }, range)).toMatchObject({
      status: 'available',
      quantity: 0,
    });
    expect(
      summarizeMarketSales(
        item,
        {
          entries: [
            rows[0],
            { timestamp: 101, quantity: -1, pricePerUnit: 10 },
          ],
        },
        range,
      ),
    ).toMatchObject({ invalidRecords: 1, complete: false });
    expect(
      summarizeMarketSales(item, { entries: Array(1000).fill(rows[0]) }, range)
        .complete,
    ).toBe(false);
  });
  it('queries candidates and batches history through real local HTTP with one fixed statistical window', async () => {
    const urls: URL[] = [];
    const range = marketTimeRange({ date: '2026-09-13' });
    const server = createServer((req, res) => {
      const url = new URL(req.url!, 'http://fixture');
      urls.push(url);
      res.setHeader('Content-Type', 'application/json');
      if (url.pathname.endsWith('/search')) {
        res.end(
          JSON.stringify({
            version: 'cn-version',
            results: [
              {
                row_id: 1,
                fields: { Name: '发型样式：短发', IsUntradable: false },
              },
              {
                row_id: 2,
                fields: { Name: '发型样式：长发', IsUntradable: false },
              },
              {
                row_id: 3,
                fields: { Name: '发型样式：任务奖励', IsUntradable: true },
              },
            ],
          }),
        );
      } else
        res.end(
          JSON.stringify({
            items: {
              '1': {
                entries: [
                  { timestamp: range.start + 1, quantity: 3, pricePerUnit: 20 },
                ],
                lastUploadTime: range.end * 1000,
              },
            },
            unresolvedItems: [2],
          }),
        );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const base = `http://127.0.0.1:${(server.address() as any).port}`;
      const client = new Ff14MarketClient({
        getConfig: () => base as never,
        getDictItemsByKey: async () => [],
        relationTree: async () => [],
        requestJson: async ({ url }) => {
          const response = await fetch(url);
          return response.json();
        },
      });
      jest.spyOn(client, 'getMarketCatalog').mockResolvedValue(
        buildFf14MarketCatalog({
          regions: [{ label: '中国', value: '中国' }],
          dataCenters: [],
          worlds: [],
        }),
      );
      const operation = createFf14MarketPriceOperation(
        new Ff14MarketApplication(client),
      );
      const result: any = await operation.execute({
        raw: 'mode=stats category=发型样式 date=2026-09-13 region=中国 metric=quantity',
      });
      expect(result).toMatchObject({
        complete: false,
        rankings: [{ itemId: 1, quantity: 3, turnover: 60 }],
        unavailable: [{ itemId: 2 }],
        range,
      });
      expect(urls[0].searchParams.get('query')).toBe('+Name~"发型样式"');
      expect(urls[1].pathname).toContain('/1,2');
      expect(urls[1].searchParams.get('entriesUntil')).toBe(
        String(range.end - 1),
      );
      expect(urls[1].searchParams.get('entriesWithin')).toBe('86399');
      expect(urls[1].searchParams.get('entriesToReturn')).toBe('99999');
      await client.findItems({ item: '发型样式:短发', searchCategory: '其他' });
      expect(urls[2].searchParams.get('query')).toBe(
        '+Name~"发型样式：短发" +ItemSearchCategory.Name="其他"',
      );
      const count = urls.length;
      await expect(
        client.getStatistics({ items: '1,2', metric: 'invented' }),
      ).rejects.toThrow('metric');
      expect(urls).toHaveLength(count);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('scans every marketable ID and ranks more than one batch through real HTTP', async () => {
    const range = marketTimeRange({ date: '2026-09-13' });
    const scanned: number[] = [];
    const server = createServer((req, res) => {
      const url = new URL(req.url!, 'http://fixture');
      res.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/marketable') {
        res.end(JSON.stringify(Array.from({ length: 205 }, (_, i) => i + 1)));
      } else if (url.pathname === '/sheet/Item') {
        res.end(
          JSON.stringify({
            rows: url.searchParams
              .get('rows')!
              .split(',')
              .map(Number)
              .map((id) => ({ row_id: id, fields: { Name: `实际名称${id}` } })),
          }),
        );
      } else {
        const ids = url.pathname.split('/').at(-1)!.split(',').map(Number);
        scanned.push(...ids);
        expect(ids.length).toBeLessThanOrEqual(100);
        res.end(
          JSON.stringify({
            items: Object.fromEntries(
              ids
                .filter((id) => id !== 3)
                .map((id) => [
                  id,
                  {
                    entries: [
                      {
                        timestamp: range.start,
                        quantity: id,
                        pricePerUnit: 10,
                      },
                    ],
                  },
                ]),
            ),
          }),
        );
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const base = `http://127.0.0.1:${(server.address() as any).port}`;
      const client = new Ff14MarketClient({
        getConfig: () => base as never,
        getDictItemsByKey: async () => [],
        relationTree: async () => [],
        requestJson: async ({ url }) => (await fetch(url)).json(),
      });
      const result: any = await client.getStatistics({
        date: '2026-09-13',
        metric: 'quantity',
        world: '测试地区',
      });
      expect(scanned.sort((a, b) => a - b)).toEqual(
        Array.from({ length: 205 }, (_, i) => i + 1),
      );
      expect(result).toMatchObject({
        allMarket: true,
        scanComplete: true,
        scannedItems: 205,
        availableItems: 204,
        complete: false,
        unavailable: [{ itemId: 3 }],
      });
      expect(result.rankings).toHaveLength(20);
      expect(result.rankings[0]).toMatchObject({
        itemId: 205,
        name: '实际名称205',
        quantity: 205,
        turnover: 2050,
      });
      expect(result.rankings[19].itemId).toBe(186);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('finishes Chinese nickname search without consulting a failing English host and retries transient TLS once', async () => {
    const queries: URL[] = [];
    let attempts = 0;
    const client = new Ff14MarketClient({
      getConfig: () => undefined,
      getDictItemsByKey: async () => [],
      relationTree: async () => [],
      requestJson: async ({ url }) => {
        queries.push(url);
        if (++attempts === 1)
          throw new Error(
            'Client network socket disconnected before secure TLS connection was established',
          );
        if (url.hostname === 'v2.xivapi.com')
          throw new Error('unexpected English request');
        if (url.searchParams.get('query')?.includes('~'))
          return {
            results: [{ row_id: 42, fields: { Name: '发型样式：测试波波头' } }],
          } as never;
        return { results: [] } as never;
      },
    });
    expect(await client.resolveItem({ item: '波波头' })).toMatchObject({
      itemId: 42,
      name: '发型样式：测试波波头',
    });
    expect(queries).toHaveLength(3);
    expect(
      queries.every((url) => url.hostname === 'xivapi-v2.xivcdn.com'),
    ).toBe(true);
  });

  it('does not retry permanent HTTP errors or conceal exhausted transient failures', async () => {
    const requestJson = jest
      .fn()
      .mockRejectedValue(new Error('XIVAPI 物品解析失败：404'));
    const client = new Ff14MarketClient({
      getConfig: () => undefined,
      getDictItemsByKey: async () => [],
      relationTree: async () => [],
      requestJson,
    });
    await expect(client.resolveItem({ item: '测试' })).rejects.toThrow(
      'xivapi-v2.xivcdn.com，尝试1次',
    );
    expect(requestJson).toHaveBeenCalledTimes(1);
    requestJson.mockClear().mockRejectedValue(new Error('ECONNRESET'));
    await expect(client.resolveItem({ item: '测试' })).rejects.toThrow(
      '尝试3次',
    );
    expect(requestJson).toHaveBeenCalledTimes(3);
  });
});
