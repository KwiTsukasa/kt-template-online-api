import { Injectable } from '@nestjs/common';
import { EnvironmentDashboardConfigService } from '../environment-dashboard-config.service';
import { createUnwiredAdapterSignal } from './environment-readonly-adapter.helpers';

@Injectable()
export class WireguardReadonlyAdapter {
  /**
   * Initializes WireGuard readonly adapter.
   * @param config - Environment dashboard config reader.
   */
  constructor(private readonly config: EnvironmentDashboardConfigService) {}

  /**
   * Inspects WireGuard readonly health endpoint readiness.
   * @returns WireGuard signal; missing configuration is explicit unwired evidence.
   */
  async inspect() {
    const missing = this.config.missing([
      'ENV_DASHBOARD_TENCENT_WIREGUARD_HEALTH_URL',
      'ENV_DASHBOARD_R4SE_WIREGUARD_HEALTH_URL',
    ]);
    return createUnwiredAdapterSignal('wireguard', 'WireGuard', missing);
  }
}
