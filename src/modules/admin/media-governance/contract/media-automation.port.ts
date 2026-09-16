export const MEDIA_RSS_OPERATIONS = Symbol('MEDIA_RSS_OPERATIONS');
export interface MediaRssOperationsPort { pollDueSubscriptions: () => Promise<void>; }
