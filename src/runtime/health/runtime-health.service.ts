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
          : check.message ?? `${check.key} is not configured`,
      })),
    ];

    return {
      service: 'kt-template-online-api',
      checkedAt: new Date().toISOString(),
      status: this.aggregateStatus(checks),
      checks,
    };
  }

  private getConfigCheckStatus(
    present: boolean,
    level: 'required' | 'optional',
  ): RuntimeHealthStatus {
    if (present) return 'ready';
    return level === 'required' ? 'blocked' : 'degraded';
  }

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
