import type { EntityManager } from 'typeorm';

export type SystemMessageScalar = boolean | null | number | string;
export type SystemMessageFanoutStatus = 'accepted' | 'completed' | 'failed' | 'processing' | 'retry';
export type SystemMessageDeliveryStatus = 'cancelled' | 'failed' | 'pending' | 'processing' | 'retry' | 'success' | 'superseded' | 'waiting_ddns';
export type QqbotMessagePushTargetType = 'group' | 'private';
export type SystemMessageTemplateToken = { kind: 'text'; value: string } | { key: string; kind: 'variable' };

export interface SystemMessageSourceVariableDefinition { description: string; example: string; key: string; label: string; type: 'boolean' | 'number' | 'string'; }
export interface SystemMessageSourceFieldDefinition { dependsOn?: string; key: string; label: string; optionCollection: 'ddnsRecords' | 'portForwards'; required: true; type: 'select'; }
export interface SystemMessageSourceDefinition { description: string; displayName: string; sourceKey: string; subscriptionFields: SystemMessageSourceFieldDefinition[]; variables: SystemMessageSourceVariableDefinition[]; version: 1; }
export interface StunMappingPortChangedSubscriptionConfig { ddnsRecordId: string; portForwardId: string; }
export interface StunMappingPortChangedOptionsResponse { ddnsRecords: Array<{ disabledReasonCode: null | string; eligible: boolean; fqdn: string; id: string; name: string; portForwardId: string; }>; portForwards: Array<{ disabledReasonCode: null | string; eligible: boolean; externalPort: number; id: string; internalPort: number; name: string; protocol: 'tcp' | 'udp'; }>; }

export interface MessageSubscriptionView { createTime: string; enabled: boolean; id: string; invalidReasonCode: null | string; name: string; remark: null | string; sourceConfig: StunMappingPortChangedSubscriptionConfig; sourceKey: string; sourceName: string; sourceSummary: string; updateTime: string; valid: boolean; }
export interface MessageTemplateView { content: string; createTime: string; enabled: boolean; id: string; name: string; referenceCount: number; remark: null | string; sourceKey: string; sourceName: string; updateTime: string; }
export interface MessageTemplatePreview { renderedMessage: string; variables: Record<string, boolean | number | string>; }
export interface QqbotMessagePublishTargetView { enabled: boolean; id: string; targetId: string; targetName: null | string; targetType: QqbotMessagePushTargetType; }
export interface QqbotMessagePublishBindingView { available: boolean; createTime: string; enabled: boolean; id: string; invalidReasonCode: null | string; sourceKey: string; sourceName: string; subscriptionId: string; subscriptionName: string; targets: QqbotMessagePublishTargetView[]; templateId: string; templateName: string; updateTime: string; }

export type SystemMessageDeliveryReadiness =
  | { reasonCode: null; status: 'ready'; variables: Record<string, boolean | number | string>; }
  | { reasonCode: 'ddns_not_synced'; status: 'waiting_ddns'; variables: Record<string, boolean | number | string>; }
  | { reasonCode: string; status: 'cancelled' | 'superseded'; variables?: never; };

export interface SystemMessageSourceAdapter {
  readonly definition: SystemMessageSourceDefinition;
  /**
   * 检查订阅配置当前是否仍可用。
   * @param config - 待检查的来源配置。
   * @returns 有效性、稳定错误码与可展示的来源摘要；不写入状态。
   */
  inspectSubscription(config: Record<string, unknown>): Promise<{ invalidReasonCode: null | string; sourceSummary: string; valid: boolean; }>;
  /**
   * 列出创建或编辑订阅时可选择的来源资源。
   * @returns 来源专属的候选项快照；不创建订阅或事务状态。
   */
  listSubscriptionOptions(): Promise<Record<string, unknown>>;
  /**
   * 规范化并验证用户提交的订阅配置。
   * @param input - 未信任的订阅配置输入。
   * @returns 可持久化的规范配置、资源键及来源摘要；调用方在事务中保存返回值。
   */
  normalizeSubscriptionConfig(input: unknown): Promise<{ canonicalConfig: Record<string, string>; resourceKey: string; sourceSummary: string; }>;
  /**
   * 根据事件和订阅配置重新计算一次投递就绪状态。
   * @param input - 冻结的事件载荷及当前订阅配置。
   * @returns 可发送变量、等待 DDNS 或取消/被取代状态；不直接发送消息。
   */
  resolveDelivery(input: { eventPayload: Record<string, SystemMessageScalar>; subscriptionConfig: Record<string, unknown>; }): Promise<SystemMessageDeliveryReadiness>;
  /**
   * 校验并收窄生产者事件载荷至允许的标量值。
   * @param payload - 来自系统事件的未验证载荷。
   * @returns 可安全写入 Outbox 的规范化标量载荷；非法输入抛出稳定契约错误。
   */
  validateEventPayload(payload: Record<string, unknown>): Record<string, SystemMessageScalar>;
}

export interface SystemMessageEventInput { eventId: string; occurredAt: string; payload: Record<string, SystemMessageScalar>; resourceKey: string; sourceKey: string; }
export const SYSTEM_MESSAGE_EVENT_STAGER = Symbol('SYSTEM_MESSAGE_EVENT_STAGER');
export interface SystemMessageEventStager {
  /**
   * 在调用方事务中幂等写入一条系统消息 Outbox 事件。
   * @param manager - 当前事务的实体管理器；不得替换为独立连接。
   * @param input - 已验证的事件标识、来源、资源和标量载荷。
   * @returns 新事件为 `accepted`，相同事件 ID 已存在时为 `duplicate`；不在事务内唤醒或发送消息。
   */
  stage(manager: EntityManager, input: SystemMessageEventInput): Promise<'accepted' | 'duplicate'>;
}
export const SYSTEM_MESSAGE_DELIVERY_COORDINATOR = Symbol('SYSTEM_MESSAGE_DELIVERY_COORDINATOR');
export interface SystemMessageDeliveryCoordinator {
  /**
   * 在 DDNS 同步提交后通知协调器重新评估等待中的投递。
   * @param input - 已应用地址及对应 DDNS 记录 ID。
   * @returns 唤醒请求已被接收；实现应在提交后异步合并 drain，不在调用事务内发送消息。
   */
  notifyDdnsSynced(input: { appliedAddress: string; ddnsRecordId: string; }): Promise<void>;
  /**
   * 请求一次可合并的异步投递 drain。
   * @returns 无返回值；实现会安排 worker 唤醒，不保证本调用完成任何发送。
   */
  requestDrain(): void;
}

export interface MessageSubscriptionListQuery { enabled?: boolean; name?: string; pageNo?: number; pageSize?: number; sourceKey?: string; }
export interface MessageSubscriptionInput { enabled: boolean; name: string; remark?: string; sourceConfig: Record<string, unknown>; sourceKey: string; }
export interface MessageTemplateListQuery { enabled?: boolean; name?: string; pageNo?: number; pageSize?: number; sourceKey?: string; }
export interface MessageTemplateInput { content: string; enabled: boolean; name: string; remark?: string; sourceKey: string; }
export interface QqbotMessagePublishTargetInput { targetId: string; targetName?: string; targetType: QqbotMessagePushTargetType; }
export interface QqbotMessagePublishBindingInput { enabled: boolean; subscriptionId: string; targets: QqbotMessagePublishTargetInput[]; templateId: string; }
export interface QqbotMessagePushTargetOption { label: string; targetId: string; targetType: QqbotMessagePushTargetType; }
export interface QqbotMessagePushTargetOptionsResponse { available: boolean; options: QqbotMessagePushTargetOption[]; reasonCode: null | string; }
export interface StrictPlainTextSendInput { attemptNumber: number; deliveryId: string; message: string; selfId: string; targetId: string; targetType: QqbotMessagePushTargetType; }
export interface QqbotSendAttemptErrorOptions { code: string; message: string; retryable: boolean; sendLogId: null | string; }

export class SystemMessageContractError extends Error {
  /** Creates a stable, non-sensitive domain contract error. */
  constructor(public readonly code: string) { super(code); this.name = 'SystemMessageContractError'; }
}

export const QQBOT_MESSAGE_PUSH_TABLE_CONTRACT = {
  binding: ['id', 'subscription_id', 'account_id', 'self_id', 'template_id', 'active_key', 'enabled', 'is_deleted', 'create_time', 'update_time'],
  delivery: ['id', 'message_event_id', 'publish_target_id', 'binding_id', 'subscription_id', 'self_id', 'target_type', 'target_id', 'template_id', 'template_content', 'variable_snapshot', 'rendered_message', 'status', 'attempt_count', 'next_attempt_at', 'processing_lease_until', 'send_log_id', 'last_error_code', 'last_error_message', 'expires_at', 'create_time', 'update_time'],
  event: ['id', 'event_id', 'source_key', 'resource_key', 'occurred_at', 'payload', 'fanout_status', 'fanout_attempt_count', 'next_fanout_at', 'fanout_lease_until', 'last_error_code', 'last_error_message', 'create_time', 'update_time'],
  subscription: ['id', 'name', 'source_key', 'source_config', 'source_config_digest', 'active_key', 'enabled', 'remark', 'is_deleted', 'create_time', 'update_time'],
  target: ['id', 'binding_id', 'target_type', 'target_id', 'target_name', 'active_key', 'enabled', 'is_deleted', 'create_time', 'update_time'],
  template: ['id', 'name', 'source_key', 'content', 'enabled', 'remark', 'is_deleted', 'create_time', 'update_time'],
} as const;
