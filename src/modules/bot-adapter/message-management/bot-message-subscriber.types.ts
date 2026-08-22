import type { BotConnectionMode } from '@/modules/bot-adapter/core/contract/bot.types';

export type BotMessageDeliveryStatus =
  | 'cancelled'
  | 'failed'
  | 'pending'
  | 'processing'
  | 'retry'
  | 'success'
  | 'superseded';

export type BotMessagePushTargetType = 'group' | 'private';

export interface BotMessagePublishTargetView {
  enabled: boolean;
  id: string;
  targetId: string;
  targetName: null | string;
  targetType: BotMessagePushTargetType;
}

export interface BotMessagePublishBindingView {
  available: boolean;
  createTime: string;
  enabled: boolean;
  id: string;
  invalidReasonCode: null | string;
  sourceKey: string;
  sourceName: string;
  subscriptionId: string;
  subscriptionName: string;
  targets: BotMessagePublishTargetView[];
  templates: Array<{
    id: string;
    name: string;
    sortOrder: number;
  }>;
  updateTime: string;
}

export interface BotMessagePublishTargetInput {
  targetId: string;
  targetName?: string;
  targetType: BotMessagePushTargetType;
}

export interface BotMessagePublishBindingInput {
  enabled: boolean;
  subscriptionId: string;
  targets: BotMessagePublishTargetInput[];
}

export interface BotMessagePushTargetOption {
  label: string;
  targetId: string;
  targetType: BotMessagePushTargetType;
}

export interface BotMessagePushTargetOptionsResponse {
  available: boolean;
  connectionMode: null | BotConnectionMode;
  manualEntry: boolean;
  options: BotMessagePushTargetOption[];
  reasonCode: null | string;
}
