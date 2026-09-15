import type { PluginTaskManifest } from '../domain/manifest';

export type PluginTaskInvocationTrigger =
  | 'bootstrap'
  | 'manual'
  | 'schedule'
  | 'event'
  | 'workflow';
export type PluginTaskCapabilities = {
  installationId: string;
  pluginId: string;
  versionId: string;
  active: boolean;
  tasks: PluginTaskManifest[];
};
export type PluginTaskInvocation = {
  installationId: string;
  pluginId: string;
  versionId?: string;
  taskHandlerName: string;
  taskId: string;
  taskKey: string;
  input: Record<string, unknown>;
  timeoutMs: number;
  triggerType: PluginTaskInvocationTrigger;
};
export const PLUGIN_TASK_CAPABILITIES = Symbol('PLUGIN_TASK_CAPABILITIES');
export const PLUGIN_TASK_EXECUTION = Symbol('PLUGIN_TASK_EXECUTION');
export interface PluginTaskCapabilityPort {
  list: () => PluginTaskCapabilities[];
  subscribe: (
    listener: (snapshot: PluginTaskCapabilities) => void,
  ) => () => void;
}
export interface PluginTaskExecutionPort {
  executeTask: (input: PluginTaskInvocation) => Promise<unknown>;
}
