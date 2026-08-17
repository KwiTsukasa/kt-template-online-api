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

  constructor(
    private readonly config: EnvironmentDashboardConfigService,
    @Optional() http?: EnvironmentReadonlyHttpClient,
  ) {
    this.http = http || new EnvironmentReadonlyHttpClient();
  }

  /**
   * 根据当前运行态处理Kubernetes只读的记录；当 `missing.length > 0` 成立时返回 `createUnwiredAdapterSignal( 'k8s-deployment…`。
   * @returns Kubernetes只读的记录。
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
      const status = (() => {
        if (httpOk && replicasReady) {
          return 'ok';
        }
        return 'degraded';
      })();
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
   * 按运行时配置与路径参数构造部署URL。
   * @returns 按运行时配置与路径参数构造部署URL。
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
   * 按运行时配置与路径参数构造PodURL。
   * @returns 按运行时配置与路径参数构造PodURL。
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
   * 根据当前运行态构造认证请求头；从 `config.get` 读取认证请求头。
   * @returns 包含 `Authorization` 字段的认证请求头；没有可用结果或提前结束时为 `undefined`。
   */
  private createAuthHeaders(): Record<string, string> | undefined {
    const token = this.config.get('ENV_DASHBOARD_K8S_BEARER_TOKEN');
    if (!token) return undefined;
    return { Authorization: `Bearer ${token}` };
  }

  /**
   * 把领域字段投影为Pod参数。
   * @returns 包含 `labelSelector` 字段的把领域字段投影为Pod参数；没有可用结果或提前结束时为 `undefined`。
   */
  private podsParams(): Record<string, string> | undefined {
    const labelSelector = this.config.get('ENV_DASHBOARD_K8S_LABEL_SELECTOR');
    if (labelSelector) {
      return { labelSelector };
    }
    return undefined;
  }

  /**
   * 从输入中提取部署就绪状态。
   * @param body - 用于从输入中提取部署就绪状态的结构化输入，包含 `spec`、`status` 字段。
   * @returns 包含 `availableReplicas`、`desiredReplicas`、`readyReplicas`、`updatedReplicas` 字段的从输入中提取部署就绪状态。
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
   * 从输入中提取Pod就绪状态。
   * @param body - 用于从输入中提取Pod就绪状态的结构化输入，包含 `items` 字段。
   * @returns 包含 `podCount`、`podReadyCount`、`podRunningCount` 字段的从输入中提取Pod就绪状态。
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
