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
      ((() => {
        if (Number.isFinite(envTtlMs) && envTtlMs > 0) {
          return envTtlMs;
        }
        return 15_000;
      })());
  }

  /**
   * 按`factory`、`options`读取或创建；当 `!options.forceRefresh && this.cached && this.cached.expiresAt…` 成立时返回 `this.toCachedSnapshot(this.cached.snapshot,…`。
   * @param factory - 负责完成或创建外部交互的受控能力。
   * @param options - 控制或创建筛选、缓存或输出方式的可选项，包含 `forceRefresh` 字段；省略时默认采用 `{}`。
   * @returns 或创建。
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
   * 使失效环境仪表盘缓存记录，并会更新 `this.cached`。
   */
  invalidate(): void {
    this.cached = undefined;
  }

  /**
   * 根据`snapshot`处理克隆快照。
   * @param snapshot - 决定克隆快照内容、边界或目标的 `snapshot` 值。
   * @returns 克隆快照。
   */
  private cloneSnapshot(
    snapshot: EnvironmentDashboardResponse,
  ): EnvironmentDashboardResponse {
    return JSON.parse(JSON.stringify(snapshot)) as EnvironmentDashboardResponse;
  }

  /**
   * 将输入收敛并投影为已缓存的快照。
   * @param snapshot - 决定已缓存的快照内容、边界或目标的 `snapshot` 值。
   * @param expiresAtMs - 用于已缓存的快照超时、有效期或退避计算的毫秒数。
   * @returns 已缓存的快照。
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
   * 将输入收敛并投影为已缓存的信号。
   * @param signal - 用于已缓存的信号的领域对象，包含 `sourceKind`、`evidence`、`label`、`summary` 字段。
   * @param observedAt - 用于过期、排序或租约判定的时间基准。
   * @param expiresAt - 用于过期、排序或租约判定的时间基准。
   * @returns 包含 `evidence`、`observedAt`、`sourceKind` 字段的已缓存的信号。
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
