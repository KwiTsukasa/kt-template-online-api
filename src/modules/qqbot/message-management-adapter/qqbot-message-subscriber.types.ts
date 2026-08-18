export type QqbotMessageDeliveryStatus =
  | 'cancelled'
  | 'failed'
  | 'pending'
  | 'processing'
  | 'retry'
  | 'success'
  | 'superseded';

export type QqbotMessagePushTargetType = 'group' | 'private';

export interface QqbotMessagePublishTargetView {
  enabled: boolean;
  id: string;
  targetId: string;
  targetName: null | string;
  targetType: QqbotMessagePushTargetType;
}

export interface QqbotMessagePublishBindingView {
  available: boolean;
  createTime: string;
  enabled: boolean;
  id: string;
  invalidReasonCode: null | string;
  sourceKey: string;
  sourceName: string;
  subscriptionId: string;
  subscriptionName: string;
  targets: QqbotMessagePublishTargetView[];
  templates: Array<{
    id: string;
    name: string;
    sortOrder: number;
  }>;
  updateTime: string;
}

export interface QqbotMessagePublishTargetInput {
  targetId: string;
  targetName?: string;
  targetType: QqbotMessagePushTargetType;
}

export interface QqbotMessagePublishBindingInput {
  enabled: boolean;
  subscriptionId: string;
  targets: QqbotMessagePublishTargetInput[];
}

export interface QqbotMessagePushTargetOption {
  label: string;
  targetId: string;
  targetType: QqbotMessagePushTargetType;
}

export interface QqbotMessagePushTargetOptionsResponse {
  available: boolean;
  options: QqbotMessagePushTargetOption[];
  reasonCode: null | string;
}
