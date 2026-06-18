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

  /**
   * Initializes Mihomo/OpenClash readonly adapter.
   * @param config - Environment dashboard config reader.
   * @param http - Readonly HTTP client used for Mihomo external controller probes.
   */
  constructor(
    private readonly config: EnvironmentDashboardConfigService,
    @Optional() http?: EnvironmentReadonlyHttpClient,
  ) {
    this.http = http || new EnvironmentReadonlyHttpClient();
  }

  /**
   * Inspects Mihomo/OpenClash readonly API readiness.
   * @returns Mihomo signal; missing configuration is explicit unwired evidence.
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

  /**
   * Builds a Mihomo readonly external-controller URL.
   * @param path - Readonly API path such as version, configs, or proxies.
   * @returns Full Mihomo external-controller endpoint URL.
   */
  private apiUrl(path: 'configs' | 'proxies' | 'version'): string {
    return joinReadonlyUrl(
      this.config.get('ENV_DASHBOARD_R4SE_MIHOMO_URL'),
      path,
    );
  }

  /**
   * Creates Mihomo authorization headers without returning the secret as evidence.
   * @returns Bearer authorization header for outbound readonly requests.
   */
  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.get(
        'ENV_DASHBOARD_R4SE_MIHOMO_SECRET',
      )}`,
    };
  }

  /**
   * Counts proxies from Mihomo response shapes without retaining proxy payloads.
   * @param body - Parsed proxies response body.
   * @returns Number of proxies reported by the readonly endpoint.
   */
  private countProxies(body: Record<string, unknown>): number {
    const proxies = body.proxies;
    const proxyRecord = asRecord(proxies);
    if (proxyRecord) return Object.keys(proxyRecord).length;
    return asArray(proxies).length;
  }
}
