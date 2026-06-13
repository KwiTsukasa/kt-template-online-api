export type RuntimeHealthStatus = 'live' | 'ready' | 'degraded' | 'blocked';

export interface RuntimeHealthCheck {
  name: string;
  status: RuntimeHealthStatus;
  critical: boolean;
  message: string;
  detail?: Record<string, unknown>;
}

export interface RuntimeHealthReport {
  service: 'kt-template-online-api';
  checkedAt: string;
  status: RuntimeHealthStatus;
  checks: RuntimeHealthCheck[];
}
