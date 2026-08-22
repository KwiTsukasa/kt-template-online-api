import {
  BOT_PLUGIN_PROTOCOL,
  type BotPluginEventDispatchInput,
  type BotPluginOperationInput,
  type BotPluginOperationLookup,
  type BotPluginProtocol,
} from '@/modules/plugin-platform/contract/plugin-protocol';

export const PLUGIN_EXECUTION_PORT = BOT_PLUGIN_PROTOCOL;

export type PluginEventDispatchInput = BotPluginEventDispatchInput;
export type PluginExecutionInput = BotPluginOperationInput;
export type PluginOperationLookup = BotPluginOperationLookup;
export type PluginExecutionPort = BotPluginProtocol;
