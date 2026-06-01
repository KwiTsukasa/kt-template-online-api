export type QqbotConnectionMode = 'reverse-ws';

export type QqbotConnectionRole = 'API' | 'Event' | 'Universal';

export type QqbotConnectionStatus = 'offline' | 'online';

export type QqbotLoginScanMode = 'create' | 'refresh';

export type QqbotLoginScanStatus = 'error' | 'expired' | 'pending' | 'success';

export type QqbotMessageDirection = 'inbound' | 'outbound';

export type QqbotMessageType = 'channel' | 'group' | 'private';

export type QqbotNapcatContainerStatus =
  | 'creating'
  | 'error'
  | 'running'
  | 'stopped';

export type QqbotAccountNapcatBindStatus = 'bound' | 'disabled' | 'pending';

export type QqbotRuleMatchType = 'equals' | 'keyword' | 'regex';

export type QqbotRuleTargetType = 'all' | 'channel' | 'group' | 'private';

export type QqbotSendStatus = 'failed' | 'pending' | 'success';

export type QqbotPermissionTargetType = 'channel' | 'group' | 'private' | 'qq';

export type QqbotOneBotEvent = Record<string, any> & {
  channel_id?: number | string;
  group_id?: number | string;
  guild_id?: number | string;
  message?: any;
  message_id?: number | string;
  message_type?: string;
  post_type?: string;
  raw_message?: string;
  self_id?: number | string;
  sender?: Record<string, any>;
  time?: number;
  user_id?: number | string;
};

export type QqbotNormalizedMessage = {
  channelId?: string;
  eventTime: Date;
  groupId?: string;
  messageId: string;
  messageText: string;
  messageType: QqbotMessageType;
  rawEvent: QqbotOneBotEvent;
  rawMessage: string;
  selfId: string;
  senderNickname?: string;
  targetId: string;
  userId: string;
};

export type QqbotOneBotActionResponse = {
  data?: any;
  echo?: string;
  message?: string;
  retcode?: number;
  status?: string;
};
