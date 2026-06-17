export type QqbotPluginTaskRuntimeStatus =
  | 'disabled'
  | 'failed'
  | 'idle'
  | 'running'
  | 'scheduled';

export type QqbotPluginTaskRunStatus =
  | 'failed'
  | 'running'
  | 'skipped'
  | 'success';

export type QqbotPluginTaskTriggerType = 'bootstrap' | 'manual' | 'schedule';

export type QqbotPluginTaskPageQuery = {
  enabled?: boolean | string;
  pageNo?: number | string;
  pageSize?: number | string;
  pluginId?: string;
  pluginKey?: string;
  status?: QqbotPluginTaskRuntimeStatus;
  taskKey?: string;
};

export type QqbotPluginTaskRunPageQuery = {
  endTime?: string;
  pageNo?: number | string;
  pageSize?: number | string;
  startTime?: string;
  status?: QqbotPluginTaskRunStatus;
  triggerType?: QqbotPluginTaskTriggerType;
};
