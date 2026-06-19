import { Injectable, Optional } from '@nestjs/common';
import { RuntimeHealthService } from '@/runtime/health/runtime-health.service';
import { MinioClientService } from '@/modules/asset/application/asset-minio.service';
import { QqbotDashboardService } from '@/modules/qqbot/core/application/dashboard/qqbot-dashboard.service';
import { QqbotPluginTaskService } from '@/modules/qqbot/plugin-platform/application/task';
import { WordpressService } from '@/modules/wordpress/application/wordpress.service';
import { errorEvidence, liveEvidence, unwiredEvidence } from '../environment-dashboard-evidence.mapper';
import { EnvironmentDashboardConfigService } from '../environment-dashboard-config.service';
import { JenkinsReadonlyAdapter } from '../adapters/jenkins-readonly.adapter';
import { KubernetesReadonlyAdapter } from '../adapters/kubernetes-readonly.adapter';
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

export interface NasProdSignalCollectContext {
  observedAt?: string;
}

type QqbotSummaryProbe =
  | { data: any; error?: never }
  | { data?: never; error: unknown };

@Injectable()
export class NasProdSignalCollector {
  /**
   * Initializes NAS production collector from narrow readonly service ports.
   * @param runtimeHealthService - Runtime health reader proving API process/config state without touching deploy state.
   * @param qqbotDashboardService - QQBot summary reader; failures affect only QQBot/NapCat signals.
   * @param pluginTaskService - Plugin task page reader used to summarize scheduler state without executing tasks.
   * @param minioClientService - MinIO connection checker; errors remain scoped to the MinIO service.
   * @param wordpressService - WordPress optional admin login probe that reports availability without changing content.
   * @param jenkinsAdapter - Jenkins readonly adapter owned by the remote integration layer.
   * @param kubernetesAdapter - Kubernetes readonly adapter owned by the remote integration layer.
   * @param config - Dashboard config reader used to expose missing integration keys as unwired evidence.
   */
  constructor(
    @Optional()
    private readonly runtimeHealthService?: RuntimeHealthService,
    @Optional()
    private readonly qqbotDashboardService?: QqbotDashboardService,
    @Optional()
    private readonly pluginTaskService?: QqbotPluginTaskService,
    @Optional()
    private readonly minioClientService?: MinioClientService,
    @Optional()
    private readonly wordpressService?: WordpressService,
    @Optional()
    private readonly jenkinsAdapter?: JenkinsReadonlyAdapter,
    @Optional()
    private readonly kubernetesAdapter?: KubernetesReadonlyAdapter,
    @Optional()
    private readonly config: EnvironmentDashboardConfigService = new EnvironmentDashboardConfigService(),
  ) {}

  /**
   * Collects NAS production service evidence from internal modules and readonly remote adapters.
   * @param context - Snapshot context from the dashboard aggregator; `observedAt` aligns all evidence timestamps.
   * @returns NAS production site with individual service statuses and no cross-service failure leakage.
   */
  async collect(context: NasProdSignalCollectContext = {}): Promise<EnvironmentSite> {
    const observedAt = context.observedAt || new Date().toISOString();
    const qqbotSummary = await this.readQqbotSummary();
    const services = [
      this.createNasApiService(observedAt),
      this.createNasAdminService(observedAt),
      this.createConfiguredDependencyService(
        'mysql',
        'MySQL',
        '数据库连通性由 API 运行态和业务 smoke 共同证明',
        observedAt,
      ),
      this.createConfiguredDependencyService(
        'redis',
        'Redis',
        '队列和缓存连通性由运行态配置与业务 smoke 共同证明',
        observedAt,
      ),
      this.createConfiguredDependencyService(
        'loki',
        'Loki',
        '日志聚合连通性由日志页面和线上 smoke 共同证明',
        observedAt,
      ),
      await this.createMinioService(observedAt),
      await this.createWordpressService(observedAt),
      this.createQqbotService(qqbotSummary, observedAt),
      this.createNapcatService(qqbotSummary, observedAt),
      this.createPluginPlatformService(observedAt),
      await this.createPluginTaskService(observedAt),
      await this.createAdapterService(
        'jenkins',
        'Jenkins',
        'jenkins-build',
        'Jenkins Build',
        ['ENV_DASHBOARD_JENKINS_URL', 'ENV_DASHBOARD_JENKINS_JOB'],
        this.jenkinsAdapter,
      ),
      await this.createAdapterService(
        'kubernetes',
        'K8s',
        'k8s-deployment',
        'K8s Deployment',
        [
          'ENV_DASHBOARD_K8S_API_SERVER',
          'ENV_DASHBOARD_K8S_NAMESPACE',
          'ENV_DASHBOARD_K8S_DEPLOYMENT',
        ],
        this.kubernetesAdapter,
      ),
    ];
    const node = this.createNode('nas-prod-node', 'NAS Production Host', services);
    return {
      id: 'nas-prod',
      label: 'NAS Production',
      nodes: [node],
      status: mapSiteStatus(services.map((service) => service.status)),
      summary: 'NAS online environment readonly snapshot',
    };
  }

  /**
   * Reads QQBot summary once so QQBot and NapCat services share the same evidence source.
   * @returns Probe result containing either summary data or a captured failure.
   */
  private async readQqbotSummary(): Promise<QqbotSummaryProbe> {
    if (!this.qqbotDashboardService) return { error: new Error('QQBot dashboard service is not wired') };
    try {
      return { data: await this.qqbotDashboardService.summary() };
    } catch (error) {
      return { error };
    }
  }

  /**
   * Builds NAS API status from RuntimeHealthService without coupling it to QQBot state.
   * @param observedAt - Shared snapshot timestamp.
   * @returns API service signal.
   */
  private createNasApiService(observedAt: string): EnvironmentService {
    const report = this.runtimeHealthService?.getRuntimeHealth();
    const status = this.mapRuntimeStatus(report?.status);
    return this.createService('nas-api', 'API Runtime', [
      {
        evidence: [
          liveEvidence(
            'runtime-health',
            report ? `Runtime health is ${report.status}` : 'RuntimeHealthService 未接入',
            report?.checkedAt || observedAt,
            report
              ? {
                  checks: report.checks?.length || 0,
                  runtimeStatus: report.status,
                }
              : undefined,
          ),
        ],
        id: 'nas-api-runtime',
        label: 'API Runtime',
        observedAt: report?.checkedAt || observedAt,
        sourceKind: report ? 'live' : 'derived',
        status,
        summary: report ? `API runtime health: ${report.status}` : '等待 RuntimeHealthService 接入',
      },
    ]);
  }

  /**
   * Builds NAS Admin evidence from known public route configuration.
   * @param observedAt - Shared snapshot timestamp.
   * @returns Admin frontend service.
   */
  private createNasAdminService(observedAt: string): EnvironmentService {
    const publicUrl =
      this.config.get('ENV_DASHBOARD_ADMIN_PUBLIC_URL') ||
      this.config.get('ENV_DASHBOARD_CADDY_PUBLIC_URL');
    const signal: EnvironmentSignal = publicUrl
      ? {
          evidence: [
            {
              metadata: { url: publicUrl },
              observedAt,
              source: 'Admin public route',
              sourceKind: 'configured',
              summary: 'Admin 公开入口已配置，页面连通性由浏览器 smoke 验证',
            },
          ],
          id: 'nas-admin-route',
          label: 'Admin Public Route',
          observedAt,
          sourceKind: 'configured',
          status: 'unknown',
          summary: 'Admin 公开入口已配置',
        }
      : {
          evidence: [
            unwiredEvidence('Admin public route', [
              'ENV_DASHBOARD_ADMIN_PUBLIC_URL',
              'ENV_DASHBOARD_CADDY_PUBLIC_URL',
            ]),
          ],
          id: 'nas-admin-route',
          label: 'Admin Public Route',
          sourceKind: 'unwired',
          status: 'unwired',
          summary: 'Admin 公开入口未接入只读观测',
        };
    return this.createService('nas-admin', 'Admin Frontend', [signal]);
  }

  /**
   * Creates a dependency service that is visible but not falsely marked live.
   * @param id - Stable service and signal id prefix.
   * @param label - Operator-facing service label.
   * @param summary - Why this dependency is observed as configured/derived evidence.
   * @param observedAt - Shared snapshot timestamp.
   * @returns Dependency service with unknown status.
   */
  private createConfiguredDependencyService(
    id: string,
    label: string,
    summary: string,
    observedAt: string,
  ): EnvironmentService {
    return this.createService(id, label, [
      {
        evidence: [
          {
            observedAt,
            source: label,
            sourceKind: 'derived',
            summary,
          },
        ],
        id: `${id}-signal`,
        label,
        observedAt,
        sourceKind: 'derived',
        status: 'unknown',
        summary,
      },
    ]);
  }

  /**
   * Builds MinIO service evidence and scopes connection errors to MinIO only.
   * @param observedAt - Shared snapshot timestamp.
   * @returns MinIO service.
   */
  private async createMinioService(observedAt: string): Promise<EnvironmentService> {
    if (!this.minioClientService) {
      return this.createUnknownService('minio', 'MinIO', 'MinioClientService 未接入', observedAt);
    }
    try {
      const result = await this.minioClientService.checkConnection();
      const status: EnvironmentHealthStatus = result?.exists ? 'ok' : 'degraded';
      return this.createService('minio', 'MinIO', [
        {
          evidence: [
            liveEvidence('minio', `Bucket ${result?.bucketName || ''} exists=${!!result?.exists}`, observedAt, {
              bucketName: result?.bucketName,
              exists: !!result?.exists,
            }),
          ],
          id: 'minio-bucket',
          label: 'Default Bucket',
          observedAt,
          sourceKind: 'live',
          status,
          summary: result?.exists ? 'MinIO 默认 bucket 可用' : 'MinIO 默认 bucket 不存在',
        },
      ]);
    } catch (error) {
      return this.createService('minio', 'MinIO', [
        {
          evidence: [errorEvidence('minio', error, observedAt)],
          id: 'minio-bucket',
          label: 'Default Bucket',
          observedAt,
          sourceKind: 'derived',
          status: 'down',
          summary: 'MinIO 只读连通性检查失败',
        },
      ]);
    }
  }

  /**
   * Builds WordPress availability evidence using the existing optional login probe.
   * @param observedAt - Shared snapshot timestamp.
   * @returns WordPress service.
   */
  private async createWordpressService(observedAt: string): Promise<EnvironmentService> {
    if (!this.wordpressService) {
      return this.createUnknownService('wordpress', 'WordPress', 'WordpressService 未接入', observedAt);
    }
    try {
      const result = await this.wordpressService.tryLoginWithConfiguredAdmin();
      return this.createService('wordpress', 'WordPress', [
        {
          evidence: [
            liveEvidence('wordpress', result.available ? 'WordPress 管理员探针可用' : 'WordPress 管理员探针不可用', observedAt, {
              available: result.available,
              error: result.error,
            }),
          ],
          id: 'wordpress-admin-login',
          label: 'WordPress Admin Probe',
          observedAt,
          sourceKind: 'live',
          status: result.available ? 'ok' : 'degraded',
          summary: result.available ? 'WordPress 集成可用' : 'WordPress 集成不可用',
        },
      ]);
    } catch (error) {
      return this.createService('wordpress', 'WordPress', [
        {
          evidence: [errorEvidence('wordpress', error, observedAt)],
          id: 'wordpress-admin-login',
          label: 'WordPress Admin Probe',
          observedAt,
          sourceKind: 'derived',
          status: 'down',
          summary: 'WordPress 只读探针失败',
        },
      ]);
    }
  }

  /**
   * Builds QQBot core status from dashboard summary without affecting API service status.
   * @param probe - Shared QQBot summary probe.
   * @param observedAt - Shared snapshot timestamp.
   * @returns QQBot core service.
   */
  private createQqbotService(
    probe: QqbotSummaryProbe,
    observedAt: string,
  ): EnvironmentService {
    if (probe.error) {
      return this.createService('qqbot-core', 'QQBot Core', [
        {
          evidence: [errorEvidence('qqbot-dashboard', probe.error, observedAt)],
          id: 'qqbot-core-summary',
          label: 'QQBot Summary',
          observedAt,
          sourceKind: 'derived',
          status: this.qqbotDashboardService ? 'down' : 'unknown',
          summary: 'QQBot 摘要不可用',
        },
      ]);
    }
    const accountTotal = Number(probe.data?.accountTotal || 0);
    const onlineTotal = Number(probe.data?.onlineTotal || 0);
    const status: EnvironmentHealthStatus =
      accountTotal > 0 && onlineTotal <= 0 ? 'degraded' : 'ok';
    return this.createService('qqbot-core', 'QQBot Core', [
      {
        evidence: [
          liveEvidence('qqbot-dashboard', `QQBot online ${onlineTotal}/${accountTotal}`, observedAt, {
            accountTotal,
            bus: probe.data?.bus,
            onlineTotal,
          }),
        ],
        id: 'qqbot-core-summary',
        label: 'QQBot Summary',
        observedAt,
        sourceKind: 'live',
        status,
        summary: `QQBot 在线账号 ${onlineTotal}/${accountTotal}`,
      },
    ]);
  }

  /**
   * Builds NapCat runtime visibility from QQBot runtime session evidence.
   * @param probe - Shared QQBot summary probe.
   * @param observedAt - Shared snapshot timestamp.
   * @returns NapCat runtime service.
   */
  private createNapcatService(
    probe: QqbotSummaryProbe,
    observedAt: string,
  ): EnvironmentService {
    if (probe.error) {
      return this.createUnknownService('napcat-runtime', 'NapCat Runtime', '等待 QQBot 摘要提供 NapCat 会话证据', observedAt);
    }
    const sessions = Array.isArray(probe.data?.runtime?.sessions)
      ? probe.data.runtime.sessions
      : [];
    const enabled = probe.data?.runtime?.enabled !== false;
    const status: EnvironmentHealthStatus = !enabled
      ? 'blocked'
      : sessions.length > 0
        ? 'ok'
        : 'degraded';
    return this.createService('napcat-runtime', 'NapCat Runtime', [
      {
        evidence: [
          liveEvidence('qqbot-reverse-ws', `NapCat reverse WS sessions: ${sessions.length}`, observedAt, {
            enabled,
            sessionCount: sessions.length,
          }),
        ],
        id: 'napcat-reverse-ws',
        label: 'Reverse WS Sessions',
        observedAt,
        sourceKind: 'live',
        status,
        summary: sessions.length > 0 ? 'NapCat reverse WS 有活跃会话' : 'NapCat reverse WS 暂无活跃会话',
      },
    ]);
  }

  /**
   * Builds plugin platform presence evidence without exposing write actions.
   * @param observedAt - Shared snapshot timestamp.
   * @returns Plugin platform service.
   */
  private createPluginPlatformService(observedAt: string): EnvironmentService {
    return this.createService('plugin-platform', 'Plugin Platform', [
      {
        evidence: [
          {
            observedAt,
            source: 'plugin-platform',
            sourceKind: this.pluginTaskService ? 'derived' : 'unwired',
            summary: this.pluginTaskService
              ? '插件平台任务服务已接入只读摘要'
              : '插件平台任务服务未接入当前模块上下文',
          },
        ],
        id: 'plugin-platform-provider',
        label: 'Plugin Platform Provider',
        observedAt,
        sourceKind: this.pluginTaskService ? 'derived' : 'unwired',
        status: this.pluginTaskService ? 'unknown' : 'unwired',
        summary: this.pluginTaskService
          ? '插件平台 provider 可见'
          : '插件平台 provider 未接入',
      },
    ]);
  }

  /**
   * Builds scheduled plugin task evidence without executing task jobs.
   * @param observedAt - Shared snapshot timestamp.
   * @returns Plugin task service.
   */
  private async createPluginTaskService(observedAt: string): Promise<EnvironmentService> {
    if (!this.pluginTaskService) {
      return this.createUnknownService('plugin-tasks', 'Plugin Tasks', 'QqbotPluginTaskService 未接入', observedAt);
    }
    try {
      const page = await this.pluginTaskService.pageTasks({
        pageNo: 1,
        pageSize: 50,
      } as any);
      const list = Array.isArray(page?.list) ? page.list : [];
      const disabledCount = list.filter((task) => task?.enabled === false).length;
      const failedCount = list.filter((task) => /failed|error/i.test(`${task?.runtimeStatus || ''}`)).length;
      const status: EnvironmentHealthStatus =
        failedCount > 0 ? 'down' : disabledCount > 0 ? 'degraded' : 'ok';
      return this.createService('plugin-tasks', 'Plugin Tasks', [
        {
          evidence: [
            liveEvidence('plugin-tasks', `Plugin tasks total=${page?.total || list.length}, disabled=${disabledCount}`, observedAt, {
              disabledCount,
              failedCount,
              total: page?.total || list.length,
            }),
          ],
          id: 'plugin-task-scheduler',
          label: 'Scheduled Tasks',
          observedAt,
          sourceKind: 'live',
          status,
          summary: disabledCount > 0 ? '存在已禁用插件定时任务' : '插件定时任务摘要可用',
        },
      ]);
    } catch (error) {
      return this.createService('plugin-tasks', 'Plugin Tasks', [
        {
          evidence: [errorEvidence('plugin-tasks', error, observedAt)],
          id: 'plugin-task-scheduler',
          label: 'Scheduled Tasks',
          observedAt,
          sourceKind: 'derived',
          status: 'down',
          summary: '插件定时任务摘要读取失败',
        },
      ]);
    }
  }

  /**
   * Builds service evidence from a readonly remote adapter or explicit missing config keys.
   * @param serviceId - Stable service id used by topology.
   * @param serviceLabel - Operator-facing service label.
   * @param fallbackSignalId - Signal id used when config is missing.
   * @param fallbackSignalLabel - Signal label used when config is missing.
   * @param requiredKeys - Public env keys required for this readonly adapter.
   * @param adapter - Optional adapter implementation.
   * @returns Remote integration service.
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
   * Creates a visible unknown service for dependencies whose safe reader is absent.
   * @param id - Stable service id.
   * @param label - Operator-facing service label.
   * @param summary - Reason why the service is not live evidence.
   * @param observedAt - Shared snapshot timestamp.
   * @returns Unknown service with derived evidence.
   */
  private createUnknownService(
    id: string,
    label: string,
    summary: string,
    observedAt: string,
  ): EnvironmentService {
    return this.createService(id, label, [
      {
        evidence: [
          {
            observedAt,
            source: label,
            sourceKind: 'derived',
            summary,
          },
        ],
        id: `${id}-signal`,
        label,
        observedAt,
        sourceKind: 'derived',
        status: 'unknown',
        summary,
      },
    ]);
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
   * Creates a NAS node and derives aggregate status from services.
   * @param id - Stable node id for topology edges.
   * @param label - Operator-facing node label.
   * @param services - Services owned by the NAS node.
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
