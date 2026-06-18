import { Injectable } from '@nestjs/common';
import { EnvironmentDashboardConfigService } from '../environment-dashboard-config.service';
import { createUnwiredAdapterSignal } from './environment-readonly-adapter.helpers';

@Injectable()
export class TencentCloudReadonlyAdapter {
  /**
   * Initializes Tencent Cloud readonly adapter.
   * @param config - Environment dashboard config reader.
   */
  constructor(private readonly config: EnvironmentDashboardConfigService) {}

  /**
   * Inspects Tencent Cloud readonly integration readiness.
   * @returns Tencent Cloud signal; missing configuration is explicit unwired evidence.
   */
  async inspect() {
    const missing = this.config.missing([
      'ENV_DASHBOARD_TENCENT_SECRET_ID',
      'ENV_DASHBOARD_TENCENT_SECRET_KEY',
      'ENV_DASHBOARD_TENCENT_REGION',
      'ENV_DASHBOARD_TENCENT_INSTANCE_ID',
    ]);
    return createUnwiredAdapterSignal(
      'tencent-cvm',
      'Tencent Cloud CVM',
      missing,
    );
  }
}
