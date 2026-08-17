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

  constructor(
    private readonly config: EnvironmentDashboardConfigService,
    @Optional() http?: EnvironmentReadonlyHttpClient,
  ) {
    this.http = http || new EnvironmentReadonlyHttpClient();
  }

  /**
   * 根据当前运行态处理Jenkins只读的记录；当 `missing.length > 0` 成立时返回 `createUnwiredAdapterSignal( 'jenkins-build'…`。
   * @returns Jenkins只读的记录。
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
      const result = (() => {
        if (building) {
          return 'BUILDING';
        }
        return asString(body.result) || 'UNKNOWN';
      })();
      const status = (() => {
        if (!building && result === 'SUCCESS') {
          return 'ok';
        }
        return 'degraded';
      })();
      const summary = `Jenkins last build ${(() => {
        if (buildNumber) {
          return `#${buildNumber} `;
        }
        return '';
      })()}${result}`;

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
   * 根据当前运行态构造上次构建URL；从 `config.get` 读取上次构建URL。
   * @returns 上次构建URL。
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
   * 根据当前运行态构造认证请求头；从 `config.get` 读取认证请求头。
   * @returns 包含 `Authorization` 字段的认证请求头；没有可用结果或提前结束时为 `undefined`。
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
