import { Injectable, Optional } from '@nestjs/common';
import type { EnvironmentHealthStatus } from '../../domain/environment-dashboard.types';
import { EnvironmentDashboardConfigService } from '../environment-dashboard-config.service';
import {
  createLiveAdapterSignal,
  createReadonlyHttpFailureSignal,
  createUnwiredAdapterSignal,
  isReadonlyHttpOk,
  joinReadonlyUrl,
  parseJsonPreview,
} from './environment-readonly-adapter.helpers';
import { EnvironmentReadonlyHttpClient } from './environment-readonly-http.client';

@Injectable()
export class HomeAssistantReadonlyAdapter {
  private readonly http: EnvironmentReadonlyHttpClient;

  constructor(
    private readonly config: EnvironmentDashboardConfigService,
    @Optional() http?: EnvironmentReadonlyHttpClient,
  ) {
    this.http = http || new EnvironmentReadonlyHttpClient();
  }

  /**
   * 只读请求 Home Assistant 官方 API 根路径，并以固定健康消息判定真实可用状态。
   * @returns 不含 access token 或响应正文的 Home Assistant 环境信号。
   */
  async inspect() {
    const missing = this.config.missing([
      'ENV_DASHBOARD_HOME_ASSISTANT_URL',
      'ENV_DASHBOARD_HOME_ASSISTANT_TOKEN',
    ]);
    if (missing.length > 0) {
      return createUnwiredAdapterSignal(
        'home-assistant-api',
        'Home Assistant API',
        missing,
      );
    }

    try {
      const response = await this.http.get(this.apiUrl(), {
        headers: this.authHeaders(),
      });
      const body = parseJsonPreview(response.bodyPreview);
      const apiReady =
        isReadonlyHttpOk(response.status) && body.message === 'API running.';
      let status: EnvironmentHealthStatus = 'degraded';
      let summary = 'Home Assistant API 返回了非预期健康响应';
      if (apiReady) {
        status = 'ok';
        summary = 'Home Assistant API 可用';
      }
      return createLiveAdapterSignal(
        'home-assistant-api',
        'Home Assistant API',
        summary,
        {
          apiReady,
          httpStatus: response.status,
        },
        status,
        response.observedAt,
      );
    } catch (error) {
      return createReadonlyHttpFailureSignal(
        'home-assistant-api',
        'Home Assistant API',
        error,
      );
    }
  }

  /**
   * 把部署级 Home Assistant 基址收敛到唯一允许的健康探针，禁止读取状态、服务或配置资源。
   * @returns 只允许读取健康消息的 `/api/` URL。
   */
  private apiUrl(): string {
    return joinReadonlyUrl(
      this.config.get('ENV_DASHBOARD_HOME_ASSISTANT_URL'),
      'api/',
    );
  }

  /**
   * 把私有长效 token 仅放入当前请求 Authorization Header，不进入环境证据。
   * @returns Home Assistant 官方 Bearer 与 JSON 接受头。
   */
  private authHeaders(): Record<string, string> {
    return {
      Accept: 'application/json',
      Authorization: `Bearer ${this.config.get(
        'ENV_DASHBOARD_HOME_ASSISTANT_TOKEN',
      )}`,
    };
  }
}
