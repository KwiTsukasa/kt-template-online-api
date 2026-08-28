import { Injectable, Optional } from '@nestjs/common';
import { RuntimeHealthService } from '@/runtime/health/runtime-health.service';
import { BotDashboardService } from '@/modules/bot-adapter/core/application/dashboard/bot-dashboard.service';
import {
  errorEvidence,
  liveEvidence,
  unwiredEvidence,
} from '../environment-dashboard-evidence.mapper';
import { EnvironmentDashboardConfigService } from '../environment-dashboard-config.service';
import { HomeAssistantReadonlyAdapter } from '../adapters/home-assistant-readonly.adapter';
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

export interface NasProdSignalCollectContext {
  observedAt?: string;
}

type BotSummaryProbe =
  | { data: any; error?: never }
  | { data?: never; error: unknown };

@Injectable()
export class NasProdSignalCollector {
  constructor(
    @Optional()
    private readonly runtimeHealthService?: RuntimeHealthService,
    @Optional()
    private readonly botDashboardService?: BotDashboardService,
    @Optional()
    private readonly config: EnvironmentDashboardConfigService = new EnvironmentDashboardConfigService(),
    @Optional()
    private readonly homeAssistantAdapter?: HomeAssistantReadonlyAdapter,
  ) {}

  /**
   * 把 API 进程、已认证 Home Assistant 与 QQBot 在线摘要收敛为移动端唯一 NAS 三服务，禁止内部依赖冒充产品服务。
   * @param context - 提供本轮站点快照的统一观测时间。
   * @returns 只包含三个已批准 NAS 服务的单节点站点。
   */
  async collect(
    context: NasProdSignalCollectContext = {},
  ): Promise<EnvironmentSite> {
    const observedAt = context.observedAt || new Date().toISOString();
    const botSummary = await this.readBotSummary();
    const services = [
      this.createNasApiService(observedAt),
      await this.createHomeAssistantService(),
      this.createBotService(botSummary, observedAt),
    ];
    const node = this.createNode('nas-prod-node', 'NAS', services);
    return {
      id: 'nas-prod',
      label: 'NAS',
      nodes: [node],
      status: mapSiteStatus(services.map((service) => service.status)),
      summary: 'NAS 生产服务只读快照',
    };
  }

  /**
   * 读取 QQBot 核心摘要，并把未注入或调用失败统一投影为错误分支。
   * @returns 成功时包含 QQBot 摘要，失败时包含原始异常供脱敏映射。
   */
  private async readBotSummary(): Promise<BotSummaryProbe> {
    if (!this.botDashboardService) {
      return { error: new Error('Bot dashboard service is not wired') };
    }
    try {
      return { data: await this.botDashboardService.summary() };
    } catch (error) {
      return { error };
    }
  }

  /**
   * 以当前 NestJS 进程的真实 `process` 健康检查构造 API Runtime 服务。
   * @param observedAt - 本轮快照的观测时间兜底值。
   * @returns 不受无关可选配置影响的 API 进程只读信号。
   */
  private createNasApiService(observedAt: string): EnvironmentService {
    const report = this.runtimeHealthService?.getRuntimeHealth();
    const processCheck = report?.checks.find(
      (check) => check.name === 'process',
    );
    let status: EnvironmentHealthStatus = 'unknown';
    let summary = 'API Runtime 尚未接入进程健康检查';
    if (processCheck?.status === 'live') {
      status = 'ok';
      summary = 'API Runtime 进程已响应';
    } else if (report) {
      status = 'degraded';
      summary = 'API Runtime 进程健康检查异常';
    }
    return this.createService('nas-api', 'API Runtime', [
      {
        evidence: [
          liveEvidence(
            'runtime-health',
            summary,
            report?.checkedAt || observedAt,
            {
              processStatus: processCheck?.status || 'missing',
              runtimeStatus: report?.status || 'missing',
            },
          ),
        ],
        id: 'nas-api-runtime',
        label: 'API Runtime',
        observedAt: report?.checkedAt || observedAt,
        sourceKind: 'live',
        status,
        summary,
      },
    ]);
  }

  /**
   * 把 Home Assistant 固定适配器包装为 NAS 服务，配置缺失时保留完整键名证据。
   * @returns 包含唯一 Home Assistant API 信号的环境服务。
   */
  private async createHomeAssistantService(): Promise<EnvironmentService> {
    const missing = this.config.missing([
      'ENV_DASHBOARD_HOME_ASSISTANT_URL',
      'ENV_DASHBOARD_HOME_ASSISTANT_TOKEN',
    ]);
    if (missing.length > 0 || !this.homeAssistantAdapter) {
      return this.createService('home-assistant', 'Home Assistant', [
        {
          evidence: [unwiredEvidence('Home Assistant API', missing)],
          id: 'home-assistant-api',
          label: 'Home Assistant API',
          sourceKind: 'unwired',
          status: 'unwired',
          summary: '只读观测配置未接入',
        },
      ]);
    }
    try {
      const signal = await this.homeAssistantAdapter.inspect();
      return this.createService('home-assistant', 'Home Assistant', [signal]);
    } catch (error) {
      return this.createService('home-assistant', 'Home Assistant', [
        {
          evidence: [errorEvidence('Home Assistant API', error)],
          id: 'home-assistant-api',
          label: 'Home Assistant API',
          sourceKind: 'derived',
          status: 'down',
          summary: 'Home Assistant 只读观测失败',
        },
      ]);
    }
  }

  /**
   * 根据真实账号在线数构造 QQBot 服务，任一在线连接即可证明消息链路已接入。
   * @param probe - QQBot 摘要或读取异常。
   * @param observedAt - 本轮快照的观测时间。
   * @returns 不含账号身份的 QQBot 在线计数信号。
   */
  private createBotService(
    probe: BotSummaryProbe,
    observedAt: string,
  ): EnvironmentService {
    if (probe.error) {
      return this.createService('bot-core', 'QQBot', [
        {
          evidence: [errorEvidence('bot-dashboard', probe.error, observedAt)],
          id: 'bot-core-summary',
          label: 'QQBot',
          observedAt,
          sourceKind: 'derived',
          status: 'down',
          summary: 'QQBot 摘要不可用',
        },
      ]);
    }
    const accountTotal = Number(probe.data?.accountTotal || 0);
    const onlineTotal = Number(probe.data?.onlineTotal || 0);
    let status: EnvironmentHealthStatus = 'degraded';
    let summary = `QQBot 在线连接 ${onlineTotal}/${accountTotal}`;
    if (onlineTotal > 0) {
      status = 'ok';
      summary = `QQBot 消息链路已连接 ${onlineTotal}/${accountTotal}`;
    }
    return this.createService('bot-core', 'QQBot', [
      {
        evidence: [
          liveEvidence('bot-dashboard', summary, observedAt, {
            accountTotal,
            onlineTotal,
          }),
        ],
        id: 'bot-core-summary',
        label: 'QQBot',
        observedAt,
        sourceKind: 'live',
        status,
        summary,
      },
    ]);
  }

  /**
   * 以 NAS 服务的最差信号作为服务状态并拼接摘要。
   * @param id - 服务稳定标识。
   * @param label - 服务展示名称。
   * @param signals - 当前服务的只读信号。
   * @returns 可直接进入站点拓扑的 NAS 环境服务。
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
   * 汇总 NAS 下三个固定服务并保留其原始信号。
   * @param id - 节点稳定标识。
   * @param label - 节点展示名称。
   * @param services - NAS 的固定服务列表。
   * @returns 具有汇总状态的 NAS 节点。
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
