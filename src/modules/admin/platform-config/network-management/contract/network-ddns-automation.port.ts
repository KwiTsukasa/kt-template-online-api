export const NETWORK_DDNS_OPERATIONS = Symbol('NETWORK_DDNS_OPERATIONS');
export interface NetworkDdnsOperationsPort { reconcileNow: () => Promise<void>; }
