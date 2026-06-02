import type {
  QqbotNormalizedMessage,
  QqbotPluginHealthStatus,
} from '../qqbot.types';
import type { QqbotCommand } from '../command/qqbot-command.entity';

export type QqbotPluginHealth = {
  checkedAt: string;
  message?: string;
  name?: string;
  pluginKey?: string;
  status: QqbotPluginHealthStatus;
  triggerMode?: QqbotPluginTriggerMode;
};

export type QqbotPluginTriggerMode = 'command' | 'event';

export type QqbotPluginOperationContext = {
  args?: Record<string, any>;
  command?: QqbotCommand;
  message?: QqbotNormalizedMessage;
};

export type QqbotPluginOperation<Input = any, Output = any> = {
  cacheTtlMs?: number;
  description?: string;
  inputSchema?: Record<string, any>;
  key: string;
  name: string;
  outputSchema?: Record<string, any>;
  execute: (
    input: Input,
    context: QqbotPluginOperationContext,
  ) => Promise<Output>;
};

export type QqbotIntegrationPlugin = {
  description?: string;
  healthCheck?: () => Promise<QqbotPluginHealth>;
  key: string;
  name: string;
  operations: QqbotPluginOperation[];
  version: string;
};

export type QqbotEventPluginSummary = {
  accountName?: string;
  bound: boolean;
  connectStatus?: string;
  description?: string;
  key: string;
  name: string;
  remark?: string;
  selfId: string;
  triggerType: 'message';
  version: string;
};

export type QqbotEventPluginDefinition = {
  description?: string;
  key: string;
  name: string;
  remark?: string;
  triggerType: 'message';
  version: string;
};

export type QqbotPluginSummary = {
  description?: string;
  key: string;
  name: string;
  operationCount: number;
  triggerMode: QqbotPluginTriggerMode;
  version: string;
};

export type QqbotPluginOperationSummary = {
  cacheTtlMs?: number;
  description?: string;
  inputSchema?: Record<string, any>;
  key: string;
  name: string;
  outputSchema?: Record<string, any>;
  pluginKey: string;
  triggerMode: QqbotPluginTriggerMode;
};
