export const BPMN_ROUTING = {
  executeCompleted: 'execute.completed',
  activityInstanceEnter: 'activity.instance.enter',
  activityEnter: 'activity.enter',
  activityLeave: 'activity.leave',
  activityInstanceLeave: 'activity.instance.leave',
  activityEnd: 'activity.end',
  executeOutboundTake: 'execute.outbound.take',
  executeError: 'execute.error',
  executionDiscardDetached: 'execution.discard.detached',
  executeCompensating: 'execute.compensating',
  activityAll: 'activity.#',
  executeDiscard: 'execute.discard',
  activityCompensate: 'activity.compensate',
  executeLegacyRunning: 'execute.legacy.running',
  executeLegacyCompleted: 'execute.legacy.completed',
  executeStart: 'execute.start',
  executeConcurrent: 'execute.concurrent',
  activityError: 'activity.error',
  activityDiscard: 'activity.discard',
  activityExecutionStart: 'activity.execution.start',
  activityWait: 'activity.wait',
  executeRepeat: 'execute.repeat',
  activityCatch: 'activity.catch',
  engineError: 'engine.error',
  activityPrefix: 'activity.',
  processTerminate: 'process.terminate',
  flowTake: 'flow.take',
} as const;
export const BPMN_QUEUE = {
  inbound: 'inbound-q',
} as const;
export const BPMN_EXCHANGE = {
  event: 'event',
  execution: 'execution',
  api: 'api',
  format: 'format',
} as const;

export const BPMN_TRACKED_EVENTS: ReadonlySet<string> = new Set([
  BPMN_ROUTING.activityEnter,
  BPMN_ROUTING.activityWait,
  BPMN_ROUTING.activityEnd,
  BPMN_ROUTING.activityDiscard,
  BPMN_ROUTING.activityError,
  BPMN_ROUTING.activityCatch,
  BPMN_ROUTING.processTerminate,
  BPMN_ROUTING.flowTake,
]);
