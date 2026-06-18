import { Injectable } from '@nestjs/common';
import { EnvironmentDashboardConfigService } from '../environment-dashboard-config.service';
import { createUnwiredAdapterSignal } from './environment-readonly-adapter.helpers';

@Injectable()
export class MihomoReadonlyAdapter {
  /**
   * Initializes Mihomo/OpenClash readonly adapter.
   * @param config - Environment dashboard config reader.
   */
  constructor(private readonly config: EnvironmentDashboardConfigService) {}

  /**
   * Inspects Mihomo/OpenClash readonly API readiness.
   * @returns Mihomo signal; missing configuration is explicit unwired evidence.
   */
  async inspect() {
    const missing = this.config.missing([
      'ENV_DASHBOARD_R4SE_MIHOMO_URL',
      'ENV_DASHBOARD_R4SE_MIHOMO_SECRET',
    ]);
    return createUnwiredAdapterSignal(
      'r4se-mihomo',
      'Mihomo/OpenClash',
      missing,
    );
  }
}
