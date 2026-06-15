import type {
  QqbotNormalizedMessage,
  QqbotPluginOperationSummary,
} from '../contract/qqbot.types';

export const QQBOT_PLUGIN_EXECUTION_PORT = Symbol(
  'QQBOT_PLUGIN_EXECUTION_PORT',
);

export type QqbotPluginOperationLookup = {
  operationKey?: string;
  pluginKey?: string;
};

export type QqbotPluginExecutionInput = {
  context?: Record<string, any>;
  input: Record<string, any>;
  operationKey: string;
  pluginKey: string;
};

export type QqbotPluginEventDispatchInput = {
  eventKey: 'message';
  message: QqbotNormalizedMessage;
};

export type QqbotPluginOperationListContext = {
  selfId?: string;
};

export interface QqbotPluginExecutionPort {
  dispatchEvent(input: QqbotPluginEventDispatchInput): Promise<boolean>;
  executeOperation(input: QqbotPluginExecutionInput): Promise<any>;
  getOperationByCommand(
    command: QqbotPluginOperationLookup,
  ): Promise<null | QqbotPluginOperationSummary>;
  listActiveOperations(
    context?: QqbotPluginOperationListContext,
  ): Promise<QqbotPluginOperationSummary[]>;
}
