import type { KtDateTime } from '@/common';
import type { EnvironmentDashboardResponse } from '../../environment-dashboard/domain/environment-dashboard.types';

export interface MobileHomeNoticeItem {
  content: string;
  createTime?: KtDateTime;
  eventType: string;
  id: string;
  isTop: boolean;
  lastSeenAt?: KtDateTime;
  occurrenceCount: number;
  severity: string;
  source: string;
  status: number;
  summary?: string;
  title: string;
}

export interface MobileHomeNoticeSnapshot {
  items: MobileHomeNoticeItem[];
  total: number;
  unreadCount: number;
}

export interface MobileHomeBootstrapResponse {
  environment: EnvironmentDashboardResponse;
  notices: MobileHomeNoticeSnapshot;
}
