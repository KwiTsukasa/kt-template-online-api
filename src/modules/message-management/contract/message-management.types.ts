import type { EntityManager } from 'typeorm';

export type SystemMessageScalar = boolean | null | number | string;
export type SystemMessageFanoutStatus =
  | 'accepted'
  | 'completed'
  | 'deferred'
  | 'failed'
  | 'processing'
  | 'retry';
export type SystemMessageTemplateToken =
  | { kind: 'text'; value: string }
  | { key: string; kind: 'variable' };

export interface SystemMessageSourceVariableDefinition {
  description: string;
  example: string;
  key: string;
  label: string;
  type: 'boolean' | 'number' | 'string';
}
export interface SystemMessageSourceFieldDefinition {
  dependsOn?: string;
  key: string;
  label: string;
  optionCollection: string;
  required: boolean;
  type: 'select';
}
export interface SystemMessageSourceDefinition {
  description: string;
  displayName: string;
  sourceKey: string;
  subscriptionFields: SystemMessageSourceFieldDefinition[];
  variables: SystemMessageSourceVariableDefinition[];
  version: 1;
}
export interface SystemMessageSourceOptionDefinition {
  dependsOnValue?: string;
  disabled: boolean;
  disabledReasonCode: null | string;
  label: string;
  value: string;
}
export type SystemMessageSourceOptionsResponse = Record<
  string,
  SystemMessageSourceOptionDefinition[]
>;
export interface MessageSubscriptionView {
  createTime: string;
  enabled: boolean;
  id: string;
  invalidReasonCode: null | string;
  name: string;
  remark: null | string;
  sourceConfig: Record<string, string>;
  sourceKey: string;
  sourceName: string;
  sourceSummary: string;
  subscriberKey: string;
  subscriberName: string;
  templates: Array<{
    id: string;
    name: string;
    sortOrder: number;
  }>;
  updateTime: string;
  valid: boolean;
}
export interface MessageTemplateView {
  content: string;
  createTime: string;
  enabled: boolean;
  id: string;
  name: string;
  referenceCount: number;
  remark: null | string;
  sourceKey: string;
  sourceName: string;
  updateTime: string;
}
export interface MessageTemplatePreview {
  renderedMessage: string;
  variables: Record<string, boolean | number | string>;
}
export type SystemMessageDeliveryReadiness =
  | {
      reasonCode: null;
      status: 'ready';
      variables: Record<string, boolean | number | string>;
    }
  | {
      reasonCode: string;
      status: 'deferred';
      variables: Record<string, boolean | number | string>;
    }
  | {
      reasonCode: string;
      status: 'cancelled' | 'superseded';
      variables?: never;
    };

export interface SystemMessageSourceAdapter {
  readonly definition: SystemMessageSourceDefinition;
  eventResourceKey(payload: Record<string, SystemMessageScalar>): string;
  inspectSubscription(config: Record<string, unknown>): Promise<{
    invalidReasonCode: null | string;
    sourceSummary: string;
    valid: boolean;
  }>;
  listSubscriptionOptions(): Promise<SystemMessageSourceOptionsResponse>;
  normalizeSubscriptionConfig(input: unknown): Promise<{
    canonicalConfig: Record<string, string>;
    resourceKey: string;
    sourceSummary: string;
  }>;
  resolveDelivery(input: {
    eventPayload: Record<string, SystemMessageScalar>;
    subscriptionConfig: Record<string, unknown>;
  }): Promise<SystemMessageDeliveryReadiness>;
  subscriptionResourceKey(config: Record<string, unknown>): null | string;
  validateEventPayload(
    payload: Record<string, unknown>,
  ): Record<string, SystemMessageScalar>;
}

export interface SystemMessageEventInput {
  eventId: string;
  occurredAt: string;
  payload: Record<string, SystemMessageScalar>;
  resourceKey: string;
  sourceKey: string;
}
export const SYSTEM_MESSAGE_EVENT_STAGER = Symbol(
  'SYSTEM_MESSAGE_EVENT_STAGER',
);
export interface SystemMessageEventStager {
  stage(
    manager: EntityManager,
    input: SystemMessageEventInput,
  ): Promise<'accepted' | 'duplicate'>;
}
export const SYSTEM_MESSAGE_DELIVERY_COORDINATOR = Symbol(
  'SYSTEM_MESSAGE_DELIVERY_COORDINATOR',
);
export interface SystemMessageDeliveryCoordinator {
  notifyDependencyChanged(input: {
    dependencyKey: string;
    payload: Record<string, SystemMessageScalar>;
  }): Promise<void>;
  requestDrain(): void;
}

export interface MessageSubscriptionListQuery {
  enabled?: boolean;
  name?: string;
  pageNo?: number;
  pageSize?: number;
  sourceKey?: string;
  subscriberKey?: string;
  templateId?: string;
}
export interface MessageSubscriptionInput {
  enabled: boolean;
  name: string;
  remark?: string;
  sourceConfig: Record<string, unknown>;
  subscriberKey: string;
  templateIds: string[];
}
export interface MessageTemplateListQuery {
  enabled?: boolean;
  name?: string;
  pageNo?: number;
  pageSize?: number;
  sourceKey?: string;
}
export interface MessageTemplateInput {
  content: string;
  enabled: boolean;
  name: string;
  remark?: string;
  sourceKey: string;
}
export class SystemMessageContractError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'SystemMessageContractError';
  }
}

export const MESSAGE_MANAGEMENT_TABLE_CONTRACT = {
  event: [
    'id',
    'event_id',
    'source_key',
    'resource_key',
    'occurred_at',
    'payload',
    'fanout_status',
    'fanout_attempt_count',
    'next_fanout_at',
    'fanout_lease_until',
    'last_error_code',
    'last_error_message',
    'create_time',
    'update_time',
  ],
  subscription: [
    'id',
    'name',
    'subscriber_key',
    'template_binding_digest',
    'source_config',
    'source_config_digest',
    'active_key',
    'enabled',
    'remark',
    'is_deleted',
    'create_time',
    'update_time',
  ],
  subscriptionTemplate: ['subscription_id', 'template_id', 'sort_order'],
  template: [
    'id',
    'name',
    'source_key',
    'content',
    'enabled',
    'remark',
    'is_deleted',
    'create_time',
    'update_time',
  ],
} as const;
