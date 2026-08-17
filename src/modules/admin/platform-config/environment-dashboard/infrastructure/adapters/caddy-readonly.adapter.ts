import { Injectable, Optional } from '@nestjs/common';
import { EnvironmentDashboardConfigService } from '../environment-dashboard-config.service';
import { EnvironmentReadonlyHttpClient } from './environment-readonly-http.client';
import {
  createErrorAdapterSignal,
  createLiveAdapterSignal,
  createUnwiredAdapterSignal,
  isReadonlyHttpOk,
  joinReadonlyUrl,
} from './environment-readonly-adapter.helpers';

@Injectable()
export class CaddyReadonlyAdapter {
  private readonly http: EnvironmentReadonlyHttpClient;

  constructor(
    private readonly config: EnvironmentDashboardConfigService,
    @Optional() http?: EnvironmentReadonlyHttpClient,
  ) {
    this.http = http || new EnvironmentReadonlyHttpClient();
  }

  /**
   * 根据当前运行态处理Caddy只读的记录；当 `missing.length > 0` 成立时返回 `createUnwiredAdapterSignal( 'caddy-public',…`。
   * @returns Caddy只读的记录。
   */
  async inspect() {
    const missing = this.config.missing(['ENV_DASHBOARD_CADDY_PUBLIC_URL']);
    if (missing.length > 0) {
      return createUnwiredAdapterSignal(
        'caddy-public',
        'Caddy Public Route',
        missing,
      );
    }

    try {
      const publicResponse = await this.http.head(
        this.config.get('ENV_DASHBOARD_CADDY_PUBLIC_URL'),
      );
      const adminUrl = this.config.get('ENV_DASHBOARD_CADDY_ADMIN_URL');
      const adminResponse = await (async () => {
        if (adminUrl) {
          return await this.http.get(joinReadonlyUrl(adminUrl, 'config/'));
        }
        return undefined;
      })();
      const publicOk = isReadonlyHttpOk(publicResponse.status);
      const adminOk =
        !adminResponse || isReadonlyHttpOk(adminResponse.status);
      const status = (() => {
        if (publicOk && adminOk) {
          return 'ok';
        }
        return 'degraded';
      })();
      const summary = `Caddy public ${publicResponse.status}${
        (() => {
          if (adminResponse) {
            return `, admin ${adminResponse.status}`;
          }
          return '';
        })()
      }`;

      return createLiveAdapterSignal(
        'caddy-public',
        'Caddy Public Route',
        summary,
        {
          adminConfigured: Boolean(adminResponse),
          adminStatus: adminResponse?.status,
          publicStatus: publicResponse.status,
        },
        status,
        publicResponse.observedAt,
      );
    } catch (error) {
      return createErrorAdapterSignal(
        'caddy-public',
        'Caddy Public Route',
        error,
      );
    }
  }
}
