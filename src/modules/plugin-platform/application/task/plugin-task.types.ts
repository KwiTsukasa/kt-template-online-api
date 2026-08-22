export type PluginTaskRuntimeStatus =
  | 'disabled'
  | 'failed'
  | 'idle'
  | 'running'
  | 'scheduled';

export type PluginTaskRunStatus =
  | 'failed'
  | 'running'
  | 'skipped'
  | 'success';

export type PluginTaskTriggerType = 'bootstrap' | 'manual' | 'schedule';

export type PluginTaskPageQuery = {
  enabled?: boolean | string;
  pageNo?: number | string;
  pageSize?: number | string;
  pluginId?: string;
  pluginKey?: string;
  status?: PluginTaskRuntimeStatus;
  taskKey?: string;
};

export type PluginTaskRunPageQuery = {
  endTime?: string;
  pageNo?: number | string;
  pageSize?: number | string;
  startTime?: string;
  status?: PluginTaskRunStatus;
  triggerType?: PluginTaskTriggerType;
};
