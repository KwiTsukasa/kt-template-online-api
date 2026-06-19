import { Injectable, Optional } from '@nestjs/common';
import { cvm } from 'tencentcloud-sdk-nodejs/tencentcloud/services/cvm';
import type { ClientConfig } from 'tencentcloud-sdk-nodejs/tencentcloud/common/interface';
import { EnvironmentDashboardConfigService } from '../environment-dashboard-config.service';
import {
  asNumber,
  asRecord,
  asString,
  createErrorAdapterSignal,
  createLiveAdapterSignal,
  createUnwiredAdapterSignal,
} from './environment-readonly-adapter.helpers';

interface TencentCloudDescribeInstancesResponse {
  InstanceSet?: Array<Record<string, unknown>>;
  RequestId?: string;
  TotalCount?: number;
}

interface TencentCloudCvmClient {
  DescribeInstances(request: {
    InstanceIds: string[];
    Limit: number;
  }): Promise<TencentCloudDescribeInstancesResponse>;
}

type TencentCloudCvmClientFactory = (
  clientConfig: ClientConfig,
) => TencentCloudCvmClient;

/**
 * Creates the official Tencent Cloud CVM SDK client for readonly Describe APIs.
 * @param clientConfig - SDK credential, region, and endpoint configuration.
 * @returns CVM client limited by adapter usage to DescribeInstances.
 */
function createTencentCloudCvmClient(
  clientConfig: ClientConfig,
): TencentCloudCvmClient {
  return new cvm.v20170312.Client(
    clientConfig,
  ) as unknown as TencentCloudCvmClient;
}

@Injectable()
export class TencentCloudReadonlyAdapter {
  private readonly createClient: TencentCloudCvmClientFactory;

  /**
   * Initializes Tencent Cloud readonly adapter.
   * @param config - Environment dashboard config reader.
   * @param createClient - Optional factory used by tests to mock the Tencent SDK.
   */
  constructor(
    private readonly config: EnvironmentDashboardConfigService,
    @Optional() createClient?: TencentCloudCvmClientFactory,
  ) {
    this.createClient = createClient || createTencentCloudCvmClient;
  }

  /**
   * Inspects Tencent Cloud readonly integration readiness.
   * @returns Tencent Cloud signal; missing configuration is explicit unwired evidence.
   */
  async inspect() {
    const missing = this.config.missing([
      'ENV_DASHBOARD_TENCENT_CLOUD_ENABLED',
      'ENV_DASHBOARD_TENCENT_SECRET_ID',
      'ENV_DASHBOARD_TENCENT_SECRET_KEY',
      'ENV_DASHBOARD_TENCENT_REGION',
      'ENV_DASHBOARD_TENCENT_INSTANCE_ID',
    ]);
    if (!this.isEnabled()) {
      missing.unshift('ENV_DASHBOARD_TENCENT_CLOUD_ENABLED=true');
    }
    if (missing.length > 0) {
      return createUnwiredAdapterSignal(
        'tencent-cvm',
        'Tencent Cloud CVM',
        missing,
      );
    }

    try {
      const response = await this.createClient(this.clientConfig())
        .DescribeInstances({
          InstanceIds: [this.config.get('ENV_DASHBOARD_TENCENT_INSTANCE_ID')],
          Limit: 1,
        });
      const instance = asRecord(response.InstanceSet?.[0]) || {};
      const instanceState = asString(instance.InstanceState) || 'UNKNOWN';
      const status =
        instanceState === 'RUNNING'
          ? 'ok'
          : response.TotalCount === 0
            ? 'unknown'
            : 'degraded';
      const summary = `Tencent Cloud CVM ${instanceState}`;

      return createLiveAdapterSignal(
        'tencent-cvm',
        'Tencent Cloud CVM',
        summary,
        {
          cpu: asNumber(instance.CPU),
          instanceId: asString(instance.InstanceId),
          instanceState,
          memoryMb: asNumber(instance.Memory),
          requestId: response.RequestId,
          totalCount: response.TotalCount,
        },
        status,
      );
    } catch (error) {
      return createErrorAdapterSignal(
        'tencent-cvm',
        'Tencent Cloud CVM',
        error,
      );
    }
  }

  /**
   * Checks the explicit Tencent Cloud enablement guard before creating SDK clients.
   * @returns True only when the dashboard Tencent integration is explicitly enabled.
   */
  private isEnabled(): boolean {
    return (
      this.config
        .get('ENV_DASHBOARD_TENCENT_CLOUD_ENABLED')
        .toLowerCase() === 'true'
    );
  }

  /**
   * Builds Tencent Cloud SDK config without exposing credentials as evidence.
   * @returns ClientConfig accepted by the official Tencent Cloud SDK.
   */
  private clientConfig(): ClientConfig {
    return {
      credential: {
        secretId: this.config.get('ENV_DASHBOARD_TENCENT_SECRET_ID'),
        secretKey: this.config.get('ENV_DASHBOARD_TENCENT_SECRET_KEY'),
      },
      profile: {
        httpProfile: {
          endpoint: 'cvm.tencentcloudapi.com',
        },
      },
      region: this.config.get('ENV_DASHBOARD_TENCENT_REGION'),
    };
  }
}
