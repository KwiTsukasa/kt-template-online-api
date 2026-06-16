export type QqbotPluginWorkerRequestType =
  | 'activate'
  | 'deactivate'
  | 'dispose'
  | 'executeOperation'
  | 'handleEvent'
  | 'health'
  | 'load';

export type QqbotPluginRuntimeStatus =
  | 'active'
  | 'failed'
  | 'loaded'
  | 'stopped';

export type QqbotPluginSafeInputSummary = {
  fieldCount: number;
  keys: string[];
};

export type QqbotPluginWorkerRequest = {
  correlationId: string;
  event?: unknown;
  eventKey?: string;
  installationId?: string;
  manifest?: unknown;
  operationId?: string;
  operationKey?: string;
  input?: unknown;
  pluginKey: string;
  safeInputSummary?: QqbotPluginSafeInputSummary;
  timeoutMs: number;
  type: QqbotPluginWorkerRequestType;
};

export type QqbotPluginWorkerDriver = {
  dispose(): Promise<void>;
  request(message: QqbotPluginWorkerRequest): Promise<unknown>;
};

export type QqbotPluginWorkerRequestQueue = {
  close(): Promise<void>;
  request(message: QqbotPluginWorkerRequest): Promise<unknown>;
  reset(): Promise<void>;
};

export type QqbotPluginWorkerRuntimeOptions = {
  defaultTimeoutMs: number;
  installationId: string;
  pluginKey: string;
};

export type QqbotPluginRuntimeEvent = {
  eventType: string;
  level: 'error' | 'info' | 'warn';
  pluginKey: string;
  safeSummary: Record<string, unknown>;
};

export type QqbotPluginRuntimeErrorCode =
  | 'PLUGIN_WORKER_CRASH'
  | 'PLUGIN_WORKER_TIMEOUT';

export type QqbotPluginOperationRequest = {
  input: Record<string, unknown>;
  operationId: string;
  operationKey: string;
  timeoutMs?: number;
};

export type QqbotPluginEventRequest = {
  event: Record<string, unknown>;
  eventKey: string;
  timeoutMs?: number;
};
