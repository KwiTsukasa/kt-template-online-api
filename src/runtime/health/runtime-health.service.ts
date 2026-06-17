import { Injectable } from '@nestjs/common';
import { RuntimeConfigService } from '../config/runtime-config.service';
import {
  RuntimeHealthCheck,
  RuntimeHealthReport,
  RuntimeHealthStatus,
} from './runtime-health.types';

@Injectable()
export class RuntimeHealthService {
  /**
   * 初始化 RuntimeHealthService 实例。
   * @param runtimeConfigService - runtimeConfigService 服务依赖；影响 constructor 的返回值。
   */
  constructor(private readonly runtimeConfigService: RuntimeConfigService) {}

  /**
   * 查询 运行态健康检查数据。
   * @returns 运行态健康检查查询结果。
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
        message: check.present
          ? `${check.key} is configured`
          : (check.message ?? `${check.key} is not configured`),
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
   * 查询 运行态健康检查数据。
   * @param present - present 输入；决定 运行态条件分支。
   * @param level - level 输入；限定 运行态查询范围。
   * @returns 运行态健康检查查询结果。
   */
  private getConfigCheckStatus(
    present: boolean,
    level: 'required' | 'optional',
  ): RuntimeHealthStatus {
    if (present) return 'ready';
    return level === 'required' ? 'blocked' : 'degraded';
  }

  /**
   * 执行 运行态健康检查流程。
   * @param checks - 健康检查项列表；计算 运行态布尔判断。
   * @returns 运行态健康检查产出的 RuntimeHealthStatus。
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
