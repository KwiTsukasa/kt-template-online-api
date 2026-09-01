import { Injectable, Optional } from '@nestjs/common';
import type { EnvironmentHealthStatus } from '../../domain/environment-dashboard.types';
import { EnvironmentDashboardConfigService } from '../environment-dashboard-config.service';
import {
  createLiveAdapterSignal,
  createReadonlyHttpFailureSignal,
  createUnwiredAdapterSignal,
  joinReadonlyUrl,
} from './environment-readonly-adapter.helpers';
import { EnvironmentReadonlyHttpClient } from './environment-readonly-http.client';

@Injectable()
export class CodexThreadIndexReadonlyAdapter {
  private readonly http: EnvironmentReadonlyHttpClient;

  constructor(
    private readonly config: EnvironmentDashboardConfigService,
    @Optional() http?: EnvironmentReadonlyHttpClient,
  ) {
    this.http = http || new EnvironmentReadonlyHttpClient();
  }

  /**
   * 只读请求 Windows PC 上 Codex Thread Index 的固定 readiness 路径，仅投影 HTTP 状态。
   * @returns 不含任务、项目、签名凭据或响应正文的 Codex Thread Index 环境信号。
   */
  async inspect() {
    const missing = this.config.missing([
      'ENV_DASHBOARD_CODEX_THREAD_INDEX_URL',
    ]);
    if (missing.length > 0) {
      return createUnwiredAdapterSignal(
        'codex-thread-index-ready',
        'Codex Thread Index',
        missing,
      );
    }

    try {
      const response = await this.http.get(this.readinessUrl());
      const ready = response.status === 200;
      let status: EnvironmentHealthStatus = 'degraded';
      let summary = `Codex Thread Index readiness 返回 HTTP ${response.status}`;
      if (ready) {
        status = 'ok';
        summary = 'Codex Thread Index 已就绪';
      }
      return createLiveAdapterSignal(
        'codex-thread-index-ready',
        'Codex Thread Index',
        summary,
        { httpStatus: response.status, ready },
        status,
        response.observedAt,
      );
    } catch (error) {
      return createReadonlyHttpFailureSignal(
        'codex-thread-index-ready',
        'Codex Thread Index',
        error,
      );
    }
  }

  /**
   * 把固定 Windows PC 基址收敛到唯一允许的 `/readyz` 探针。
   * @returns 只允许读取 Thread Index readiness 状态的 URL。
   */
  private readinessUrl(): string {
    return joinReadonlyUrl(
      this.config.get('ENV_DASHBOARD_CODEX_THREAD_INDEX_URL'),
      'readyz',
    );
  }
}
