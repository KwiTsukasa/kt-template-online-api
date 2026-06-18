import { Injectable } from '@nestjs/common';
import { EnvironmentDashboardConfigService } from '../environment-dashboard-config.service';
import { createUnwiredAdapterSignal } from './environment-readonly-adapter.helpers';

@Injectable()
export class JenkinsReadonlyAdapter {
  /**
   * Initializes Jenkins readonly adapter.
   * @param config - Environment dashboard config reader.
   */
  constructor(private readonly config: EnvironmentDashboardConfigService) {}

  /**
   * Inspects Jenkins readonly integration readiness.
   * @returns Jenkins signal; missing configuration is explicit unwired evidence.
   */
  async inspect() {
    const missing = this.config.missing([
      'ENV_DASHBOARD_JENKINS_URL',
      'ENV_DASHBOARD_JENKINS_JOB',
    ]);
    return createUnwiredAdapterSignal(
      'jenkins-build',
      'Jenkins Build',
      missing,
    );
  }
}
