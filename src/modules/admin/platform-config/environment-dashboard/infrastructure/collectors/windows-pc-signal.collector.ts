import { Injectable, Optional } from '@nestjs/common';
import {
  errorEvidence,
  unwiredEvidence,
} from '../environment-dashboard-evidence.mapper';
import { EnvironmentDashboardConfigService } from '../environment-dashboard-config.service';
import { CodexAppServerReadonlyAdapter } from '../adapters/codex-app-server-readonly.adapter';
import { SunshineReadonlyAdapter } from '../adapters/sunshine-readonly.adapter';
import {
  mapSiteStatus,
  pickWorstHealthStatus,
} from '../../application/environment-dashboard-status.mapper';
import type {
  EnvironmentNode,
  EnvironmentService,
  EnvironmentSignal,
  EnvironmentSite,
} from '../../domain/environment-dashboard.types';

export interface WindowsPcSignalCollectContext {
  observedAt?: string;
}

@Injectable()
export class WindowsPcSignalCollector {
  constructor(
    @Optional()
    private readonly config: EnvironmentDashboardConfigService = new EnvironmentDashboardConfigService(),
    @Optional()
    private readonly sunshineAdapter?: SunshineReadonlyAdapter,
    @Optional()
    private readonly codexAppServerAdapter?: CodexAppServerReadonlyAdapter,
  ) {}

  /**
   * 并行采集 Windows PC 上 Sunshine 与 Codex App Server 的固定只读信号。
   * @param context - 提供本轮站点快照的统一观测时间。
   * @returns 只包含两个已批准 Windows 服务的单节点站点。
   */
  async collect(
    context: WindowsPcSignalCollectContext = {},
  ): Promise<EnvironmentSite> {
    const observedAt = context.observedAt || new Date().toISOString();
    const services = await Promise.all([
      this.createAdapterService(
        'sunshine',
        'Sunshine',
        'sunshine-api',
        'Sunshine API',
        [
          'ENV_DASHBOARD_SUNSHINE_URL',
          'ENV_DASHBOARD_SUNSHINE_USERNAME',
          'ENV_DASHBOARD_SUNSHINE_PASSWORD',
        ],
        this.sunshineAdapter,
      ),
      this.createAdapterService(
        'codex-app-server',
        'Codex App Server',
        'codex-app-server-ready',
        'Codex App Server',
        ['ENV_DASHBOARD_CODEX_APP_SERVER_URL'],
        this.codexAppServerAdapter,
      ),
    ]);
    const node = this.createNode('windows-pc-node', 'Windows PC', services);
    return {
      id: 'windows-pc',
      label: 'Windows PC',
      nodes: [node],
      status: mapSiteStatus(services.map((service) => service.status)),
      summary: `Windows PC 只读快照 ${observedAt}`,
    };
  }

  /**
   * 把一个固定只读适配器包装为环境服务，缺配置和调用失败均保留真实状态。
   * @param serviceId - 服务稳定标识。
   * @param serviceLabel - 服务展示名称。
   * @param fallbackSignalId - 适配器缺失时使用的信号标识。
   * @param fallbackSignalLabel - 适配器缺失时使用的信号名称。
   * @param requiredKeys - 启用该适配器所需的全部私有配置键。
   * @param adapter - 只允许返回环境信号的固定适配器。
   * @returns 包含唯一只读信号的 Windows 服务。
   */
  private async createAdapterService(
    serviceId: string,
    serviceLabel: string,
    fallbackSignalId: string,
    fallbackSignalLabel: string,
    requiredKeys: string[],
    adapter?: { inspect(): Promise<Partial<EnvironmentSignal>> },
  ): Promise<EnvironmentService> {
    const missing = this.config.missing(requiredKeys);
    if (missing.length > 0 || !adapter) {
      return this.createService(serviceId, serviceLabel, [
        {
          evidence: [unwiredEvidence(fallbackSignalLabel, missing)],
          id: fallbackSignalId,
          label: fallbackSignalLabel,
          sourceKind: 'unwired',
          status: 'unwired',
          summary: '只读观测配置未接入',
        },
      ]);
    }
    try {
      const signal = await adapter.inspect();
      return this.createService(serviceId, serviceLabel, [
        {
          evidence: signal.evidence || [],
          id: signal.id || fallbackSignalId,
          label: signal.label || fallbackSignalLabel,
          observedAt: signal.observedAt,
          sourceKind: signal.sourceKind || 'live',
          status: signal.status || 'unknown',
          summary: signal.summary || '只读观测已返回信号',
        },
      ]);
    } catch (error) {
      return this.createService(serviceId, serviceLabel, [
        {
          evidence: [errorEvidence(fallbackSignalLabel, error)],
          id: fallbackSignalId,
          label: fallbackSignalLabel,
          sourceKind: 'derived',
          status: 'down',
          summary: '只读观测失败',
        },
      ]);
    }
  }

  /**
   * 把每个 Windows 产品服务限制为一个固定探针，并用该探针状态直接决定列表语义。
   * @param id - 服务稳定标识。
   * @param label - 服务展示名称。
   * @param signals - 当前服务的只读信号。
   * @returns 可直接进入站点拓扑的环境服务。
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
   * 汇总 Windows PC 下两个固定服务并保留其原始信号。
   * @param id - 节点稳定标识。
   * @param label - 节点展示名称。
   * @param services - Windows PC 的固定服务列表。
   * @returns 具有汇总状态的 Windows PC 节点。
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
