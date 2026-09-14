type Sale = {
  timestamp?: number;
  pricePerUnit?: number;
  quantity?: number;
  hq?: boolean;
  worldName?: string;
};

/**
 * 从真实成交记录计算销量与成交额，固定时区范围并分开标记缺失和截断数据。
 * @param item - 当前已核实的物品身份。
 * @param history - Universalis返回的物品历史，缺失时不能视为零成交。
 * @param range - 本次统计固定的起止秒数与品质条件。
 * @returns 带覆盖情况的数量、价格、成交额和按服务器汇总。
 */
export function summarizeMarketSales(
  item: { itemId: number; name: string },
  history: { entries?: Sale[]; lastUploadTime?: number } | undefined,
  range: { start: number; end: number; hq?: boolean; sourceLimit?: number },
) {
  if (!history || !Array.isArray(history.entries))
    return { ...item, status: 'unavailable' as const, complete: false };
  const raw = history.entries;
  const entries = raw.filter(
    (row) =>
      Number.isFinite(row.timestamp) &&
      row.timestamp! >= range.start &&
      row.timestamp! < range.end &&
      Number.isSafeInteger(row.quantity) &&
      row.quantity! > 0 &&
      Number.isSafeInteger(row.pricePerUnit) &&
      row.pricePerUnit! >= 0 &&
      (range.hq === undefined || row.hq === range.hq),
  );
  let quantity = 0;
  let turnover = 0;
  let minPrice: number | null = null;
  let maxPrice: number | null = null;
  const worlds = new Map<
    string,
    { world: string; transactions: number; quantity: number; turnover: number }
  >();
  for (const row of entries) {
    quantity += row.quantity!;
    const total = row.quantity! * row.pricePerUnit!;
    turnover += total;
    if (minPrice === null || row.pricePerUnit! < minPrice)
      minPrice = row.pricePerUnit!;
    if (maxPrice === null || row.pricePerUnit! > maxPrice)
      maxPrice = row.pricePerUnit!;
    const world = row.worldName || '未提供服务器';
    const aggregate = worlds.get(world) || {
      world,
      transactions: 0,
      quantity: 0,
      turnover: 0,
    };
    aggregate.transactions++;
    aggregate.quantity += row.quantity!;
    aggregate.turnover += total;
    worlds.set(world, aggregate);
  }
  let weightedAverage: number | null = null;
  if (quantity) weightedAverage = turnover / quantity;
  const invalidRecords = raw.filter(
    (row) =>
      !Number.isFinite(row.timestamp) ||
      !Number.isSafeInteger(row.quantity) ||
      row.quantity! <= 0 ||
      !Number.isSafeInteger(row.pricePerUnit) ||
      row.pricePerUnit! < 0,
  ).length;
  const sourceLimit = range.sourceLimit ?? 1000;
  const complete =
    raw.length < sourceLimit &&
    invalidRecords === 0 &&
    Number.isSafeInteger(quantity) &&
    Number.isSafeInteger(turnover);
  return {
    ...item,
    status: 'available' as const,
    transactions: entries.length,
    quantity,
    turnover,
    minPrice,
    maxPrice,
    weightedAverage,
    worlds: [...worlds.values()].sort((a, b) => b.quantity - a.quantity),
    complete,
    invalidRecords,
    sourceRecords: raw.length,
    lastUploadTime: history.lastUploadTime,
    sourceLimit,
  };
}

/**
 * 将北京时间自然日或最近天数换算为统一的秒级半开时间范围。
 * @param input - 日期或一至三十一天的窗口。
 * @returns 本次所有物品共同使用的固定时间范围。
 * @throws 日期不存在或天数超出支持范围时拒绝统计。
 */
export function marketTimeRange(input: {
  date?: string;
  days?: number | string;
}) {
  if (input.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.date))
      throw new Error('date使用北京时间YYYY-MM-DD');
    const start = Date.parse(`${input.date}T00:00:00+08:00`) / 1000;
    if (
      !Number.isFinite(start) ||
      new Date(start * 1000 + 28800000).toISOString().slice(0, 10) !==
        input.date
    )
      throw new Error('统计日期不存在');
    return { start, end: start + 86400 };
  }
  const days = Number(input.days ?? 1);
  if (!Number.isInteger(days) || days < 1 || days > 31)
    throw new Error('days只支持1至31天');
  const end = Math.floor(Date.now() / 1000);
  return { start: end - days * 86400, end };
}
