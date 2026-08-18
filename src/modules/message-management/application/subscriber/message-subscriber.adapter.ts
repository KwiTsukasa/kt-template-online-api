import type { EntityManager } from 'typeorm';

export interface MessageSubscriberDefinition {
  description: string;
  displayName: string;
  subscriberKey: string;
  version: 1;
}

export interface UnifiedMessageReference {
  eventId: string;
  messageEventId: string;
  occurredAt: Date;
  resourceKey: string;
  sourceKey: string;
  subscriberKey: string;
  subscriptionId: string;
}

export interface UnifiedMessageTemplate {
  renderedMessage: string;
  sortOrder: number;
  templateContent: string;
  templateId: string;
  templateName: string;
}

export interface UnifiedMessageEnvelope extends UnifiedMessageReference {
  supersededMessageEventIds: string[];
  templates: UnifiedMessageTemplate[];
  variables: Record<string, boolean | number | string>;
}

export interface MessageSubscriberReceipt {
  afterCommit?: () => Promise<void> | void;
}

export type MessageSubscriberInput =
  | {
      lifecycle: 'cancel';
      manager: EntityManager;
      message: UnifiedMessageReference;
      now: Date;
    }
  | {
      lifecycle: 'supersede';
      manager: EntityManager;
      message: UnifiedMessageReference;
      now: Date;
    }
  | {
      lifecycle: 'deliver';
      manager: EntityManager;
      message: UnifiedMessageEnvelope;
      now: Date;
    };

export interface MessageSubscriberSubscriptionCancellation {
  includeProcessing: boolean;
  subscriptionId: string;
}

export interface MessageSubscriberAdapter {
  readonly definition: MessageSubscriberDefinition;
  cancelSubscriptionDeliveries(
    manager: EntityManager,
    input: MessageSubscriberSubscriptionCancellation,
  ): Promise<void>;
  hasSubscriptionReferences(
    manager: EntityManager,
    subscriptionId: string,
  ): Promise<boolean>;
  receive(
    input: MessageSubscriberInput,
  ): Promise<MessageSubscriberReceipt | void>;
  runOnce(now: Date): Promise<number>;
}
