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

describe('FF14 候选与真实成交聚合', () => {
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
      expect(urls[1].searchParams.get('entriesUntil')).toBe(String(range.end));
      expect(urls[1].searchParams.get('entriesWithin')).toBe('86400');
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
});
