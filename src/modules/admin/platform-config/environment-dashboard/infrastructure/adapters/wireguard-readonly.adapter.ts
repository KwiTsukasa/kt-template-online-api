import { Injectable, Optional } from '@nestjs/common';
import { EnvironmentDashboardConfigService } from '../environment-dashboard-config.service';
import { EnvironmentReadonlyHttpClient } from './environment-readonly-http.client';
import {
  createErrorAdapterSignal,
  createLiveAdapterSignal,
  createUnwiredAdapterSignal,
  isReadonlyHttpOk,
} from './environment-readonly-adapter.helpers';

@Injectable()
export class WireguardReadonlyAdapter {
  private readonly http: EnvironmentReadonlyHttpClient;

  constructor(
    private readonly config: EnvironmentDashboardConfigService,
    @Optional() http?: EnvironmentReadonlyHttpClient,
  ) {
    this.http = http || new EnvironmentReadonlyHttpClient();
  }

  /** 检查WireGuard只读的记录。 */
  async inspect() {
    const missing = this.config.missing([
      'ENV_DASHBOARD_TENCENT_WIREGUARD_HEALTH_URL',
      'ENV_DASHBOARD_R4SE_WIREGUARD_HEALTH_URL',
    ]);
    if (missing.length > 0) {
      return createUnwiredAdapterSignal('wireguard', 'WireGuard', missing);
    }

    try {
      const tencentResponse = await this.http.get(
        this.config.get('ENV_DASHBOARD_TENCENT_WIREGUARD_HEALTH_URL'),
      );
      const r4seResponse = await this.http.get(
        this.config.get('ENV_DASHBOARD_R4SE_WIREGUARD_HEALTH_URL'),
      );
      const endpointStatuses = [
        { label: 'tencent-cloud', status: tencentResponse.status },
        { label: 'r4se', status: r4seResponse.status },
      ];
      const reachableCount = endpointStatuses.filter((endpoint) =>
        isReadonlyHttpOk(endpoint.status),
      ).length;
      const status =
        reachableCount === endpointStatuses.length ? 'ok' : 'degraded';
      const summary = `WireGuard health endpoints reachable ${reachableCount}/${endpointStatuses.length}`;

      return createLiveAdapterSignal(
        'wireguard',
        'WireGuard',
        summary,
        {
          endpointCount: endpointStatuses.length,
          endpointStatuses,
          reachableCount,
        },
        status,
        tencentResponse.observedAt,
      );
    } catch (error) {
      return createErrorAdapterSignal('wireguard', 'WireGuard', error);
    }
  }
}
