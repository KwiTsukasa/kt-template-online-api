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
 * 通过使用受控凭据、区域与端点配置创建腾讯云 CVM SDK 客户端。
 * @param clientConfig - 限定通过使用受控凭据、区域与端点配置创建腾讯云 CVM SDK 客户端边界、地址与开关的运行配置。
 * @returns 返回配置完成的腾讯云 CVM SDK 客户端。
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

  constructor(
    private readonly config: EnvironmentDashboardConfigService,
    @Optional() createClient?: TencentCloudCvmClientFactory,
  ) {
    this.createClient = createClient || createTencentCloudCvmClient;
  }

  /**
   * 按配置启用状态读取腾讯云 CVM 实例；缺少接线、禁用或请求失败时分别返回对应健康证据。
   * @returns 返回腾讯云 CVM 的实时、未接线、禁用或错误健康信号。
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
        (() => {
          if (instanceState === 'RUNNING') {
            return 'ok';
          }
          if (response.TotalCount === 0) {
            return 'unknown';
          }
          return 'degraded';
        })();
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
   * 根据当前运行态与当前约束判定启用；从 `config.get` 读取启用。
   * @returns 满足启用约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isEnabled(): boolean {
    return (
      this.config
        .get('ENV_DASHBOARD_TENCENT_CLOUD_ENABLED')
        .toLowerCase() === 'true'
    );
  }

  /**
   * 将腾讯云访问密钥和地域配置组装为固定指向 CVM 服务端点的 SDK 客户端配置。
   * @returns 包含访问凭据、CVM 服务端点和目标地域的腾讯云客户端配置。
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
