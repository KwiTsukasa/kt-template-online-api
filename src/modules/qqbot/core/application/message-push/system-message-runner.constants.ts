/** Maximum due Outbox rows claimed by one fan-out scan. */
export const SYSTEM_MESSAGE_BATCH_SIZE = 50;
/** Duration of an exclusive fan-out claim lease. */
export const SYSTEM_MESSAGE_LEASE_MS = 30_000;
/** Initial fan-out retry delay. */
export const SYSTEM_MESSAGE_RETRY_BASE_MS = 10_000;
/** Maximum fan-out retry delay. */
export const SYSTEM_MESSAGE_RETRY_MAX_MS = 15 * 60_000;
/** Maximum age of an Outbox event that may create new deliveries. */
export const SYSTEM_MESSAGE_RETRY_WINDOW_MS = 24 * 60 * 60_000;
/** Persistent DDNS recheck interval for newly frozen waiting deliveries. */
export const SYSTEM_MESSAGE_DDNS_RECHECK_MS = 60_000;
/** Future coordinator scan cadence. */
export const SYSTEM_MESSAGE_SCAN_INTERVAL_MS = 5_000;
