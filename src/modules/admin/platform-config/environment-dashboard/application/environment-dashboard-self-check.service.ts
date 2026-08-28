import { Injectable } from '@nestjs/common';
import { EnvironmentDashboardService } from './environment-dashboard.service';
import { EnvironmentEventBusService } from '../infrastructure/event/environment-event-bus.service';
import type { EnvironmentDashboardResponse } from '../domain/environment-dashboard.types';

@Injectable()
export class EnvironmentDashboardSelfCheckService {
  constructor(
    private readonly dashboardService: EnvironmentDashboardService,
    private readonly eventBus: EnvironmentEventBusService,
  ) {}

  /**
   * 根据当前运行态处理自身检查；向目标通道投递结果（`eventBus.publish`）。
   * @returns 自身检查。
   */
  async runSelfCheck(): Promise<EnvironmentDashboardResponse> {
    const observedAt = new Date().toISOString();
    await this.eventBus.publish({
      eventId: `self-check-${Date.now()}`,
      observedAt,
      severity: 'ok',
      siteId: 'nas-prod',
      sourceKind: 'local',
      summary: '环境总览只读自检已触发',
      topic: 'kt/env/nas-prod/self-check/result',
    });
    return this.dashboardService.getDashboard({ forceRefresh: true });
  }
}
