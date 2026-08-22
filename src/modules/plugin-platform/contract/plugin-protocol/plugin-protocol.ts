export const BOT_PLUGIN_PROTOCOL = Symbol('BOT_PLUGIN_PROTOCOL');

export type BotConversationScope = 'channel' | 'direct' | 'group';
export type BotPluginTriggerMode = 'command' | 'event';

export type BotPluginHealth = {
  checkedAt: string;
  message?: string;
  name?: string;
  pluginKey?: string;
  status: 'degraded' | 'healthy' | 'offline';
  triggerMode?: BotPluginTriggerMode;
};

export type BotPluginSummary = {
  description?: string;
  key: string;
  name: string;
  operationCount: number;
  triggerMode: BotPluginTriggerMode;
  version: string;
};

export type BotEventPluginDefinition = {
  description?: string;
  key: string;
  name: string;
  remark?: string;
  triggerType: 'message';
  version: string;
};

export type BotPluginMessageEvent = {
  conversationKey: string;
  eventId: string;
  isSelf: boolean;
  links: string[];
  metadata: Record<string, unknown>;
  rawText: string;
  scope: BotConversationScope;
  senderKey: string;
  text: string;
};

export type BotPluginReplyIntent = {
  content: string;
  kind: 'text';
};

export type BotPluginEventResult = {
  handled: boolean;
  replies: BotPluginReplyIntent[];
};

export type BotPluginEventDispatchInput = {
  event: BotPluginMessageEvent;
  eventKey: 'message';
  pluginKeys: string[];
};

export type BotPluginOperationLookup = {
  operationKey?: string;
  pluginKey?: string;
};

export type BotPluginOperationInput = {
  context?: Record<string, unknown>;
  input: Record<string, unknown>;
  operationKey: string;
  pluginKey: string;
};

export type BotPluginOperationSummary = {
  aliases?: string[];
  description?: string;
  inputSchema?: Record<string, unknown>;
  key: string;
  name: string;
  outputSchema?: Record<string, unknown>;
  pluginKey: string;
  triggerMode: 'command' | 'event';
};

export type BotPluginOperationContext = {
  input?: Record<string, unknown>;
};

export type BotPluginOperation = {
  aliases?: string[];
  cacheTtlMs?: number;
  description?: string;
  execute: (
    input: Record<string, unknown>,
    context: BotPluginOperationContext,
  ) => Promise<unknown>;
  inputSchema?: Record<string, unknown>;
  key: string;
  name: string;
  outputSchema?: Record<string, unknown>;
  timeoutMs?: number;
};

export type BotIntegrationPlugin = {
  activate?: () => Promise<unknown> | unknown;
  description?: string;
  healthCheck?: () => Promise<BotPluginHealth>;
  key: string;
  legacyKeys?: string[];
  name: string;
  operations: BotPluginOperation[];
  version: string;
};

export interface BotPluginProtocol {
  dispatchEvent(
    input: BotPluginEventDispatchInput,
  ): Promise<BotPluginEventResult>;
  executeOperation(input: BotPluginOperationInput): Promise<unknown>;
  getOperationByCommand(
    command: BotPluginOperationLookup,
  ): Promise<BotPluginOperationSummary | null>;
  listActiveOperations(): Promise<BotPluginOperationSummary[]>;
  listPlugins(): Promise<BotPluginSummary[]>;
}
