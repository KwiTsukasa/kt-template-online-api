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
  constructor(
    @Optional()
    private readonly runtimeHealthService?: RuntimeHealthService,
    @Optional()
    private readonly config: EnvironmentDashboardConfigService = new EnvironmentDashboardConfigService(),
  ) {}

  /**
   * 根据`context`处理本地开发环境信号采集器记录。
   * @param context - 用于本地开发环境信号采集器记录的领域对象，包含 `observedAt` 字段；省略时默认采用 `{}`。
   * @returns 包含 `id`、`label`、`nodes`、`status`、`summary` 字段的本地开发环境信号采集器记录。
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
   * 根据`observedAt`构造API服务；从 `runtimeHealthService.getRuntimeHealth` 读取API服务。
   * @param observedAt - 用于过期、排序或租约判定的时间基准。
   * @returns API服务。
   */
  private createApiService(observedAt: string): EnvironmentService {
    const report = this.runtimeHealthService?.getRuntimeHealth();
    const status = this.mapRuntimeStatus(report?.status);
    const signal: EnvironmentSignal = {
      evidence: [
        {
          metadata: (() => {
            if (report) {
              return {
                checks: report.checks?.length || 0,
                runtimeStatus: report.status,
              };
            }
            return undefined;
          })(),
          observedAt: report?.checkedAt || observedAt,
          source: 'runtime-health',
          sourceKind: (() => {
            if (report) {
              return 'live';
            }
            return 'derived';
          })(),
          summary: (() => {
            if (report) {
              return `Runtime health is ${report.status}`;
            }
            return 'RuntimeHealthService 未接入当前测试上下文';
          })(),
        },
      ],
      id: 'local-api-process',
      label: 'API Process',
      observedAt: report?.checkedAt || observedAt,
      sourceKind: (() => {
        if (report) {
          return 'live';
        }
        return 'derived';
      })(),
      status,
      summary: (() => {
        if (report) {
          return `API runtime health: ${report.status}`;
        }
        return '等待 RuntimeHealthService 提供本机进程状态';
      })(),
    };
    return this.createService('local-api', 'API Runtime', [signal]);
  }

  /**
   * 根据`observedAt`构造管理端服务；从 `config.get` 读取管理端服务。
   * @param observedAt - 用于过期、排序或租约判定的时间基准。
   * @returns 管理端服务。
   */
  private createAdminService(observedAt: string): EnvironmentService {
    const adminUrl = this.config.get('ENV_DASHBOARD_ADMIN_LOCAL_URL');
    const signal: EnvironmentSignal = (() => {
      if (adminUrl) {
        return {
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
        };
      }
      return {
          evidence: [
            unwiredEvidence('Admin local URL', ['ENV_DASHBOARD_ADMIN_LOCAL_URL']),
          ],
          id: 'local-admin-route',
          label: 'Admin Local Route',
          sourceKind: 'unwired',
          status: 'unwired',
          summary: '本机 Admin 地址未配置',
        };
    })();
    return this.createService('local-admin', 'Admin Frontend', [signal]);
  }

  /**
   * 将`status`转换为运行态状态。
   * @param status - 决定运行态状态内容、边界或目标的 `status` 值；为空时采用 `status === 'ready'` 作为兜底。
   * @returns 当前状态对应的运行态状态，取值为 `'ok'`、`'blocked'`、`'degraded'`、`'unknown'`。
   */
  private mapRuntimeStatus(status?: RuntimeHealthStatus): EnvironmentHealthStatus {
    if (status === 'live' || status === 'ready') return 'ok';
    if (status === 'blocked') return 'blocked';
    if (status === 'degraded') return 'degraded';
    return 'unknown';
  }

  /**
   * 以本地观测信号中的最差状态作为服务状态，并按顺序拼接信号摘要。
   * @param id - 本地环境服务的稳定标识。
   * @param label - 本地环境仪表盘展示的服务名称。
   * @param signals - 用于计算服务状态和摘要的本地观测信号列表。
   * @returns 包含信号明细、汇总状态与合并摘要的本地环境服务。
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
   * 汇总本地节点下所有服务的最差健康状态，并保留服务明细供仪表盘展开。
   * @param id - 本地环境节点的稳定标识。
   * @param label - 本地环境仪表盘展示的节点名称。
   * @param services - 用于计算节点总体健康状态的本地服务列表。
   * @returns 包含原服务列表及汇总健康状态的本地环境节点。
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
