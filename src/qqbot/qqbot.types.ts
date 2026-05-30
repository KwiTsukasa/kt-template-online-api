export type QqbotConnectionMode = 'reverse-ws';

export type QqbotConnectionRole = 'API' | 'Event' | 'Universal';

export type QqbotConnectionStatus = 'offline' | 'online';

export type QqbotMessageDirection = 'inbound' | 'outbound';

export type QqbotMessageType = 'group' | 'private';

export type QqbotRuleMatchType = 'equals' | 'keyword' | 'regex';

export type QqbotRuleTargetType = 'all' | 'group' | 'private';

export type QqbotSendStatus = 'failed' | 'pending' | 'success';

export type QqbotPermissionTargetType = 'all' | 'group' | 'private';

export type QqbotOneBotEvent = Record<string, any> & {
  group_id?: number | string;
  message?: any;
  message_id?: number | string;
  message_type?: QqbotMessageType;
  post_type?: string;
  raw_message?: string;
  self_id?: number | string;
  sender?: Record<string, any>;
  time?: number;
  user_id?: number | string;
};

export type QqbotNormalizedMessage = {
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
