type CutoffPoint = { ep: number; time: number };

type RegressionInput = { ep: number; percent: number };

/**
 * 根据`data`处理包含 `a`、`b` 字段的结果。
 * @param data - 用于包含 `a`、`b` 字段的结果的领域对象，包含 `length` 字段。
 * @returns 包含 `a`、`b` 字段的包含 `a`、`b` 字段的。
 */
function regression(data: RegressionInput[]) {
  let percentTotal = 0;
  let epTotal = 0;
  for (const item of data) {
    percentTotal += item.percent;
    epTotal += item.ep;
  }
  const averagePercent = percentTotal / data.length;
  const averageEp = epTotal / data.length;
  let covariance = 0;
  let variance = 0;
  for (const item of data) {
    covariance += (item.percent - averagePercent) * (item.ep - averageEp);
    variance +=
      (item.percent - averagePercent) * (item.percent - averagePercent);
  }
  const b = covariance / variance;
  const a = averageEp - b * averagePercent;
  return { a, b };
}

/**
 * 筛选活动中段档线样本并执行线性回归，预测结束后修正倍率对应的档线；样本不足或结果非法时回退为零。
 * @param cutoff - 用于predict的领域对象，包含 `length`、`cutoff.length - 1` 字段。
 * @param startTs - 决定predict内容、边界或目标的 `startTs` 值。
 * @param endTs - 决定predict内容、边界或目标的 `endTs` 值。
 * @param rate - 决定predict内容、边界或目标的 `rate` 值。
 * @returns 包含 `ep`、`time` 字段的predict。
 */
export function predict(
  cutoff: CutoffPoint[],
  startTs: number,
  endTs: number,
  rate: number,
) {
  if (cutoff.length <= 5) return { ep: 0 };
  const data: RegressionInput[] = [];
  for (const item of cutoff) {
    if (item.time - startTs < 43_200 || endTs - item.time < 86_400) {
      continue;
    }
    data.push({
      ep: item.ep,
      percent: (item.time - startTs) / (endTs - startTs),
    });
  }
  const { a, b } = regression(data);
  let ep = a + b * (1 + rate);
  if (Number.isNaN(ep)) ep = 0;
  return { ep, time: cutoff[cutoff.length - 1].time };
}
