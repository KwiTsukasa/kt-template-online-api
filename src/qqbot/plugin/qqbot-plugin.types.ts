import type {
  QqbotNormalizedMessage,
  QqbotPluginHealthStatus,
} from '../qqbot.types';
import type { QqbotCommand } from '../command/qqbot-command.entity';

export type QqbotPluginHealth = {
  checkedAt: string;
  message?: string;
  status: QqbotPluginHealthStatus;
};

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

export type QqbotPluginSummary = {
  description?: string;
  key: string;
  name: string;
  operationCount: number;
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
};
