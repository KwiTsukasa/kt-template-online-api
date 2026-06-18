import { Injectable, Optional } from '@nestjs/common';
import { EnvironmentDashboardConfigService } from '../environment-dashboard-config.service';
import { EnvironmentReadonlyHttpClient } from './environment-readonly-http.client';
import {
  asArray,
  asNumber,
  asRecord,
  createErrorAdapterSignal,
  createLiveAdapterSignal,
  createUnwiredAdapterSignal,
  isReadonlyHttpOk,
  joinReadonlyUrl,
  parseJsonPreview,
} from './environment-readonly-adapter.helpers';

@Injectable()
export class KubernetesReadonlyAdapter {
  private readonly http: EnvironmentReadonlyHttpClient;

  /**
   * Initializes Kubernetes readonly adapter.
   * @param config - Environment dashboard config reader.
   * @param http - Readonly HTTP client used for Kubernetes API probes.
   */
  constructor(
    private readonly config: EnvironmentDashboardConfigService,
    @Optional() http?: EnvironmentReadonlyHttpClient,
  ) {
    this.http = http || new EnvironmentReadonlyHttpClient();
  }

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
    if (missing.length > 0) {
      return createUnwiredAdapterSignal(
        'k8s-deployment',
        'K8s Deployment',
        missing,
      );
    }

    try {
      const headers = this.createAuthHeaders();
      const deploymentResponse = await this.http.get(this.deploymentUrl(), {
        headers,
      });
      const podsResponse = await this.http.get(this.podsUrl(), {
        headers,
        params: this.podsParams(),
      });
      const deployment = this.extractDeploymentReadiness(
        parseJsonPreview(deploymentResponse.bodyPreview),
      );
      const pods = this.extractPodReadiness(
        parseJsonPreview(podsResponse.bodyPreview),
      );
      const httpOk =
        isReadonlyHttpOk(deploymentResponse.status) &&
        isReadonlyHttpOk(podsResponse.status);
      const replicasReady =
        deployment.desiredReplicas === 0 ||
        (deployment.readyReplicas >= deployment.desiredReplicas &&
          deployment.updatedReplicas >= deployment.desiredReplicas &&
          deployment.availableReplicas >= deployment.desiredReplicas);
      const status = httpOk && replicasReady ? 'ok' : 'degraded';
      const summary = `K8s deployment ready ${deployment.readyReplicas}/${deployment.desiredReplicas}, pods ${pods.podReadyCount}/${pods.podCount}`;

      return createLiveAdapterSignal(
        'k8s-deployment',
        'K8s Deployment',
        summary,
        {
          availableReplicas: deployment.availableReplicas,
          deploymentHttpStatus: deploymentResponse.status,
          desiredReplicas: deployment.desiredReplicas,
          labelSelector: this.config.get('ENV_DASHBOARD_K8S_LABEL_SELECTOR'),
          podCount: pods.podCount,
          podHttpStatus: podsResponse.status,
          podReadyCount: pods.podReadyCount,
          podRunningCount: pods.podRunningCount,
          readyReplicas: deployment.readyReplicas,
          updatedReplicas: deployment.updatedReplicas,
        },
        status,
        deploymentResponse.observedAt,
      );
    } catch (error) {
      return createErrorAdapterSignal(
        'k8s-deployment',
        'K8s Deployment',
        error,
      );
    }
  }

  /**
   * Builds Kubernetes deployment API URL for the configured namespace and deployment.
   * @returns Readonly apps/v1 deployment endpoint.
   */
  private deploymentUrl(): string {
    const namespace = encodeURIComponent(
      this.config.get('ENV_DASHBOARD_K8S_NAMESPACE'),
    );
    const deployment = encodeURIComponent(
      this.config.get('ENV_DASHBOARD_K8S_DEPLOYMENT'),
    );
    return joinReadonlyUrl(
      this.config.get('ENV_DASHBOARD_K8S_API_SERVER'),
      `/apis/apps/v1/namespaces/${namespace}/deployments/${deployment}`,
    );
  }

  /**
   * Builds Kubernetes pods API URL for the configured namespace.
   * @returns Readonly core/v1 pods endpoint.
   */
  private podsUrl(): string {
    const namespace = encodeURIComponent(
      this.config.get('ENV_DASHBOARD_K8S_NAMESPACE'),
    );
    return joinReadonlyUrl(
      this.config.get('ENV_DASHBOARD_K8S_API_SERVER'),
      `/api/v1/namespaces/${namespace}/pods`,
    );
  }

  /**
   * Creates optional Kubernetes bearer-auth headers without exposing token values.
   * @returns Headers for outbound Kubernetes API request, or undefined when token is absent.
   */
  private createAuthHeaders(): Record<string, string> | undefined {
    const token = this.config.get('ENV_DASHBOARD_K8S_BEARER_TOKEN');
    if (!token) return undefined;
    return { Authorization: `Bearer ${token}` };
  }

  /**
   * Creates optional Kubernetes pod list query params from safe selector config.
   * @returns Params object accepted by the readonly HTTP client.
   */
  private podsParams(): Record<string, string> | undefined {
    const labelSelector = this.config.get('ENV_DASHBOARD_K8S_LABEL_SELECTOR');
    return labelSelector ? { labelSelector } : undefined;
  }

  /**
   * Extracts deployment replica readiness from Kubernetes deployment JSON.
   * @param body - Parsed deployment JSON body from Kubernetes API.
   * @returns Replica counts used for dashboard status.
   */
  private extractDeploymentReadiness(body: Record<string, unknown>) {
    const spec = asRecord(body.spec) || {};
    const status = asRecord(body.status) || {};
    const desiredReplicas =
      asNumber(spec.replicas) ?? asNumber(status.replicas) ?? 0;
    return {
      availableReplicas: asNumber(status.availableReplicas) || 0,
      desiredReplicas,
      readyReplicas: asNumber(status.readyReplicas) || 0,
      updatedReplicas: asNumber(status.updatedReplicas) || 0,
    };
  }

  /**
   * Extracts pod phase and ready-condition counts from Kubernetes pod list JSON.
   * @param body - Parsed pod list JSON body from Kubernetes API.
   * @returns Pod counts used for dashboard evidence.
   */
  private extractPodReadiness(body: Record<string, unknown>) {
    const pods = asArray(body.items);
    const podRunningCount = pods.filter((pod) => {
      const status = asRecord(asRecord(pod)?.status);
      return status?.phase === 'Running';
    }).length;
    const podReadyCount = pods.filter((pod) => {
      const status = asRecord(asRecord(pod)?.status);
      return asArray(status?.conditions).some((condition) => {
        const record = asRecord(condition);
        return record?.type === 'Ready' && record.status === 'True';
      });
    }).length;
    return {
      podCount: pods.length,
      podReadyCount,
      podRunningCount,
    };
  }
}
