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
 * Picks the strongest health status from service or signal statuses.
 * @param statuses - Aggregated statuses from collectors, retained events, or derived signals.
 * @returns The most severe status, defaulting to `unknown` when no evidence exists.
 */
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

/**
 * Maps nested health statuses into the site-level status used by Admin.
 * @param statuses - Service or signal statuses collected for a single site.
 * @returns Site status that preserves isolation and avoids marking missing integrations green.
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
 * Counts every signal status across all sites for dashboard summary cards.
 * @param sites - Dashboard site tree assembled by collectors and event materializers.
 * @returns Count map keyed by every supported health status.
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
 * Normalizes collector timestamps before they are persisted as evidence.
 * @param dateLike - Date, epoch milliseconds, or string timestamp from local/remote evidence.
 * @returns ISO timestamp when parseable; otherwise the current time so evidence is never blank.
 */
export function normalizeObservedAt(dateLike?: Date | number | string): string {
  if (dateLike === undefined || dateLike === null || dateLike === '') {
    return new Date().toISOString();
  }
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}
