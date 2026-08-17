import { Injectable, Optional } from '@nestjs/common';
import { EnvironmentDashboardConfigService } from '../environment-dashboard-config.service';
import { EnvironmentReadonlyHttpClient } from './environment-readonly-http.client';
import {
  asArray,
  asRecord,
  asString,
  createErrorAdapterSignal,
  createLiveAdapterSignal,
  createUnwiredAdapterSignal,
  isReadonlyHttpOk,
  joinReadonlyUrl,
  parseJsonPreview,
} from './environment-readonly-adapter.helpers';

@Injectable()
export class MihomoReadonlyAdapter {
  private readonly http: EnvironmentReadonlyHttpClient;

  constructor(
    private readonly config: EnvironmentDashboardConfigService,
    @Optional() http?: EnvironmentReadonlyHttpClient,
  ) {
    this.http = http || new EnvironmentReadonlyHttpClient();
  }

  /**
   * 根据当前运行态处理Mihomo只读的记录；当 `missing.length > 0` 成立时返回 `createUnwiredAdapterSignal( 'r4se-mihomo',…`。
   * @returns Mihomo只读的记录。
   */
  async inspect() {
    const missing = this.config.missing([
      'ENV_DASHBOARD_R4SE_MIHOMO_URL',
      'ENV_DASHBOARD_R4SE_MIHOMO_SECRET',
    ]);
    if (missing.length > 0) {
      return createUnwiredAdapterSignal(
        'r4se-mihomo',
        'Mihomo/OpenClash',
        missing,
      );
    }

    try {
      const headers = this.authHeaders();
      const versionResponse = await this.http.get(this.apiUrl('version'), {
        headers,
      });
      const configsResponse = await this.http.get(this.apiUrl('configs'), {
        headers,
      });
      const proxiesResponse = await this.http.get(this.apiUrl('proxies'), {
        headers,
      });
      const version = parseJsonPreview(versionResponse.bodyPreview);
      const configs = parseJsonPreview(configsResponse.bodyPreview);
      const proxies = parseJsonPreview(proxiesResponse.bodyPreview);
      const httpOk =
        isReadonlyHttpOk(versionResponse.status) &&
        isReadonlyHttpOk(configsResponse.status) &&
        isReadonlyHttpOk(proxiesResponse.status);
      const mode = asString(configs.mode) || 'unknown';
      const proxyCount = this.countProxies(proxies);
      const versionText = asString(version.version) || 'unknown';
      const summary = `Mihomo ${versionText}, mode ${mode}, proxies ${proxyCount}`;

      return createLiveAdapterSignal(
        'r4se-mihomo',
        'Mihomo/OpenClash',
        summary,
        {
          configsHttpStatus: configsResponse.status,
          mode,
          proxiesHttpStatus: proxiesResponse.status,
          proxyCount,
          version: versionText,
          versionHttpStatus: versionResponse.status,
        },
        (() => {
          if (httpOk) {
            return 'ok';
          }
          return 'degraded';
        })(),
        versionResponse.observedAt,
      );
    } catch (error) {
      return createErrorAdapterSignal(
        'r4se-mihomo',
        'Mihomo/OpenClash',
        error,
      );
    }
  }

  /**
   * 按运行时配置与路径参数构造APIURL。
   * @param path - 必须保持在受控根目录内的路径。
   * @returns 按运行时配置与路径参数构造APIURL。
   */
  private apiUrl(path: 'configs' | 'proxies' | 'version'): string {
    return joinReadonlyUrl(
      this.config.get('ENV_DASHBOARD_R4SE_MIHOMO_URL'),
      path,
    );
  }

  /**
   * 把领域字段投影为认证请求头。
   * @returns 包含 `Authorization` 字段的把领域字段投影为认证请求头。
   */
  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.get(
        'ENV_DASHBOARD_R4SE_MIHOMO_SECRET',
      )}`,
    };
  }

  /**
   * 统计 Mihomo 响应中的代理数量；对象按键数计算，数组按元素数计算，其他输入视为空列表。
   * @param body - 用于代理的结构化输入，包含 `proxies` 字段。
   * @returns 代理。
   */
  private countProxies(body: Record<string, unknown>): number {
    const proxies = body.proxies;
    const proxyRecord = asRecord(proxies);
    if (proxyRecord) return Object.keys(proxyRecord).length;
    return asArray(proxies).length;
  }
}
