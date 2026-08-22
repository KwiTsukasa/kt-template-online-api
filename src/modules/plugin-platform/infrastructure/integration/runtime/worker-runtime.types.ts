import type {
  PluginPackageDescriptor,
  PluginRuntimeConfigSnapshot,
} from '@/modules/plugin-platform/infrastructure/integration/package/plugin-package.types';

export type PluginWorkerRequestType =
  | 'activate'
  | 'deactivate'
  | 'dispose'
  | 'executeOperation'
  | 'executeTask'
  | 'handleEvent'
  | 'health'
  | 'load';

export type PluginRuntimeStatus =
  | 'active'
  | 'failed'
  | 'loaded'
  | 'stopped';

export type PluginSafeInputSummary = {
  fieldCount: number;
  keys: string[];
};

export type PluginWorkerRequest = {
  configSnapshot?: PluginRuntimeConfigSnapshot;
  correlationId: string;
  descriptor?: PluginPackageDescriptor;
  event?: unknown;
  eventKey?: string;
  installationId?: string;
  manifest?: unknown;
  operationId?: string;
  operationKey?: string;
  input?: unknown;
  pluginKey: string;
  safeInputSummary?: PluginSafeInputSummary;
  taskHandlerName?: string;
  taskId?: string;
  taskKey?: string;
  timeoutMs: number;
  triggerType?: 'bootstrap' | 'manual' | 'schedule';
  type: PluginWorkerRequestType;
};

export type PluginWorkerDriver = {
  dispose(): Promise<void>;
  request(message: PluginWorkerRequest): Promise<unknown>;
};

export type PluginWorkerRequestQueue = {
  close(): Promise<void>;
  handlesRequestTimeout?: boolean;
  queueWaitTimeoutMs?: number;
  request(message: PluginWorkerRequest): Promise<unknown>;
  reset(): Promise<void>;
};

export type PluginWorkerRuntimeOptions = {
  configSnapshot?: PluginRuntimeConfigSnapshot;
  defaultTimeoutMs: number;
  descriptor?: PluginPackageDescriptor;
  installationId: string;
  pluginKey: string;
};

export type PluginRuntimeEvent = {
  eventType: string;
  level: 'error' | 'info' | 'warn';
  pluginKey: string;
  safeSummary: Record<string, unknown>;
};

export type PluginRuntimeErrorCode =
  | 'PLUGIN_WORKER_CRASH'
  | 'PLUGIN_WORKER_TIMEOUT';

export type PluginOperationRequest = {
  input: Record<string, unknown>;
  operationId: string;
  operationKey: string;
  timeoutMs?: number;
};

export type PluginEventRequest = {
  event: Record<string, unknown>;
  eventKey: string;
  timeoutMs?: number;
};

export type PluginTaskRequest = {
  input: Record<string, unknown>;
  taskHandlerName: string;
  taskId: string;
  taskKey: string;
  timeoutMs?: number;
  triggerType: 'bootstrap' | 'manual' | 'schedule';
};
