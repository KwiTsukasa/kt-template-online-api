import { Injectable } from '@nestjs/common';
import { EnvironmentDashboardService } from './environment-dashboard.service';
import { EnvironmentEventBusService } from '../infrastructure/event/environment-event-bus.service';
import type { EnvironmentDashboardResponse } from '../domain/environment-dashboard.types';

@Injectable()
export class EnvironmentDashboardSelfCheckService {
  /**
   * Initializes the readonly self-check service.
   * @param dashboardService - Snapshot service reused after publishing self-check evidence.
   * @param eventBus - Environment event bus receiving self-check lifecycle events.
   */
  constructor(
    private readonly dashboardService: EnvironmentDashboardService,
    private readonly eventBus: EnvironmentEventBusService,
  ) {}

  /**
   * Runs a readonly self-check without invoking any write action.
   * @returns Fresh dashboard snapshot after a self-check event is emitted.
   */
  async runSelfCheck(): Promise<EnvironmentDashboardResponse> {
    const observedAt = new Date().toISOString();
    await this.eventBus.publish({
      eventId: `self-check-${Date.now()}`,
      observedAt,
      severity: 'ok',
      siteId: 'local-dev',
      sourceKind: 'local',
      summary: '环境总览只读自检已触发',
      topic: 'kt/env/local-dev/self-check/result',
    });
    return this.dashboardService.getDashboard({ forceRefresh: true });
  }
}
