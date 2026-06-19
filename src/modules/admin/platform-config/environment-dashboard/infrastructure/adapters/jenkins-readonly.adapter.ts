import { Injectable, Optional } from '@nestjs/common';
import { EnvironmentDashboardConfigService } from '../environment-dashboard-config.service';
import { EnvironmentReadonlyHttpClient } from './environment-readonly-http.client';
import {
  asNumber,
  asString,
  createErrorAdapterSignal,
  createLiveAdapterSignal,
  createUnwiredAdapterSignal,
  joinReadonlyUrl,
  parseJsonPreview,
} from './environment-readonly-adapter.helpers';

@Injectable()
export class JenkinsReadonlyAdapter {
  private readonly http: EnvironmentReadonlyHttpClient;

  /**
   * Initializes Jenkins readonly adapter.
   * @param config - Environment dashboard config reader.
   * @param http - Readonly HTTP client used for Jenkins JSON API probes.
   */
  constructor(
    private readonly config: EnvironmentDashboardConfigService,
    @Optional() http?: EnvironmentReadonlyHttpClient,
  ) {
    this.http = http || new EnvironmentReadonlyHttpClient();
  }

  /**
   * Inspects Jenkins readonly integration readiness.
   * @returns Jenkins signal; missing configuration is explicit unwired evidence.
   */
  async inspect() {
    const missing = this.config.missing([
      'ENV_DASHBOARD_JENKINS_URL',
      'ENV_DASHBOARD_JENKINS_JOB',
    ]);
    if (missing.length > 0) {
      return createUnwiredAdapterSignal(
        'jenkins-build',
        'Jenkins Build',
        missing,
      );
    }

    try {
      const response = await this.http.get(this.buildLastBuildUrl(), {
        headers: this.createAuthHeaders(),
      });
      const body = parseJsonPreview(response.bodyPreview);
      const buildNumber = asNumber(body.number);
      const durationMs = asNumber(body.duration);
      const building = body.building === true;
      const result = building ? 'BUILDING' : asString(body.result) || 'UNKNOWN';
      const status = !building && result === 'SUCCESS' ? 'ok' : 'degraded';
      const summary = `Jenkins last build ${buildNumber ? `#${buildNumber} ` : ''}${result}`;

      return createLiveAdapterSignal(
        'jenkins-build',
        'Jenkins Build',
        summary,
        {
          buildNumber,
          building,
          durationMs,
          httpStatus: response.status,
          result,
        },
        status,
        response.observedAt,
      );
    } catch (error) {
      return createErrorAdapterSignal(
        'jenkins-build',
        'Jenkins Build',
        error,
      );
    }
  }

  /**
   * Builds Jenkins last-build JSON API URL from folder-style job names.
   * @returns Jenkins readonly JSON API URL for the configured job.
   */
  private buildLastBuildUrl(): string {
    const jobPath = this.config
      .get('ENV_DASHBOARD_JENKINS_JOB')
      .split('/')
      .filter(Boolean)
      .map((segment) => `job/${encodeURIComponent(segment)}`)
      .join('/');
    return joinReadonlyUrl(
      this.config.get('ENV_DASHBOARD_JENKINS_URL'),
      `${jobPath}/lastBuild/api/json`,
    );
  }

  /**
   * Creates optional Jenkins basic-auth headers without returning token values as evidence.
   * @returns Headers for outbound Jenkins API request, or undefined when credentials are absent.
   */
  private createAuthHeaders(): Record<string, string> | undefined {
    const username = this.config.get('ENV_DASHBOARD_JENKINS_USERNAME');
    const token = this.config.get('ENV_DASHBOARD_JENKINS_TOKEN');
    if (!username || !token) return undefined;
    return {
      Authorization: `Basic ${Buffer.from(`${username}:${token}`).toString(
        'base64',
      )}`,
    };
  }
}
