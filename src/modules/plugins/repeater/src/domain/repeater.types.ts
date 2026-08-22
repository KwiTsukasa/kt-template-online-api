import type { BotPluginMessageEvent } from '@/modules/plugin-platform/contract/plugin-protocol';

export type RepeaterMessage = BotPluginMessageEvent;

export type RepeaterConversationState = {
  count: number;
  lastRepeatedAt?: number;
  lastText: string;
  repeatedText: string;
  updatedAt: number;
};

export type RepeaterManifest = {
  description?: string;
  events: Array<{
    description?: string;
    eventName: string;
    key: string;
    name: string;
  }>;
  name: string;
  pluginKey: string;
  version: string;
};
