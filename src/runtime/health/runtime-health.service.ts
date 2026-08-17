import { Injectable } from '@nestjs/common';
import { RuntimeConfigService } from '../config/runtime-config.service';
import {
  RuntimeHealthCheck,
  RuntimeHealthReport,
  RuntimeHealthStatus,
} from './runtime-health.types';

@Injectable()
export class RuntimeHealthService {
  constructor(private readonly runtimeConfigService: RuntimeConfigService) {}

  /**
   * 按当前运行态读取针对运行态健康检查；从 `runtimeConfigService.getSafeSnapshot` 读取针对运行态健康检查。
   * @returns 包含 `service`、`checkedAt`、`status`、`checks` 字段的针对运行态健康检查。
   */
  getRuntimeHealth(): RuntimeHealthReport {
    const config = this.runtimeConfigService.getSafeSnapshot();
    const checks: RuntimeHealthCheck[] = [
      {
        name: 'process',
        status: 'live',
        critical: true,
        message: 'NestJS process answered runtime health request',
      },
      ...config.checks.map((check) => ({
        name: `config:${check.key}`,
        status: this.getConfigCheckStatus(check.present, check.level),
        critical: check.level === 'required',
        message: (() => {
          if (check.present) {
            return `${check.key} is configured`;
          }
          return (check.message ?? `${check.key} is not configured`);
        })(),
      })),
    ];

    return {
      service: 'kt-template-online-api',
      checkedAt: new Date().toISOString(),
      status: this.aggregateStatus(checks),
      checks,
    };
  }

  /**
   * 按`present`、`level`读取配置状态；当 `level === 'required'` 成立时返回 `'blocked'`。
   * @param present - 决定配置状态内容、边界或目标的 `present` 值。
   * @param level - 决定配置状态内容、边界或目标的 `level` 值。
   * @returns 当前状态对应的配置状态，取值为 `'ready'`、`'blocked'`、`'degraded'`。
   */
  private getConfigCheckStatus(
    present: boolean,
    level: 'required' | 'optional',
  ): RuntimeHealthStatus {
    if (present) return 'ready';
    if (level === 'required') {
      return 'blocked';
    }
    return 'degraded';
  }

  /**
   * 根据`checks`处理针对运行态健康检查；当 `checks.some((check) => check.critical && check.status === 'bl…` 成立时返回 `'blocked'`。
   * @param checks - 决定针对运行态健康检查内容、边界或目标的 `checks` 值。
   * @returns 当前状态对应的针对运行态健康检查，取值为 `'blocked'`、`'degraded'`、`'live'`、`'ready'`。
   */
  private aggregateStatus(checks: RuntimeHealthCheck[]): RuntimeHealthStatus {
    if (checks.some((check) => check.critical && check.status === 'blocked')) {
      return 'blocked';
    }

    if (checks.some((check) => check.status === 'degraded')) {
      return 'degraded';
    }

    if (checks.every((check) => check.status === 'live')) {
      return 'live';
    }

    return 'ready';
  }
}
