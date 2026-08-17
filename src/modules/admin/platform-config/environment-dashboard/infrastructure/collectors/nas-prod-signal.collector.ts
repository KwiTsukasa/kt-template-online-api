import { Injectable, Optional } from '@nestjs/common';
import { RuntimeHealthService } from '@/runtime/health/runtime-health.service';
import { MinioClientService } from '@/modules/asset/application/asset-minio.service';
import { QqbotDashboardService } from '@/modules/qqbot/core/application/dashboard/qqbot-dashboard.service';
import { QqbotPluginTaskService } from '@/modules/qqbot/plugin-platform/application/task';
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
    private readonly jenkinsAdapter?: JenkinsReadonlyAdapter,
    @Optional()
    private readonly kubernetesAdapter?: KubernetesReadonlyAdapter,
    @Optional()
    private readonly config: EnvironmentDashboardConfigService = new EnvironmentDashboardConfigService(),
  ) {}

  /**
   * 根据`context`处理NAS生产环境信号采集器记录；从 `readQqbotSummary` 读取NAS生产环境信号采集器记录。
   * @param context - 用于NAS生产环境信号采集器记录的领域对象，包含 `observedAt` 字段；省略时默认采用 `{}`。
   * @returns 包含 `id`、`label`、`nodes`、`status`、`summary` 字段的NAS生产环境信号采集器记录。
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
   * 读取QQBot摘要，并输出固定投影 `error` 字段。
   * @returns 包含 `error` 字段的Qqbot摘要。
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
   * 根据`observedAt`构造NASAPI服务；从 `runtimeHealthService.getRuntimeHealth` 读取NASAPI服务。
   * @param observedAt - 用于过期、排序或租约判定的时间基准。
   * @returns NASAPI服务。
   */
  private createNasApiService(observedAt: string): EnvironmentService {
    const report = this.runtimeHealthService?.getRuntimeHealth();
    const status = this.mapRuntimeStatus(report?.status);
    return this.createService('nas-api', 'API Runtime', [
      {
        evidence: [
          liveEvidence(
            'runtime-health',
            (() => {
              if (report) {
                return `Runtime health is ${report.status}`;
              }
              return 'RuntimeHealthService 未接入';
            })(),
            report?.checkedAt || observedAt,
            (() => {
              if (report) {
                return {
                  checks: report.checks?.length || 0,
                  runtimeStatus: report.status,
                };
              }
              return undefined;
            })(),
          ),
        ],
        id: 'nas-api-runtime',
        label: 'API Runtime',
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
          return '等待 RuntimeHealthService 接入';
        })(),
      },
    ]);
  }

  /**
   * 根据`observedAt`构造NAS管理端服务；从 `config.get` 读取NAS管理端服务。
   * @param observedAt - 用于过期、排序或租约判定的时间基准。
   * @returns NAS管理端服务。
   */
  private createNasAdminService(observedAt: string): EnvironmentService {
    const publicUrl =
      this.config.get('ENV_DASHBOARD_ADMIN_PUBLIC_URL') ||
      this.config.get('ENV_DASHBOARD_CADDY_PUBLIC_URL');
    const signal: EnvironmentSignal = (() => {
      if (publicUrl) {
        return {
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
        };
      }
      return {
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
    })();
    return this.createService('nas-admin', 'Admin Frontend', [signal]);
  }

  /**
   * 根据`id`、`label`、`summary`构造已配置的依赖服务。
   * @param id - 决定已配置的依赖服务内容、边界或目标的 `id` 值。
   * @param label - 决定已配置的依赖服务内容、边界或目标的 `label` 值。
   * @param summary - 决定已配置的依赖服务内容、边界或目标的 `summary` 值。
   * @param observedAt - 用于过期、排序或租约判定的时间基准。
   * @returns 已配置的依赖服务。
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
   * 根据`observedAt`构造MinIO服务；当 `!this.minioClientService` 成立时返回 `this.createUnknownService('minio', 'MinIO',…`。
   * @param observedAt - 用于过期、排序或租约判定的时间基准。
   * @returns MinIO服务。
   */
  private async createMinioService(observedAt: string): Promise<EnvironmentService> {
    if (!this.minioClientService) {
      return this.createUnknownService('minio', 'MinIO', 'MinioClientService 未接入', observedAt);
    }
    try {
      const result = await this.minioClientService.checkConnection();
      const status: EnvironmentHealthStatus = (() => {
        if (result?.exists) {
          return 'ok';
        }
        return 'degraded';
      })();
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
          summary: (() => {
            if (result?.exists) {
              return 'MinIO 默认 bucket 可用';
            }
            return 'MinIO 默认 bucket 不存在';
          })(),
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
   * 根据`probe`、`observedAt`构造QQBot服务；当 `probe.error` 成立时返回 `this.createService('qqbot-core', 'QQBot Cor…`。
   * @param probe - 用于QQBot服务的领域对象，包含 `error`、`data` 字段。
   * @param observedAt - 用于过期、排序或租约判定的时间基准。
   * @returns QQBot服务。
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
          status: (() => {
            if (this.qqbotDashboardService) {
              return 'down';
            }
            return 'unknown';
          })(),
          summary: 'QQBot 摘要不可用',
        },
      ]);
    }
    const accountTotal = Number(probe.data?.accountTotal || 0);
    const onlineTotal = Number(probe.data?.onlineTotal || 0);
    const status: EnvironmentHealthStatus =
      (() => {
        if (accountTotal > 0 && onlineTotal <= 0) {
          return 'degraded';
        }
        return 'ok';
      })();
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
   * 根据`probe`、`observedAt`构造NapCat服务；当 `probe.error` 成立时返回 `this.createUnknownService('napcat-runtime',…`。
   * @param probe - 用于NapCat服务的领域对象，包含 `error`、`data` 字段。
   * @param observedAt - 用于过期、排序或租约判定的时间基准。
   * @returns NapCat服务。
   */
  private createNapcatService(
    probe: QqbotSummaryProbe,
    observedAt: string,
  ): EnvironmentService {
    if (probe.error) {
      return this.createUnknownService('napcat-runtime', 'NapCat Runtime', '等待 QQBot 摘要提供 NapCat 会话证据', observedAt);
    }
    const sessions = (() => {
      if (Array.isArray(probe.data?.runtime?.sessions)) {
        return probe.data.runtime.sessions;
      }
      return [];
    })();
    const enabled = probe.data?.runtime?.enabled !== false;
    const status: EnvironmentHealthStatus = (() => {
      if (!enabled) {
        return 'blocked';
      }
      if (sessions.length > 0) {
        return 'ok';
      }
      return 'degraded';
    })();
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
        summary: (() => {
          if (sessions.length > 0) {
            return 'NapCat reverse WS 有活跃会话';
          }
          return 'NapCat reverse WS 暂无活跃会话';
        })(),
      },
    ]);
  }

  /**
   * 根据`observedAt`构造插件平台服务。
   * @param observedAt - 用于过期、排序或租约判定的时间基准。
   * @returns 插件平台服务。
   */
  private createPluginPlatformService(observedAt: string): EnvironmentService {
    return this.createService('plugin-platform', 'Plugin Platform', [
      {
        evidence: [
          {
            observedAt,
            source: 'plugin-platform',
            sourceKind: (() => {
              if (this.pluginTaskService) {
                return 'derived';
              }
              return 'unwired';
            })(),
            summary: (() => {
              if (this.pluginTaskService) {
                return '插件平台任务服务已接入只读摘要';
              }
              return '插件平台任务服务未接入当前模块上下文';
            })(),
          },
        ],
        id: 'plugin-platform-provider',
        label: 'Plugin Platform Provider',
        observedAt,
        sourceKind: (() => {
          if (this.pluginTaskService) {
            return 'derived';
          }
          return 'unwired';
        })(),
        status: (() => {
          if (this.pluginTaskService) {
            return 'unknown';
          }
          return 'unwired';
        })(),
        summary: (() => {
          if (this.pluginTaskService) {
            return '插件平台 provider 可见';
          }
          return '插件平台 provider 未接入';
        })(),
      },
    ]);
  }

  /**
   * 根据`observedAt`构造插件任务服务；当 `!this.pluginTaskService` 成立时返回 `this.createUnknownService('plugin-tasks', '…`。
   * @param observedAt - 用于过期、排序或租约判定的时间基准。
   * @returns 插件任务服务。
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
      const list = (() => {
        if (Array.isArray(page?.list)) {
          return page.list;
        }
        return [];
      })();
      const disabledCount = list.filter((task) => task?.enabled === false).length;
      const failedCount = list.filter((task) => /failed|error/i.test(`${task?.runtimeStatus || ''}`)).length;
      const status: EnvironmentHealthStatus =
        (() => {
          if (failedCount > 0) {
            return 'down';
          }
          if (disabledCount > 0) {
            return 'degraded';
          }
          return 'ok';
        })();
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
          summary: (() => {
            if (disabledCount > 0) {
              return '存在已禁用插件定时任务';
            }
            return '插件定时任务摘要可用';
          })(),
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
   * 根据`serviceId`、`serviceLabel`、`fallbackSignalId`构造适配器服务；当 `missing.length > 0 || !adapter` 成立时返回 `this.createService(serviceId, serviceLabel,…`。
   * @param serviceId - 用于精确定位服务的标识。
   * @param serviceLabel - 决定适配器服务内容、边界或目标的 `serviceLabel` 值。
   * @param fallbackSignalId - 用于精确定位fallbackSignal的标识。
   * @param fallbackSignalLabel - 决定适配器服务内容、边界或目标的 `fallbackSignalLabel` 值。
   * @param requiredKeys - 决定是否启用“requiredKeys”分支的布尔选项。
   * @param adapter - 用于适配器服务的领域对象，包含 `inspect` 字段；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 适配器服务。
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
   * 根据`id`、`label`、`summary`构造未知的服务。
   * @param id - 决定未知的服务内容、边界或目标的 `id` 值。
   * @param label - 决定未知的服务内容、边界或目标的 `label` 值。
   * @param summary - 决定未知的服务内容、边界或目标的 `summary` 值。
   * @param observedAt - 用于过期、排序或租约判定的时间基准。
   * @returns 未知的服务。
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
   * 以 NAS 观测信号中的最差状态作为服务状态，并按顺序拼接信号摘要。
   * @param id - NAS 环境服务的稳定标识。
   * @param label - 生产环境仪表盘展示的服务名称。
   * @param signals - 用于计算服务状态和摘要的 NAS 观测信号列表。
   * @returns 包含信号明细、汇总状态与合并摘要的 NAS 环境服务。
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
   * 汇总 NAS 节点下所有服务的最差健康状态，并保留服务明细供仪表盘展开。
   * @param id - NAS 环境节点的稳定标识。
   * @param label - 生产环境仪表盘展示的节点名称。
   * @param services - 用于计算节点总体健康状态的 NAS 服务列表。
   * @returns 包含原服务列表及汇总健康状态的 NAS 环境节点。
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
