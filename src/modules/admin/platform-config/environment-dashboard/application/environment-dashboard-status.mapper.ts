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

export function pickWorstHealthStatus(
  statuses: EnvironmentHealthStatus[],
): EnvironmentHealthStatus {
  if (statuses.length <= 0) return 'unknown';
  return statuses
    .slice(1)
    .reduce<EnvironmentHealthStatus>(
      (current, next) =>
        severityWeight[next] > severityWeight[current] ? next : current,
      statuses[0],
    );
}

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

export function normalizeObservedAt(dateLike?: Date | number | string): string {
  if (dateLike === undefined || dateLike === null || dateLike === '') {
    return new Date().toISOString();
  }
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}
