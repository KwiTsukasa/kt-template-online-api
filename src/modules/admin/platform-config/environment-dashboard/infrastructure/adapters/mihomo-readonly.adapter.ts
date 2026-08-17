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

  /** 检查Mihomo只读的记录。 */
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
        httpOk ? 'ok' : 'degraded',
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

  /** 返回APIURL。 */
  private apiUrl(path: 'configs' | 'proxies' | 'version'): string {
    return joinReadonlyUrl(
      this.config.get('ENV_DASHBOARD_R4SE_MIHOMO_URL'),
      path,
    );
  }

  /** 返回认证请求头。 */
  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.get(
        'ENV_DASHBOARD_R4SE_MIHOMO_SECRET',
      )}`,
    };
  }

  /** 统计代理。 */
  private countProxies(body: Record<string, unknown>): number {
    const proxies = body.proxies;
    const proxyRecord = asRecord(proxies);
    if (proxyRecord) return Object.keys(proxyRecord).length;
    return asArray(proxies).length;
  }
}
