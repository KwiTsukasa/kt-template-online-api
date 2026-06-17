import type {
  QqbotPluginPackageDescriptor,
  QqbotPluginRuntimeConfigSnapshot,
} from '@/modules/qqbot/plugin-platform/infrastructure/integration/package/plugin-package.types';

export type QqbotPluginWorkerRequestType =
  | 'activate'
  | 'deactivate'
  | 'dispose'
  | 'executeOperation'
  | 'executeTask'
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
  configSnapshot?: QqbotPluginRuntimeConfigSnapshot;
  correlationId: string;
  descriptor?: QqbotPluginPackageDescriptor;
  event?: unknown;
  eventKey?: string;
  installationId?: string;
  manifest?: unknown;
  operationId?: string;
  operationKey?: string;
  input?: unknown;
  pluginKey: string;
  safeInputSummary?: QqbotPluginSafeInputSummary;
  taskHandlerName?: string;
  taskId?: string;
  taskKey?: string;
  timeoutMs: number;
  triggerType?: 'bootstrap' | 'manual' | 'schedule';
  type: QqbotPluginWorkerRequestType;
};

export type QqbotPluginWorkerDriver = {
  dispose(): Promise<void>;
  request(message: QqbotPluginWorkerRequest): Promise<unknown>;
};

export type QqbotPluginWorkerRequestQueue = {
  close(): Promise<void>;
  handlesRequestTimeout?: boolean;
  queueWaitTimeoutMs?: number;
  request(message: QqbotPluginWorkerRequest): Promise<unknown>;
  reset(): Promise<void>;
};

export type QqbotPluginWorkerRuntimeOptions = {
  defaultTimeoutMs: number;
  descriptor?: QqbotPluginPackageDescriptor;
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

export type QqbotPluginTaskRequest = {
  input: Record<string, unknown>;
  taskHandlerName: string;
  taskId: string;
  taskKey: string;
  timeoutMs?: number;
  triggerType: 'bootstrap' | 'manual' | 'schedule';
};
