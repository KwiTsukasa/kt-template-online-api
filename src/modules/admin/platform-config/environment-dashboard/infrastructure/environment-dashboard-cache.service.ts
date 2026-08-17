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

  constructor(@Optional() options: EnvironmentDashboardCacheOptions = {}) {
    const envTtlMs = Number(process.env.ENV_DASHBOARD_CACHE_TTL_MS);
    this.ttlMs =
      options.ttlMs ??
      (Number.isFinite(envTtlMs) && envTtlMs > 0 ? envTtlMs : 15_000);
  }

  /** 读取或创建。 */
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

  /** 使失效环境仪表盘缓存记录。 */
  invalidate(): void {
    this.cached = undefined;
  }

  /** 克隆快照。 */
  private cloneSnapshot(
    snapshot: EnvironmentDashboardResponse,
  ): EnvironmentDashboardResponse {
    return JSON.parse(JSON.stringify(snapshot)) as EnvironmentDashboardResponse;
  }

  /** 返回到已缓存的快照。 */
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

  /** 返回到已缓存的信号。 */
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
