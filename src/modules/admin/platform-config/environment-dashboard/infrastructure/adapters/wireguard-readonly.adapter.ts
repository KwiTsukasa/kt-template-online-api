import { Injectable, Optional } from '@nestjs/common';
import type { EnvironmentHealthStatus } from '../../domain/environment-dashboard.types';
import { EnvironmentDashboardConfigService } from '../environment-dashboard-config.service';
import { EnvironmentReadonlyHttpClient } from './environment-readonly-http.client';
import {
  createLiveAdapterSignal,
  createReadonlyHttpFailureSignal,
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

  /**
   * 只读请求 R4SE 的固定 WireGuard 地址，仅以该隧道地址的 HTTP 状态判断可达性。
   * @returns 不含网络配置、Peer 或响应正文的 R4SE WireGuard 信号。
   */
  async inspect() {
    const missing = this.config.missing([
      'ENV_DASHBOARD_R4SE_WIREGUARD_HEALTH_URL',
    ]);
    if (missing.length > 0) {
      return createUnwiredAdapterSignal('r4se-wireguard', 'WireGuard', missing);
    }

    try {
      const response = await this.http.get(
        this.config.get('ENV_DASHBOARD_R4SE_WIREGUARD_HEALTH_URL'),
      );
      const reachable = isReadonlyHttpOk(response.status);
      let status: EnvironmentHealthStatus = 'degraded';
      let summary = `R4SE WireGuard 地址返回 HTTP ${response.status}`;
      if (reachable) {
        status = 'ok';
        summary = 'R4SE WireGuard 地址可达';
      }

      return createLiveAdapterSignal(
        'r4se-wireguard',
        'WireGuard',
        summary,
        {
          endpointCount: 1,
          httpStatus: response.status,
          reachable,
        },
        status,
        response.observedAt,
      );
    } catch (error) {
      return createReadonlyHttpFailureSignal(
        'r4se-wireguard',
        'WireGuard',
        error,
      );
    }
  }
}
