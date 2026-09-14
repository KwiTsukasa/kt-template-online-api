import { createHash, randomUUID } from 'node:crypto';
import { summarizeMarketSales } from '../../application/market-statistics';

type Row = ReturnType<typeof summarizeMarketSales>;
type Snapshot = { revision: number; value: Record<string, unknown> | null };
export type MarketScanStorage = {
  readPluginState?: () => Promise<Snapshot>;
  compareAndSwapPluginState?: (input: {
    expectedRevision: number;
    value: Record<string, unknown>;
  }) => Promise<Snapshot>;
};
type Job = {
  key: string;
  range: { start: number; end: number };
  expiresAt: number;
  owner: string;
  leaseUntil: number;
  done: number[];
  scanned: number;
  available: number;
  withSales: number;
  unavailableCount: number;
  unavailable: number[];
  incompleteCount: number;
  truncated: number[];
  leaders: Row[];
  updatedAt: string;
};
type ScanInput = {
  ids: number[];
  world: string;
  metric: string;
  range: { start: number; end: number };
  windowKey?: string;
  hq?: boolean;
  readBatch: (
    ids: number[],
    range: { start: number; end: number },
  ) => Promise<Record<string, any>>;
};

export class MarketScan {
  private memory: Snapshot = { revision: 0, value: null };
  constructor(
    private readonly storage: MarketScanStorage,
    private readonly now = Date.now,
    private readonly sliceMs = 110_000,
  ) {}

  /**
   * 按固定目录及时间窗口续查未完成批次，持久保留聚合结果而不保存原始成交流水。
   * @param input - 真实目录、地区、统计口径与受控批次读取函数。
   * @returns 扫描覆盖、最多二十个候选及续查状态；只有完成扫描才公开榜单。
   * @throws 状态版本冲突或存储写入失败时停止当前扫描，保留最后一次检查点。
   */
  async run(input: ScanInput) {
    const key = createHash('sha256')
      .update(
        JSON.stringify([
          input.world,
          input.windowKey ?? input.range,
          input.metric,
          input.hq,
          input.ids,
        ]),
      )
      .digest('hex');
    let snapshot = await this.read();
    let jobs = ((snapshot.value?.jobs || []) as Job[]).filter(
      (job) => job.expiresAt > this.now() && Boolean(job.range),
    );
    let job = jobs.find((entry) => entry.key === key);
    const count = Math.ceil(input.ids.length / 100);
    if (job?.done.length === count)
      return this.result(job, input.ids.length, true);
    if (job && job.leaseUntil > this.now())
      return this.result(job, input.ids.length, false);
    const owner = randomUUID();
    if (!job) {
      job = {
        key,
        range: input.range,
        expiresAt: this.now() + 900_000,
        owner,
        leaseUntil: 0,
        done: [],
        scanned: 0,
        available: 0,
        withSales: 0,
        unavailableCount: 0,
        unavailable: [],
        incompleteCount: 0,
        truncated: [],
        leaders: [],
        updatedAt: new Date(this.now()).toISOString(),
      };
      // 最多三个紧凑聚合任务，已完成缓存优先让位；活动租约不得被驱逐。
      jobs = jobs
        .filter((entry) => entry.leaseUntil > this.now())
        .concat(
          jobs.filter((entry) => entry.leaseUntil <= this.now()).slice(-2),
        );
      if (jobs.length >= 3)
        throw new Error('市场扫描任务繁忙，请稍后继续原查询');
      jobs.push(job);
    }
    job.owner = owner;
    job.leaseUntil = this.now() + 180_000;
    snapshot = await this.save(snapshot.revision, jobs);
    const deadline = this.now() + this.sliceMs;
    const pending = Array.from({ length: count }, (_, index) => index).filter(
      (index) => !job!.done.includes(index),
    );
    const errors: string[] = [];
    try {
      while (pending.length && this.now() < deadline) {
        const indices = pending.splice(0, 4);
        const results = await Promise.all(
          indices.map(async (index) => {
            const ids = input.ids.slice(index * 100, index * 100 + 100);
            try {
              const data = await input.readBatch(ids, job!.range);
              return {
                index,
                rows: ids.map((itemId) => {
                  let history = data.items?.[String(itemId)];
                  if (data.itemID === itemId) history = data;
                  return summarizeMarketSales(
                    { itemId, name: `物品${itemId}` },
                    history,
                    { ...job!.range, hq: input.hq, sourceLimit: 99999 },
                  );
                }),
              };
            } catch {
              errors.push(`第${index + 1}批读取失败，已保留待重试`);
              return { index, rows: null };
            }
          }),
        );
        for (const batch of results) {
          if (!batch.rows) continue;
          job.done.push(batch.index);
          job.scanned += batch.rows.length;
          for (const row of batch.rows) {
            if (!row.complete) job.incompleteCount++;
            if (row.status === 'unavailable') {
              job.unavailableCount++;
              if (job.unavailable.length < 50) job.unavailable.push(row.itemId);
              continue;
            }
            job.available++;
            if (row.sourceRecords >= 99999 && job.truncated.length < 50)
              job.truncated.push(row.itemId);
            if (!row.transactions) continue;
            job.withSales++;
            job.leaders.push({ ...row, worlds: [] });
          }
        }
        job.leaders.sort(
          (a, b) =>
            Number((b as any)[input.metric] || 0) -
              Number((a as any)[input.metric] || 0) || a.itemId - b.itemId,
        );
        job.leaders = job.leaders.slice(0, 20);
        job.updatedAt = new Date(this.now()).toISOString();
        job.leaseUntil = this.now() + 180_000;
        snapshot = await this.save(snapshot.revision, jobs);
      }
    } finally {
      job.leaseUntil = 0;
      await this.save(snapshot.revision, jobs);
    }
    return { ...this.result(job, input.ids.length, false), errors };
  }

  /**
   * 投影实际扫描覆盖，未完成时不把局部候选发布为全区排行。
   * @param job - 已保存的紧凑扫描任务。
   * @param total - 密封目录内的物品总数。
   * @param cached - 是否直接复用了已完成快照。
   * @returns 不含原始流水和租约令牌的查询结果。
   */
  private result(job: Job, total: number, cached: boolean) {
    const scanComplete = job.scanned === total;
    let rankings: Row[] = [];
    let status = 'pending';
    if (scanComplete) {
      rankings = structuredClone(job.leaders);
      status = 'complete';
    }
    return {
      status,
      scanId: job.key,
      range: job.range,
      cached,
      updatedAt: job.updatedAt,
      scanComplete,
      complete: scanComplete && job.incompleteCount === 0,
      catalogItems: total,
      scannedItems: job.scanned,
      unscannedItems: total - job.scanned,
      availableItems: job.available,
      itemsWithSales: job.withSales,
      unavailableCount: job.unavailableCount,
      unavailable: job.unavailable.map((itemId) => ({
        itemId,
        status: 'unavailable',
        complete: false,
      })),
      truncatedItems: job.truncated,
      rankings,
    };
  }

  /**
   * 读取本插件状态；无宿主存储的独立调用只保留实例内缓存。
   * @returns 带并发版本的独立快照。
   */
  private async read(): Promise<Snapshot> {
    if (this.storage.readPluginState) return this.storage.readPluginState();
    return structuredClone(this.memory);
  }

  /**
   * 条件保存扫描检查点，避免跨线程覆盖其他查询进度。
   * @param revision - 已读取状态的并发版本。
   * @param jobs - 最多三个聚合任务。
   * @returns 保存后的新版本与值。
   */
  private async save(revision: number, jobs: Job[]): Promise<Snapshot> {
    const value = { version: 1, jobs };
    if (this.storage.compareAndSwapPluginState)
      return this.storage.compareAndSwapPluginState({
        expectedRevision: revision,
        value,
      });
    this.memory = structuredClone({ revision: revision + 1, value });
    return structuredClone(this.memory);
  }
}
