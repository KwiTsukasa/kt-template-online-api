import { Injectable } from '@nestjs/common';
import { EnvironmentDashboardConfigService } from '../environment-dashboard-config.service';
import { createUnwiredAdapterSignal } from './environment-readonly-adapter.helpers';

@Injectable()
export class KubernetesReadonlyAdapter {
  /**
   * Initializes Kubernetes readonly adapter.
   * @param config - Environment dashboard config reader.
   */
  constructor(private readonly config: EnvironmentDashboardConfigService) {}

  /**
   * Inspects Kubernetes readonly integration readiness.
   * @returns K8s signal; missing configuration is explicit unwired evidence.
   */
  async inspect() {
    const missing = this.config.missing([
      'ENV_DASHBOARD_K8S_API_SERVER',
      'ENV_DASHBOARD_K8S_NAMESPACE',
      'ENV_DASHBOARD_K8S_DEPLOYMENT',
    ]);
    return createUnwiredAdapterSignal(
      'k8s-deployment',
      'K8s Deployment',
      missing,
    );
  }
}
