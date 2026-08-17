import type {
  EnvironmentHealthStatus,
  EnvironmentSite,
  EnvironmentSiteStatus,
} from '../domain/environment-dashboard.types';

export const ENVIRONMENT_HEALTH_STATUSES: EnvironmentHealthStatus[] = [
  'ok',
  'unwired',
  'unknown',
  'degraded',
  'isolated',
  'down',
  'blocked',
];

const severityWeight: Record<EnvironmentHealthStatus, number> = {
  ok: 0,
  unwired: 1,
  unknown: 1,
  degraded: 2,
  isolated: 3,
  down: 4,
  blocked: 5,
};

/**
 * 按输入分支映射选择最差的健康状态。
 * @param statuses - 按原有顺序参与按输入分支映射选择最差的健康状态筛选、合并或汇总的集合。
 * @returns 当前状态对应的按输入分支映射选择最差的健康状态，取值为 `'unknown'`。
 */
export function pickWorstHealthStatus(
  statuses: EnvironmentHealthStatus[],
): EnvironmentHealthStatus {
  if (statuses.length <= 0) return 'unknown';
  return statuses
    .slice(1)
    .reduce<EnvironmentHealthStatus>(
      (current, next) =>
        {
          if (severityWeight[next] > severityWeight[current]) {
            return next;
          }
          return current;
        },
      statuses[0],
    );
}

/**
 * 将`statuses`转换为站点状态；当 `worst === 'degraded' || worst === 'down' || worst === 'blocke…` 成立时返回 `'degraded'`。
 * @param statuses - 按原有顺序参与站点状态筛选、合并或汇总的集合。
 * @returns 当前状态对应的站点状态，取值为 `'online'`、`'isolated'`、`'degraded'`、`'unknown'`。
 */
export function mapSiteStatus(
  statuses: EnvironmentHealthStatus[],
): EnvironmentSiteStatus {
  const worst = pickWorstHealthStatus(statuses);
  if (worst === 'ok') return 'online';
  if (worst === 'isolated') return 'isolated';
  if (worst === 'degraded' || worst === 'down' || worst === 'blocked') {
    return 'degraded';
  }
  return 'unknown';
}

/**
 * 遍历全部站点、节点与服务信号，按健康状态累计每类信号数量。
 * @param sites - 决定信号内容、边界或目标的 `sites` 值。
 * @returns 信号。
 */
export function countSignals(
  sites: EnvironmentSite[],
): Record<EnvironmentHealthStatus, number> {
  const counts = Object.fromEntries(
    ENVIRONMENT_HEALTH_STATUSES.map((status) => [status, 0]),
  ) as Record<EnvironmentHealthStatus, number>;

  sites.forEach((site) => {
    site.nodes.forEach((node) => {
      node.services.forEach((service) => {
        service.signals.forEach((signal) => {
          counts[signal.status] += 1;
        });
      });
    });
  });

  return counts;
}

/**
 * 把观测时间规范为 ISO 字符串；缺失或无效时间回退到调用方提供的当前时间。
 * @param dateLike - 决定把观测时间规范为 ISO 字符串内容、边界或目标的 `dateLike` 值；为空时采用 `dateLike === ''` 作为兜底。
 * @returns 返回有效观测时间的 ISO 字符串；输入缺失或非法时返回当前时间的 ISO 字符串。
 */
export function normalizeObservedAt(dateLike?: Date | number | string): string {
  if (dateLike === undefined || dateLike === null || dateLike === '') {
    return new Date().toISOString();
  }
  const date = (() => {
    if (dateLike instanceof Date) {
      return dateLike;
    }
    return new Date(dateLike);
  })();
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}
