import { Injectable, Optional } from '@nestjs/common';
import type { EnvironmentHealthStatus } from '../../domain/environment-dashboard.types';
import { EnvironmentDashboardConfigService } from '../environment-dashboard-config.service';
import {
  createLiveAdapterSignal,
  createReadonlyHttpFailureSignal,
  createUnwiredAdapterSignal,
  isReadonlyHttpOk,
  joinReadonlyUrl,
} from './environment-readonly-adapter.helpers';
import { EnvironmentReadonlyHttpClient } from './environment-readonly-http.client';

@Injectable()
export class SunshineReadonlyAdapter {
  private readonly http: EnvironmentReadonlyHttpClient;

  constructor(
    private readonly config: EnvironmentDashboardConfigService,
    @Optional() http?: EnvironmentReadonlyHttpClient,
  ) {
    this.http = http || new EnvironmentReadonlyHttpClient();
  }

  /**
   * 只读请求 Sunshine 官方应用列表路径，并仅按鉴权后的 HTTP 状态判断 API 可达性。
   * @returns 不含账号、密码或应用清单正文的 Sunshine 环境信号。
   */
  async inspect() {
    const missing = this.config.missing([
      'ENV_DASHBOARD_SUNSHINE_URL',
      'ENV_DASHBOARD_SUNSHINE_USERNAME',
      'ENV_DASHBOARD_SUNSHINE_PASSWORD',
    ]);
    if (missing.length > 0) {
      return createUnwiredAdapterSignal(
        'sunshine-api',
        'Sunshine API',
        missing,
      );
    }

    try {
      const response = await this.http.get(this.apiUrl(), {
        headers: this.authHeaders(),
      });
      const reachable = isReadonlyHttpOk(response.status);
      let status: EnvironmentHealthStatus = 'degraded';
      let summary = `Sunshine API 返回 HTTP ${response.status}`;
      if (reachable) {
        status = 'ok';
        summary = 'Sunshine API 可用';
      }
      return createLiveAdapterSignal(
        'sunshine-api',
        'Sunshine API',
        summary,
        { httpStatus: response.status },
        status,
        response.observedAt,
      );
    } catch (error) {
      return createReadonlyHttpFailureSignal(
        'sunshine-api',
        'Sunshine API',
        error,
      );
    }
  }

  /**
   * 把 Sunshine 管理基址收敛到唯一允许的目录探针，隔离全部串流控制和配置端点。
   * @returns 只允许 GET 的 `/api/apps` URL。
   */
  private apiUrl(): string {
    return joinReadonlyUrl(
      this.config.get('ENV_DASHBOARD_SUNSHINE_URL'),
      'api/apps',
    );
  }

  /**
   * 把 Sunshine 私有用户名和密码编码为当前请求的 Basic Header，不进入环境证据。
   * @returns Sunshine 官方 Basic 与 JSON 接受头。
   */
  private authHeaders(): Record<string, string> {
    const username = this.config.get('ENV_DASHBOARD_SUNSHINE_USERNAME');
    const password = this.config.get('ENV_DASHBOARD_SUNSHINE_PASSWORD');
    const encoded = Buffer.from(`${username}:${password}`).toString('base64');
    return {
      Accept: 'application/json',
      Authorization: `Basic ${encoded}`,
    };
  }
}
