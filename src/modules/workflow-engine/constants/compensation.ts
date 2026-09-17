export const COMPENSATION_SCOPE_QUEUE = 'kt-compensation-scope-q';
export const COMPENSATION_BOUNDARY_QUEUE = 'compensate-q';
export const COMPENSATION_ORDER_RADIX = 256;
export const COMPENSATION_ORDER_PASSES = 7;

export const COMPENSATION_PHASE = {
  initializing: 'initializing',
  ready: 'ready',
  dispatching: 'dispatching',
  waiting: 'waiting',
  closed: 'closed',
} as const;
export const COMPENSATION_SUBSCRIPTION = {
  prefix: '_kt-compensation',
  controlPriority: 400,
  handlerPriority: 500,
  stopCommands: new Set<string>([
    'stop',
    'discard',
    'cancel',
  ]) as ReadonlySet<string>,
} as const;
