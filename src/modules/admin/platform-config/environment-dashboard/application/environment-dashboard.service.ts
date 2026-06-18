import { Injectable } from '@nestjs/common';
import { getEnvironmentDashboardActions } from './environment-dashboard-action.catalog';
import {
  countSignals,
  mapSiteStatus,
  pickWorstHealthStatus,
} from './environment-dashboard-status.mapper';
import { EnvironmentEventMaterializer } from './environment-event.materializer';
import { unwiredEvidence } from '../infrastructure/environment-dashboard-evidence.mapper';
import type {
  EnvironmentDashboardResponse,
  EnvironmentHealthStatus,
  EnvironmentNode,
  EnvironmentService,
  EnvironmentSite,
  EnvironmentTopology,
} from '../domain/environment-dashboard.types';

@Injectable()
export class EnvironmentDashboardService {
  /**
   * Initializes the dashboard snapshot service.
   * @param eventMaterializer - Recent-event materializer fed by local/MQTT event sources.
   */
  constructor(
    private readonly eventMaterializer: EnvironmentEventMaterializer,
  ) {}

  /**
   * Builds the current environment dashboard snapshot for Admin.
   * @returns Aggregate status tree, topology, readonly actions, and recent events.
   */
  async getDashboard(): Promise<EnvironmentDashboardResponse> {
    const generatedAt = new Date().toISOString();
    const sites = this.createSites(generatedAt);
    return {
      actions: getEnvironmentDashboardActions(),
      events: this.eventMaterializer.getRecentEvents(),
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
  private createSites(observedAt: string): EnvironmentSite[] {
    return [
      {
        id: 'local-dev',
        label: 'Local Dev',
        nodes: [
          this.createNode('local-dev-api', 'Local API', [
            this.createService('local-api', 'API Runtime', [
              {
                evidence: [
                  {
                    observedAt,
                    source: 'runtime',
                    sourceKind: 'live',
                    summary: 'NestJS process answered dashboard request',
                  },
                ],
                id: 'local-api-process',
                label: 'API Process',
                observedAt,
                sourceKind: 'live',
                status: 'ok',
                summary: 'API process is reachable',
              },
            ]),
          ]),
        ],
        status: 'online',
        summary: 'Local development runtime snapshot',
      },
      this.createSiteWithUnwiredSignals('nas-prod', 'NAS Production', [
        ['jenkins-build', 'Jenkins Build', ['ENV_DASHBOARD_JENKINS_URL']],
        ['k8s-deployment', 'K8s Deployment', ['ENV_DASHBOARD_K8S_API_SERVER']],
        ['qqbot-runtime', 'QQBot/NapCat', []],
        ['plugin-tasks', 'Plugin Tasks', []],
      ]),
      this.createSiteWithUnwiredSignals('tencent-cloud', 'Tencent Cloud', [
        ['tencent-cvm', 'Tencent CVM', ['ENV_DASHBOARD_TENCENT_SECRET_ID']],
        [
          'caddy-public',
          'Caddy Public Route',
          ['ENV_DASHBOARD_CADDY_PUBLIC_URL'],
        ],
        [
          'tencent-wireguard',
          'WireGuard',
          ['ENV_DASHBOARD_TENCENT_WIREGUARD_HEALTH_URL'],
        ],
      ]),
      this.createSiteWithUnwiredSignals('r4se', 'r4se', [
        [
          'r4se-wireguard',
          'WireGuard',
          ['ENV_DASHBOARD_R4SE_WIREGUARD_HEALTH_URL'],
        ],
        ['r4se-mihomo', 'Mihomo/OpenClash', ['ENV_DASHBOARD_R4SE_MIHOMO_URL']],
      ]),
    ];
  }

  /**
   * Creates a remote site whose first version starts from explicit unwired evidence.
   * @param id - Stable site id used by Admin selection and SSE events.
   * @param label - Human-readable site label.
   * @param signals - Signal id, label, and missing configuration keys.
   * @returns Site object with service-level status derived from child signals.
   */
  private createSiteWithUnwiredSignals(
    id: string,
    label: string,
    signals: Array<[string, string, string[]]>,
  ): EnvironmentSite {
    const node = this.createNode(
      `${id}-node`,
      label,
      signals.map(([signalId, signalLabel, missingKeys]) =>
        this.createService(signalId, signalLabel, [
          {
            evidence: [unwiredEvidence(signalLabel, missingKeys)],
            id: signalId,
            label: signalLabel,
            sourceKind: missingKeys.length > 0 ? 'unwired' : 'derived',
            status: missingKeys.length > 0 ? 'unwired' : 'unknown',
            summary:
              missingKeys.length > 0
                ? '只读观测配置未接入'
                : '等待运行态事件或专项适配器接入',
          },
        ]),
      ),
    );
    return {
      id,
      label,
      nodes: [node],
      status: mapSiteStatus(this.collectNodeStatuses([node])),
      summary: `${label} readonly evidence snapshot`,
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
   * Aggregates node statuses from nested service status.
   * @param nodes - Nodes belonging to a site.
   * @returns Flat list of service health statuses.
   */
  private collectNodeStatuses(
    nodes: EnvironmentNode[],
  ): EnvironmentHealthStatus[] {
    return nodes.flatMap((node) =>
      node.services.map((service) => service.status),
    );
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
