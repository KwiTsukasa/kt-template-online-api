export const RUN_STATUS = {
  pending: 'pending',
  starting: 'starting',
  running: 'running',
  waiting: 'waiting',
  succeeded: 'succeeded',
  failed: 'failed',
  cancelled: 'cancelled',
  skipped: 'skipped',
  unconfirmed: 'unconfirmed',
} as const;

export const RUN_STATUS_GROUP = {
  workflowOpen: [
    RUN_STATUS.pending,
    RUN_STATUS.running,
    RUN_STATUS.waiting,
  ] as readonly string[],
  taskOpen: [RUN_STATUS.pending, RUN_STATUS.running] as readonly string[],
  activityOpen: [RUN_STATUS.pending, RUN_STATUS.waiting] as readonly string[],
  terminal: [
    RUN_STATUS.succeeded,
    RUN_STATUS.failed,
    RUN_STATUS.cancelled,
  ] as readonly string[],
  settled: [RUN_STATUS.succeeded, RUN_STATUS.failed] as readonly string[],
  executingScript: [
    RUN_STATUS.running,
    RUN_STATUS.unconfirmed,
  ] as readonly string[],
  unsuccessful: [RUN_STATUS.failed, RUN_STATUS.cancelled] as readonly string[],
  occurrenceOpen: [
    RUN_STATUS.pending,
    RUN_STATUS.starting,
    RUN_STATUS.running,
  ] as readonly string[],
  occurrenceDispatchable: [
    RUN_STATUS.pending,
    RUN_STATUS.starting,
  ] as readonly string[],
  occurrenceLaunched: [
    RUN_STATUS.starting,
    RUN_STATUS.running,
  ] as readonly string[],
} as const;
