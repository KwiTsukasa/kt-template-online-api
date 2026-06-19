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
  /**
   * Initializes the dashboard snapshot service.
   * @param eventMaterializer - Recent-event materializer fed by local/MQTT event sources.
   * @param cache - Short-lived dashboard cache invalidated by fresh backend events.
   * @param localDevCollector - Collector for local development API/Admin state.
   * @param nasProdCollector - Collector for NAS production internal service state.
   * @param tencentAdapter - Tencent Cloud readonly adapter for CVM evidence.
   * @param caddyAdapter - Caddy readonly adapter for public route evidence.
   * @param wireguardAdapter - WireGuard readonly adapter for Tencent/r4se reachability.
   * @param mihomoAdapter - Mihomo/OpenClash readonly adapter for r4se evidence.
   * @param config - Dashboard config reader used for explicit missing-key evidence.
   */
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
   * Builds the current environment dashboard snapshot for Admin.
   * @param options - Snapshot control from Admin refresh/self-check; self-check sets `forceRefresh`.
   * @returns Aggregate status tree, topology, readonly actions, and recent events.
   */
  async getDashboard(
    options: EnvironmentDashboardSnapshotOptions = {},
  ): Promise<EnvironmentDashboardResponse> {
    return this.cache.getOrCreate(() => this.buildDashboard(), options);
  }

  /**
   * Runs all readonly collectors and assembles the dashboard response.
   * @returns Fresh dashboard snapshot before cache decoration.
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
   * Creates the first-version site tree with explicit unwired remote evidence.
   * @param observedAt - Snapshot timestamp shared by generated signals.
   * @returns Four configured dashboard sites.
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
   * Creates Tencent Cloud site from CVM, Caddy, and WireGuard readonly evidence.
   * @returns Tencent Cloud site with missing configuration surfaced as unwired signals.
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
   * Creates r4se site from WireGuard and Mihomo/OpenClash readonly evidence.
   * @returns r4se site with missing configuration surfaced as unwired signals.
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
   * Creates one remote service from an adapter or explicit missing configuration.
   * @param serviceId - Stable service id used by topology.
   * @param serviceLabel - Operator-facing service label.
   * @param signalId - Stable signal id used by Admin selection.
   * @param signalLabel - Operator-facing signal label.
   * @param requiredKeys - Public env keys required before adapter output can be trusted.
   * @param adapter - Optional readonly adapter implementation.
   * @returns Remote service with one normalized signal.
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
   * Creates a site wrapper around a single environment node.
   * @param siteId - Stable site id used by Admin selection and SSE events.
   * @param siteLabel - Operator-facing site label.
   * @param nodeLabel - Operator-facing node label.
   * @param services - Services collected for the site.
   * @returns Site object with status derived from child services.
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
   * Creates a node and derives its status from child service status.
   * @param id - Stable node id for topology references.
   * @param label - Operator-facing node label.
   * @param services - Services owned by this node.
   * @returns Node with derived status.
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
   * Creates a service and derives its status from child signals.
   * @param id - Stable service id for topology and actions.
   * @param label - Operator-facing service label.
   * @param signals - Signals that support this service.
   * @returns Service with derived status.
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
   * Builds summary counters used by status cards.
   * @param sites - Dashboard site tree.
   * @returns Signal count summary in both compact and by-status forms.
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
   * Builds a simple topology graph from sites, nodes, and services.
   * @param sites - Dashboard site tree.
   * @returns Topology nodes and service edges for Admin rendering.
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
