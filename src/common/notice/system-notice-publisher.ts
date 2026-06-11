export const SYSTEM_NOTICE_PUBLISHER = Symbol('SYSTEM_NOTICE_PUBLISHER');

export type SystemNoticeSeverity = 'error' | 'fatal' | 'info' | 'warn';

export type SystemNoticePublishInput = {
  content: string;
  dedupeKey?: string;
  eventType: string;
  metadata?: Record<string, unknown>;
  notifyRoleCode?: string;
  severity?: SystemNoticeSeverity;
  source: string;
  summary?: string;
  title: string;
};

export interface SystemNoticePublisher {
  publishSystemNotice(input: SystemNoticePublishInput): Promise<string | null>;
}
