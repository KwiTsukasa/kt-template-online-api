import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtDateTimeColumn,
  KtUpdateDateColumn,
} from '@/common';
import type {
  LlmConnectionStatus,
  LlmConversationScene,
  LlmMessageRole,
  LlmMessageStatus,
  LlmProvider,
  LlmTokenUsage,
} from '../../contract/llm.types';

@Entity('admin_llm_config')
@Index('idx_admin_llm_config_list', ['isDeleted', 'enabled', 'provider'])
export class AdminLlmConfigEntity {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ length: 100 })
  name: string;

  @Column({ length: 32 })
  provider: LlmProvider;

  @Column({ length: 1000, name: 'base_url' })
  baseUrl: string;

  @Column({
    name: 'api_key_secret',
    nullable: true,
    select: false,
    type: 'text',
  })
  apiKeySecret: null | string;

  @Column({ default: true })
  enabled: boolean;

  @Column({ default: false, name: 'is_default' })
  isDefault: boolean;

  @Column({ default: 'untested', length: 16, name: 'connection_status' })
  connectionStatus: LlmConnectionStatus;

  @Column({ name: 'first_token_latency_ms', nullable: true, type: 'int' })
  firstTokenLatencyMs: null | number;

  @KtDateTimeColumn({ name: 'last_tested_at', nullable: true })
  lastTestedAt: KtDateTime | null;

  @Column({ length: 500, name: 'last_error_message', nullable: true })
  lastErrorMessage: null | string;

  @Column({ default: false, name: 'is_deleted' })
  isDeleted: boolean;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}

@Entity('admin_llm_conversation')
@Index('idx_admin_llm_conversation_list', [
  'configId',
  'isDeleted',
  'lastMessageAt',
])
@Index('uk_admin_llm_conversation_scene_ref', ['scene', 'sceneRefId'], {
  unique: true,
})
export class AdminLlmConversationEntity {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'config_id', type: 'bigint' })
  configId: string;

  @Column({ length: 200 })
  title: string;

  @Column({ length: 200, name: 'selected_model', nullable: true })
  selectedModel: null | string;

  @Column({ length: 64, name: 'selected_reasoning_effort', nullable: true })
  selectedReasoningEffort: null | string;

  @Column({ length: 64, name: 'selected_service_tier', nullable: true })
  selectedServiceTier: null | string;

  @Column({ default: 'general', length: 32 })
  scene: LlmConversationScene;

  @Column({ length: 96, name: 'scene_ref_id', nullable: true })
  sceneRefId: null | string;

  @Column({ length: 128, name: 'provider_thread_id', nullable: true })
  providerThreadId: null | string;

  @Column({ length: 96, name: 'active_turn_id', nullable: true })
  activeTurnId: null | string;

  @KtDateTimeColumn({ name: 'active_turn_started_at', nullable: true })
  activeTurnStartedAt: KtDateTime | null;

  @Column({ default: 0, name: 'message_count', type: 'int' })
  messageCount: number;

  @KtDateTimeColumn({ name: 'last_message_at', nullable: true })
  lastMessageAt: KtDateTime | null;

  @Column({ default: false, name: 'is_deleted' })
  isDeleted: boolean;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}

@Entity('admin_llm_message')
@Index('uk_admin_llm_message_sequence', ['conversationId', 'sequence'], {
  unique: true,
})
@Index(
  'uk_admin_llm_message_client_id',
  ['conversationId', 'clientMessageId'],
  { unique: true },
)
export class AdminLlmMessageEntity {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'conversation_id', type: 'bigint' })
  conversationId: string;

  @Column({ length: 96, name: 'client_message_id', nullable: true })
  clientMessageId: null | string;

  @Column({ length: 16 })
  role: LlmMessageRole;

  @Column({ length: 200, nullable: true })
  model: null | string;

  @Column({ type: 'longtext' })
  content: string;

  @Column({ name: 'reasoning_content', nullable: true, type: 'longtext' })
  reasoningContent: null | string;

  @Column({ length: 16 })
  status: LlmMessageStatus;

  @Column({ length: 64, name: 'finish_reason', nullable: true })
  finishReason: null | string;

  @Column({ nullable: true, type: 'simple-json' })
  usage: LlmTokenUsage | null;

  @Column({ nullable: true, type: 'simple-json' })
  metadata: null | Record<string, unknown>;

  @Column({ type: 'int' })
  sequence: number;

  @Column({ length: 500, name: 'error_message', nullable: true })
  errorMessage: null | string;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
