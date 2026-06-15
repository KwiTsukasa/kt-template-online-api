export type RepeaterMessage = {
  channelId?: string;
  messageText: string;
  messageType: string;
  rawEvent: Record<string, any>;
  selfId: string;
  targetId: string;
  userId: string;
};

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
