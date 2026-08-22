export type BotScope = 'channel' | 'direct' | 'group';

export type BotInboundEnvelope = {
  adapterKey: string;
  conversationKey: string;
  eventKey: string;
  metadata: Record<string, unknown>;
  replyContext?: unknown;
  scope: BotScope;
  senderKey: string;
  text: string;
};

export type BotReplyIntent = {
  content: string;
  kind: 'text';
};

export type BotDeliveryRequest = {
  adapterContext?: unknown;
  connectionKey: string;
  conversationKey: string;
  intent: BotReplyIntent;
  replyContext?: unknown;
  scope: BotScope;
  targetKey: string;
};

export type BotDeliveryResult = {
  deliveryKey: string;
  deliveredAt: string;
  raw?: unknown;
};

export interface BotAdapterProtocol {
  readonly key: string;
  deliver(request: BotDeliveryRequest): Promise<BotDeliveryResult>;
  normalize(payload: unknown): Promise<BotInboundEnvelope[]>;
}
