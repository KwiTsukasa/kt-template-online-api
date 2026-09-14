import { MarketScan } from '@/modules/plugins/ff14-market/src/infrastructure/storage/market-scan';

describe('市场完整扫描检查点', () => {
  it('resumes after a slow slice and a worker restart, includes the last-item winner, and reuses the completed result', async () => {
    let now = 0;
    let snapshot: any = { revision: 0, value: null };
    const storage = {
      readPluginState: async () => structuredClone(snapshot),
      compareAndSwapPluginState: async ({ expectedRevision, value }: any) => {
        expect(expectedRevision).toBe(snapshot.revision);
        expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThan(
          48 * 1024,
        );
        snapshot = structuredClone({ revision: expectedRevision + 1, value });
        return structuredClone(snapshot);
      },
    };
    const seen: number[] = [];
    const input = {
      ids: Array.from({ length: 1001 }, (_, i) => i + 1),
      world: '测试服',
      metric: 'quantity',
      range: { start: 100, end: 200 },
      windowKey: 'days=1',
      readBatch: async (
        ids: number[],
        range: { start: number; end: number },
      ) => {
        expect(range).toEqual({ start: 100, end: 200 });
        now += 15_000;
        seen.push(...ids);
        return {
          items: Object.fromEntries(
            ids.map((id) => [
              id,
              { entries: [{ timestamp: 150, quantity: id, pricePerUnit: 2 }] },
            ]),
          ),
        };
      },
    };
    const first = await new MarketScan(storage, () => now).run(input);
    expect(first).toMatchObject({
      status: 'pending',
      scannedItems: 800,
      rankings: [],
    });
    const second = await new MarketScan(storage, () => now).run({
      ...input,
      range: { start: 200, end: 300 },
    });
    expect(second).toMatchObject({
      status: 'complete',
      scanComplete: true,
      scannedItems: 1001,
      range: { start: 100, end: 200 },
    });
    expect(second.rankings[0]).toMatchObject({ itemId: 1001, quantity: 1001 });
    expect(new Set(seen).size).toBe(1001);
    expect(seen).toHaveLength(1001);
    const third = await new MarketScan(storage, () => now).run(input);
    expect(third.cached).toBe(true);
    expect(seen).toHaveLength(1001);
  });

  it('keeps a failed batch pending and does not recount successful batches when retried', async () => {
    let fail = true;
    const scanner = new MarketScan({});
    const input = {
      ids: Array.from({ length: 201 }, (_, i) => i + 1),
      world: '测试服',
      metric: 'transactions',
      range: { start: 100, end: 200 },
      readBatch: async (ids: number[]) => {
        if (ids[0] === 101 && fail) throw new Error('network');
        return {
          items: Object.fromEntries(
            ids
              .filter((id) => id !== 2)
              .map((id) => [
                id,
                { entries: [{ timestamp: 150, quantity: 1, pricePerUnit: 2 }] },
              ]),
          ),
        };
      },
    };
    expect(await scanner.run(input)).toMatchObject({
      status: 'pending',
      scannedItems: 101,
      rankings: [],
    });
    fail = false;
    expect(await scanner.run(input)).toMatchObject({
      status: 'complete',
      scannedItems: 201,
      availableItems: 200,
      unavailableCount: 1,
      complete: false,
    });
  });
});
