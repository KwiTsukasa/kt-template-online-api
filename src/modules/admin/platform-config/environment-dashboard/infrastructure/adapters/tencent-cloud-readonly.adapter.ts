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

  constructor(
    private readonly config: EnvironmentDashboardConfigService,
    @Optional() createClient?: TencentCloudCvmClientFactory,
  ) {
    this.createClient = createClient || createTencentCloudCvmClient;
  }

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

  private isEnabled(): boolean {
    return (
      this.config
        .get('ENV_DASHBOARD_TENCENT_CLOUD_ENABLED')
        .toLowerCase() === 'true'
    );
  }

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
