export const NAPCAT_INSPECTION = Symbol('NAPCAT_INSPECTION');
export interface NapcatInspectionPort { inspectOffline: () => Promise<void>; }
