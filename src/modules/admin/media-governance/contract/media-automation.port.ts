export const MEDIA_RSS_OPERATIONS = Symbol('MEDIA_RSS_OPERATIONS');
export const MEDIA_EXECUTION_OPERATIONS = Symbol('MEDIA_EXECUTION_OPERATIONS');
export interface MediaRssOperationsPort { pollDueSubscriptions: () => Promise<void>; }
export interface MediaExecutionOperationsPort { executionAvailable: () => boolean; reconcileExecutions: () => Promise<void>; }
