type CutoffPoint = { ep: number; time: number };

type RegressionInput = { ep: number; percent: number };

/**
 * 在数据下载与缓存层中处理regression。
 *
 * @param data - 响应数据；承载 BangDream新增、更新、导入或执行字段。
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
 * 在数据下载与缓存层中处理预测。
 *
 * @param cutoff - cutoff 输入；使用 `length` 字段生成结果。
 * @param startTs - BangDream列表；决定 BangDream条件分支。
 * @param endTs - BangDream列表；决定 BangDream条件分支。
 * @param rate - rate 输入；影响 predict 的返回值。
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
