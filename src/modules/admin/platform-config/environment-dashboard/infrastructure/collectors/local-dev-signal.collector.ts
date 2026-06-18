import { Injectable, Optional } from '@nestjs/common';
import { RuntimeHealthService } from '@/runtime/health/runtime-health.service';
import { unwiredEvidence } from '../environment-dashboard-evidence.mapper';
import { EnvironmentDashboardConfigService } from '../environment-dashboard-config.service';
import {
  mapSiteStatus,
  pickWorstHealthStatus,
} from '../../application/environment-dashboard-status.mapper';
import type {
  EnvironmentHealthStatus,
  EnvironmentNode,
  EnvironmentService,
  EnvironmentSignal,
  EnvironmentSite,
} from '../../domain/environment-dashboard.types';
import type { RuntimeHealthStatus } from '@/runtime/health/runtime-health.types';

export interface LocalDevSignalCollectContext {
  observedAt?: string;
}

@Injectable()
export class LocalDevSignalCollector {
  /**
   * Initializes local development signal collection.
   * @param runtimeHealthService - Runtime module health reader; absent in narrow unit tests means the API signal is unknown instead of green.
   * @param config - Environment dashboard config reader used for Admin local route evidence.
   */
  constructor(
    @Optional()
    private readonly runtimeHealthService?: RuntimeHealthService,
    @Optional()
    private readonly config: EnvironmentDashboardConfigService = new EnvironmentDashboardConfigService(),
  ) {}

  /**
   * Collects local development API/Admin service evidence for the dashboard.
   * @param context - Snapshot context from the aggregator; `observedAt` keeps evidence timestamps aligned.
   * @returns Local development site with API runtime and Admin route signals.
   */
  async collect(context: LocalDevSignalCollectContext = {}): Promise<EnvironmentSite> {
    const observedAt = context.observedAt || new Date().toISOString();
    const services = [
      this.createApiService(observedAt),
      this.createAdminService(observedAt),
    ];
    const node = this.createNode('local-dev-node', 'Local Dev Workstation', services);
    return {
      id: 'local-dev',
      label: 'Local Dev',
      nodes: [node],
      status: mapSiteStatus(services.map((service) => service.status)),
      summary: 'Local development runtime snapshot',
    };
  }

  /**
   * Builds the local API service from RuntimeHealthService output.
   * @param observedAt - Shared snapshot timestamp.
   * @returns API service with runtime health evidence.
   */
  private createApiService(observedAt: string): EnvironmentService {
    const report = this.runtimeHealthService?.getRuntimeHealth();
    const status = this.mapRuntimeStatus(report?.status);
    const signal: EnvironmentSignal = {
      evidence: [
        {
          metadata: report
            ? {
                checks: report.checks?.length || 0,
                runtimeStatus: report.status,
              }
            : undefined,
          observedAt: report?.checkedAt || observedAt,
          source: 'runtime-health',
          sourceKind: report ? 'live' : 'derived',
          summary: report
            ? `Runtime health is ${report.status}`
            : 'RuntimeHealthService 未接入当前测试上下文',
        },
      ],
      id: 'local-api-process',
      label: 'API Process',
      observedAt: report?.checkedAt || observedAt,
      sourceKind: report ? 'live' : 'derived',
      status,
      summary: report
        ? `API runtime health: ${report.status}`
        : '等待 RuntimeHealthService 提供本机进程状态',
    };
    return this.createService('local-api', 'API Runtime', [signal]);
  }

  /**
   * Builds the local Admin route signal from optional local URL configuration.
   * @param observedAt - Shared snapshot timestamp.
   * @returns Admin service with configured or unwired evidence.
   */
  private createAdminService(observedAt: string): EnvironmentService {
    const adminUrl = this.config.get('ENV_DASHBOARD_ADMIN_LOCAL_URL');
    const signal: EnvironmentSignal = adminUrl
      ? {
          evidence: [
            {
              metadata: { url: adminUrl },
              observedAt,
              source: 'Admin local URL',
              sourceKind: 'configured',
              summary: '本机 Admin 地址已配置',
            },
          ],
          id: 'local-admin-route',
          label: 'Admin Local Route',
          observedAt,
          sourceKind: 'configured',
          status: 'unknown',
          summary: 'Admin 本机地址已配置，页面连通性由浏览器 smoke 验证',
        }
      : {
          evidence: [
            unwiredEvidence('Admin local URL', ['ENV_DASHBOARD_ADMIN_LOCAL_URL']),
          ],
          id: 'local-admin-route',
          label: 'Admin Local Route',
          sourceKind: 'unwired',
          status: 'unwired',
          summary: '本机 Admin 地址未配置',
        };
    return this.createService('local-admin', 'Admin Frontend', [signal]);
  }

  /**
   * Maps runtime module health into environment dashboard signal status.
   * @param status - RuntimeHealthService status value.
   * @returns Dashboard health status preserving blocked/degraded semantics.
   */
  private mapRuntimeStatus(status?: RuntimeHealthStatus): EnvironmentHealthStatus {
    if (status === 'live' || status === 'ready') return 'ok';
    if (status === 'blocked') return 'blocked';
    if (status === 'degraded') return 'degraded';
    return 'unknown';
  }

  /**
   * Creates a service from child signals and derives aggregate status.
   * @param id - Stable service id used by topology and Admin selection.
   * @param label - Operator-facing service label.
   * @param signals - Signals supporting the service.
   * @returns Service object with worst-signal status.
   */
  private createService(
    id: string,
    label: string,
    signals: EnvironmentSignal[],
  ): EnvironmentService {
    return {
      id,
      label,
      signals,
      status: pickWorstHealthStatus(signals.map((signal) => signal.status)),
      summary: signals.map((signal) => signal.summary).join('；'),
    };
  }

  /**
   * Creates a local node and derives aggregate status from services.
   * @param id - Stable node id for topology edges.
   * @param label - Operator-facing node label.
   * @param services - Services owned by the local node.
   * @returns Node object with worst-service status.
   */
  private createNode(
    id: string,
    label: string,
    services: EnvironmentService[],
  ): EnvironmentNode {
    return {
      id,
      label,
      services,
      status: pickWorstHealthStatus(services.map((service) => service.status)),
    };
  }
}
