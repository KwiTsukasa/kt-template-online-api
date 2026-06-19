import { Injectable, Optional } from '@nestjs/common';
import { cachedEvidence } from './environment-dashboard-evidence.mapper';
import type {
  EnvironmentDashboardResponse,
  EnvironmentEvidence,
  EnvironmentSignal,
  EnvironmentSignalSourceKind,
} from '../domain/environment-dashboard.types';

export interface EnvironmentDashboardCacheOptions {
  ttlMs?: number;
}

@Injectable()
export class EnvironmentDashboardCacheService {
  private cached?: {
    expiresAt: number;
    snapshot: EnvironmentDashboardResponse;
  };

  private readonly ttlMs: number;

  /**
   * Initializes the short-lived dashboard cache used between event-driven invalidations.
   * @param options - Runtime/test cache options; `ttlMs` defaults from env and bounds how long successful snapshots can be reused.
   */
  constructor(@Optional() options: EnvironmentDashboardCacheOptions = {}) {
    const envTtlMs = Number(process.env.ENV_DASHBOARD_CACHE_TTL_MS);
    this.ttlMs =
      options.ttlMs ??
      (Number.isFinite(envTtlMs) && envTtlMs > 0 ? envTtlMs : 15_000);
  }

  /**
   * Returns a fresh dashboard snapshot or a cached successful one when it is still valid.
   * @param factory - Collector aggregation callback that may perform readonly probes and can throw on unexpected infrastructure failures.
   * @param options - Per-call control; `forceRefresh` is used by self-check to bypass cached state.
   * @returns Dashboard snapshot, with reused non-unwired signals marked as cached evidence.
   */
  async getOrCreate(
    factory: () => Promise<EnvironmentDashboardResponse>,
    options: { forceRefresh?: boolean } = {},
  ): Promise<EnvironmentDashboardResponse> {
    const now = Date.now();
    if (
      !options.forceRefresh &&
      this.cached &&
      this.cached.expiresAt > now
    ) {
      return this.toCachedSnapshot(this.cached.snapshot, this.cached.expiresAt);
    }

    const snapshot = await factory();
    this.cached = {
      expiresAt: Date.now() + this.ttlMs,
      snapshot: this.cloneSnapshot(snapshot),
    };
    return snapshot;
  }

  /**
   * Clears cached state after a fresh local/MQTT signal event invalidates the aggregate snapshot.
   */
  invalidate(): void {
    this.cached = undefined;
  }

  /**
   * Clones a snapshot before storing or returning it so callers cannot mutate cache state.
   * @param snapshot - Dashboard response produced by collectors.
   * @returns Deep cloned dashboard response.
   */
  private cloneSnapshot(
    snapshot: EnvironmentDashboardResponse,
  ): EnvironmentDashboardResponse {
    return JSON.parse(JSON.stringify(snapshot)) as EnvironmentDashboardResponse;
  }

  /**
   * Converts a valid cached snapshot into operator-visible cached evidence.
   * @param snapshot - Previously successful dashboard response.
   * @param expiresAtMs - Cache expiry timestamp used for evidence expiry metadata.
   * @returns Cloned response with non-unwired live/configured/derived/external-link signals marked cached.
   */
  private toCachedSnapshot(
    snapshot: EnvironmentDashboardResponse,
    expiresAtMs: number,
  ): EnvironmentDashboardResponse {
    const cachedAt = new Date().toISOString();
    const expiresAt = new Date(expiresAtMs).toISOString();
    const cloned = this.cloneSnapshot(snapshot);
    cloned.sites = cloned.sites.map((site) => ({
      ...site,
      nodes: site.nodes.map((node) => ({
        ...node,
        services: node.services.map((service) => ({
          ...service,
          signals: service.signals.map((signal) =>
            this.toCachedSignal(signal, cachedAt, expiresAt),
          ),
        })),
      })),
    }));
    return cloned;
  }

  /**
   * Marks one reusable signal as cached while preserving explicit missing-integration evidence.
   * @param signal - Signal from the last successful snapshot.
   * @param observedAt - Time when the cached value is returned to Admin.
   * @param expiresAt - Cache expiry ISO timestamp exposed as evidence metadata.
   * @returns Cached signal clone.
   */
  private toCachedSignal(
    signal: EnvironmentSignal,
    observedAt: string,
    expiresAt: string,
  ): EnvironmentSignal {
    if (signal.sourceKind === 'unwired') return signal;
    const sourceKind: EnvironmentSignalSourceKind = 'cached';
    const evidence: EnvironmentEvidence[] = [
      ...signal.evidence,
      cachedEvidence(signal.label, signal.summary, observedAt, expiresAt),
    ];
    return {
      ...signal,
      evidence,
      observedAt: signal.observedAt || observedAt,
      sourceKind,
    };
  }
}
