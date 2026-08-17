import { Injectable, Optional } from '@nestjs/common';
import { getEnvironmentDashboardActions } from './environment-dashboard-action.catalog';
import {
  countSignals,
  mapSiteStatus,
  pickWorstHealthStatus,
} from './environment-dashboard-status.mapper';
import { EnvironmentEventMaterializer } from './environment-event.materializer';
import { EnvironmentDashboardCacheService } from '../infrastructure/environment-dashboard-cache.service';
import { EnvironmentDashboardConfigService } from '../infrastructure/environment-dashboard-config.service';
import {
  errorEvidence,
  unwiredEvidence,
} from '../infrastructure/environment-dashboard-evidence.mapper';
import { LocalDevSignalCollector } from '../infrastructure/collectors/local-dev-signal.collector';
import { NasProdSignalCollector } from '../infrastructure/collectors/nas-prod-signal.collector';
import { CaddyReadonlyAdapter } from '../infrastructure/adapters/caddy-readonly.adapter';
import { MihomoReadonlyAdapter } from '../infrastructure/adapters/mihomo-readonly.adapter';
import { TencentCloudReadonlyAdapter } from '../infrastructure/adapters/tencent-cloud-readonly.adapter';
import { WireguardReadonlyAdapter } from '../infrastructure/adapters/wireguard-readonly.adapter';
import type {
  EnvironmentDashboardResponse,
  EnvironmentNode,
  EnvironmentService,
  EnvironmentSignal,
  EnvironmentSite,
  EnvironmentTopology,
} from '../domain/environment-dashboard.types';

export interface EnvironmentDashboardSnapshotOptions {
  forceRefresh?: boolean;
}

@Injectable()
export class EnvironmentDashboardService {
  constructor(
    @Optional()
    private readonly eventMaterializer: EnvironmentEventMaterializer,
    @Optional()
    private readonly cache: EnvironmentDashboardCacheService = new EnvironmentDashboardCacheService(),
    @Optional()
    private readonly localDevCollector: LocalDevSignalCollector = new LocalDevSignalCollector(),
    @Optional()
    private readonly nasProdCollector: NasProdSignalCollector = new NasProdSignalCollector(),
    @Optional()
    private readonly tencentAdapter?: TencentCloudReadonlyAdapter,
    @Optional()
    private readonly caddyAdapter?: CaddyReadonlyAdapter,
    @Optional()
    private readonly wireguardAdapter?: WireguardReadonlyAdapter,
    @Optional()
    private readonly mihomoAdapter?: MihomoReadonlyAdapter,
    @Optional()
    private readonly config: EnvironmentDashboardConfigService = new EnvironmentDashboardConfigService(),
  ) {}

  /**
   * 按`options`读取仪表盘；从 `cache.getOrCreate` 读取仪表盘。
   * @param options - 控制仪表盘筛选、缓存或输出方式的可选项；省略时默认采用 `{}`。
   * @returns 仪表盘。
   */
  async getDashboard(
    options: EnvironmentDashboardSnapshotOptions = {},
  ): Promise<EnvironmentDashboardResponse> {
    return this.cache.getOrCreate(() => this.buildDashboard(), options);
  }

  /**
   * 根据当前运行态构造仪表盘；从 `getEnvironmentDashboardActions` 读取仪表盘。
   * @returns 包含 `actions`、`events`、`generatedAt`、`refreshedAt`、`sites` 字段的仪表盘。
   */
  private async buildDashboard(): Promise<EnvironmentDashboardResponse> {
    const generatedAt = new Date().toISOString();
    const sites = await this.createSites(generatedAt);
    return {
      actions: getEnvironmentDashboardActions(),
      events: this.eventMaterializer?.getRecentEvents?.() || [],
      generatedAt,
      refreshedAt: generatedAt,
      sites,
      summary: this.createSummary(sites),
      topology: this.createTopology(sites),
    };
  }

  /**
   * 并行采集本机、NAS、腾讯云与 R4SE 环境，将四个来源组装为固定顺序的站点列表。
   * @param observedAt - 用于过期、排序或租约判定的时间基准。
   * @returns 按输入顺序得到的站点列表；没有匹配项时为空数组。
   */
  private async createSites(observedAt: string): Promise<EnvironmentSite[]> {
    return [
      await this.localDevCollector.collect({ observedAt }),
      await this.nasProdCollector.collect({ observedAt }),
      await this.createTencentCloudSite(),
      await this.createR4seSite(),
    ];
  }

  /**
   * 根据当前领域状态，汇总腾讯云 CVM、WireGuard 与代理等远程服务信号，构建腾讯云站点健康视图。
   * @returns 返回包含腾讯云远程服务信号与汇总状态的站点视图。
   */
  private async createTencentCloudSite(): Promise<EnvironmentSite> {
    const services = [
      await this.createRemoteAdapterService(
        'tencent-cvm',
        'Tencent Cloud CVM',
        'tencent-cvm',
        'Tencent Cloud CVM',
        [
          'ENV_DASHBOARD_TENCENT_SECRET_ID',
          'ENV_DASHBOARD_TENCENT_SECRET_KEY',
          'ENV_DASHBOARD_TENCENT_REGION',
          'ENV_DASHBOARD_TENCENT_INSTANCE_ID',
        ],
        this.tencentAdapter,
      ),
      await this.createRemoteAdapterService(
        'caddy-public',
        'Caddy Public Route',
        'caddy-public',
        'Caddy Public Route',
        ['ENV_DASHBOARD_CADDY_PUBLIC_URL'],
        this.caddyAdapter,
      ),
      await this.createRemoteAdapterService(
        'tencent-wireguard',
        'WireGuard',
        'tencent-wireguard',
        'Tencent WireGuard',
        ['ENV_DASHBOARD_TENCENT_WIREGUARD_HEALTH_URL'],
        this.wireguardAdapter,
      ),
    ];
    return this.createSiteFromServices(
      'tencent-cloud',
      'Tencent Cloud',
      'Tencent Cloud Node',
      services,
    );
  }

  /**
   * 根据当前运行态构造R4SE站点。
   * @returns R4SE站点。
   */
  private async createR4seSite(): Promise<EnvironmentSite> {
    const services = [
      await this.createRemoteAdapterService(
        'r4se-wireguard',
        'WireGuard',
        'r4se-wireguard',
        'r4se WireGuard',
        ['ENV_DASHBOARD_R4SE_WIREGUARD_HEALTH_URL'],
        this.wireguardAdapter,
      ),
      await this.createRemoteAdapterService(
        'r4se-mihomo',
        'Mihomo/OpenClash',
        'r4se-mihomo',
        'Mihomo/OpenClash',
        ['ENV_DASHBOARD_R4SE_MIHOMO_URL', 'ENV_DASHBOARD_R4SE_MIHOMO_SECRET'],
        this.mihomoAdapter,
      ),
    ];
    return this.createSiteFromServices('r4se', 'r4se', 'r4se Node', services);
  }

  /**
   * 根据`serviceId`、`serviceLabel`、`signalId`构造远程适配器服务；当 `missing.length > 0 || !adapter` 成立时返回 `this.createService(serviceId, serviceLabel,…`。
   * @param serviceId - 用于精确定位服务的标识。
   * @param serviceLabel - 决定远程适配器服务内容、边界或目标的 `serviceLabel` 值。
   * @param signalId - 用于精确定位signal的标识。
   * @param signalLabel - 决定远程适配器服务内容、边界或目标的 `signalLabel` 值。
   * @param requiredKeys - 决定是否启用“requiredKeys”分支的布尔选项。
   * @param adapter - 用于远程适配器服务的领域对象，包含 `inspect` 字段；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 远程适配器服务。
   */
  private async createRemoteAdapterService(
    serviceId: string,
    serviceLabel: string,
    signalId: string,
    signalLabel: string,
    requiredKeys: string[],
    adapter?: { inspect(): Promise<Partial<EnvironmentSignal>> },
  ): Promise<EnvironmentService> {
    const missing = this.config.missing(requiredKeys);
    if (missing.length > 0 || !adapter) {
      return this.createService(serviceId, serviceLabel, [
        {
          evidence: [unwiredEvidence(signalLabel, missing)],
          id: signalId,
          label: signalLabel,
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
          id: signal.id || signalId,
          label: signal.label || signalLabel,
          observedAt: signal.observedAt,
          sourceKind: signal.sourceKind || 'live',
          status: signal.status || 'unknown',
          summary: signal.summary || '只读观测已返回信号',
        },
      ]);
    } catch (error) {
      return this.createService(serviceId, serviceLabel, [
        {
          evidence: [errorEvidence(signalLabel, error)],
          id: signalId,
          label: signalLabel,
          sourceKind: 'derived',
          status: 'down',
          summary: '只读观测失败',
        },
      ]);
    }
  }

  /**
   * 把一组环境服务包装为单节点站点，并计算站点最差健康状态与信号汇总。
   * @param siteId - 用于精确定位site的标识。
   * @param siteLabel - 决定SiteServices内容、边界或目标的 `siteLabel` 值。
   * @param nodeLabel - 决定SiteServices内容、边界或目标的 `nodeLabel` 值。
   * @param services - 按原有顺序参与SiteServices筛选、合并或汇总的集合。
   * @returns 返回包含单个节点、服务列表、健康状态与信号计数的站点视图。
   */
  private createSiteFromServices(
    siteId: string,
    siteLabel: string,
    nodeLabel: string,
    services: EnvironmentService[],
  ): EnvironmentSite {
    const node = this.createNode(`${siteId}-node`, nodeLabel, services);
    return {
      id: siteId,
      label: siteLabel,
      nodes: [node],
      status: mapSiteStatus(services.map((service) => service.status)),
      summary: `${siteLabel} readonly evidence snapshot`,
    };
  }

  /**
   * 汇总节点下所有服务的最差健康状态，并保留节点标识、展示标签与服务明细。
   * @param id - 环境仪表盘节点的稳定标识。
   * @param label - 环境仪表盘展示的节点名称。
   * @param services - 用于计算节点总体健康状态的服务列表。
   * @returns 包含原服务列表及汇总健康状态的环境节点。
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

  /**
   * 以观测信号中的最差状态作为服务状态，并按顺序拼接信号摘要供仪表盘展示。
   * @param id - 环境仪表盘服务的稳定标识。
   * @param label - 环境仪表盘展示的服务名称。
   * @param signals - 用于计算服务状态和摘要的观测信号列表。
   * @returns 包含信号明细、汇总状态与合并摘要的环境服务。
   */
  private createService(
    id: string,
    label: string,
    signals: EnvironmentService['signals'],
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
   * 按健康状态汇总站点内全部信号，并计算跨状态的信号总数。
   * @param sites - 决定摘要内容、边界或目标的 `sites` 值。
   * @returns 包含 `byStatus`、`totalSignals` 字段的摘要。
   */
  private createSummary(sites: EnvironmentSite[]) {
    const byStatus = countSignals(sites);
    return {
      ...byStatus,
      byStatus,
      totalSignals: Object.values(byStatus).reduce(
        (sum, count) => sum + count,
        0,
      ),
    };
  }

  /**
   * 把站点、节点与服务展开为拓扑节点，并按父子关系生成站点到节点、节点到服务的边。
   * @param sites - 决定拓扑内容、边界或目标的 `sites` 值。
   * @returns 包含 `edges`、`nodes` 字段的拓扑。
   */
  private createTopology(sites: EnvironmentSite[]): EnvironmentTopology {
    const nodes = sites.flatMap((site) => [
      {
        id: site.id,
        label: site.label,
        siteId: site.id,
        status: site.status,
      },
      ...site.nodes.flatMap((node) => [
        {
          id: node.id,
          label: node.label,
          siteId: site.id,
          status: node.status || 'unknown',
        },
        ...node.services.map((service) => ({
          id: service.id,
          label: service.label,
          serviceId: service.id,
          siteId: site.id,
          status: service.status,
        })),
      ]),
    ]);
    const edges = sites.flatMap((site) =>
      site.nodes.flatMap((node) => [
        {
          from: site.id,
          id: `${site.id}-${node.id}`,
          label: 'contains',
          source: site.id,
          target: node.id,
          to: node.id,
        },
        ...node.services.map((service) => ({
          from: node.id,
          id: `${node.id}-${service.id}`,
          label: 'runs',
          source: node.id,
          target: service.id,
          to: service.id,
        })),
      ]),
    );
    return { edges, nodes };
  }
}
