import { Injectable } from '@nestjs/common';
import { EnvironmentDashboardConfigService } from '../environment-dashboard-config.service';
import { createUnwiredAdapterSignal } from './environment-readonly-adapter.helpers';

@Injectable()
export class CaddyReadonlyAdapter {
  /**
   * Initializes Caddy readonly adapter.
   * @param config - Environment dashboard config reader.
   */
  constructor(private readonly config: EnvironmentDashboardConfigService) {}

  /**
   * Inspects Caddy readonly integration readiness.
   * @returns Caddy signal; missing configuration is explicit unwired evidence.
   */
  async inspect() {
    const missing = this.config.missing(['ENV_DASHBOARD_CADDY_PUBLIC_URL']);
    return createUnwiredAdapterSignal(
      'caddy-public',
      'Caddy Public Route',
      missing,
    );
  }
}
