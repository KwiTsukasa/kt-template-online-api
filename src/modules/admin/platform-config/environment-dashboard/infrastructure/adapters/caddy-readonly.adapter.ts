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

  /**
   * Initializes Caddy readonly adapter.
   * @param config - Environment dashboard config reader.
   * @param http - Readonly HTTP client used for public/admin probes.
   */
  constructor(
    private readonly config: EnvironmentDashboardConfigService,
    @Optional() http?: EnvironmentReadonlyHttpClient,
  ) {
    this.http = http || new EnvironmentReadonlyHttpClient();
  }

  /**
   * Inspects Caddy readonly integration readiness.
   * @returns Caddy signal; missing configuration is explicit unwired evidence.
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
      const adminResponse = adminUrl
        ? await this.http.get(joinReadonlyUrl(adminUrl, 'config/'))
        : undefined;
      const publicOk = isReadonlyHttpOk(publicResponse.status);
      const adminOk =
        !adminResponse || isReadonlyHttpOk(adminResponse.status);
      const status = publicOk && adminOk ? 'ok' : 'degraded';
      const summary = `Caddy public ${publicResponse.status}${
        adminResponse ? `, admin ${adminResponse.status}` : ''
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
