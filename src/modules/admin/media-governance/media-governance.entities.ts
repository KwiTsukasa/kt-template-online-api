import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { KtCreateDateColumn, KtDateTime, KtUpdateDateColumn } from '@/common';

@Entity('media_governance_task')
export class MediaGovernanceTaskEntity {
  @PrimaryColumn({ length: 96, type: 'varchar' })
  id: string;

  @Index({ unique: true })
  @Column({ length: 96, name: 'work_item_id', nullable: true, type: 'varchar' })
  workItemId: null | string;

  @Column({ length: 200, name: 'title_hint', type: 'varchar' })
  titleHint: string;

  @Column({ length: 24, name: 'media_type', type: 'varchar' })
  mediaType: string;

  @Column({ name: 'release_year', nullable: true, type: 'int' })
  releaseYear: number | null;

  @Column({ name: 'provider_ref', nullable: true, type: 'simple-json' })
  providerRef: null | Record<string, string>;

  @Column({ name: 'declared_unit_ids', type: 'simple-json' })
  declaredUnitIds: string[];

  @Column({ length: 32, type: 'varchar' })
  stage: string;

  @Column({ length: 32, name: 'run_state', type: 'varchar' })
  runState: string;

  @Column({ length: 160, name: 'gate_reason', nullable: true, type: 'varchar' })
  gateReason: null | string;

  @Column({
    length: 32,
    name: 'governance_profile',
    nullable: true,
    type: 'varchar',
  })
  governanceProfile: null | string;

  @Column({ length: 32, name: 'metadata_status', type: 'varchar' })
  metadataStatus: string;

  @Column({ length: 160, name: 'next_command_label', type: 'varchar' })
  nextCommandLabel: string;

  @Column({ name: 'progress_projection', type: 'simple-json' })
  progressProjection: Record<string, unknown>;

  @Column({ default: 1, type: 'int' })
  revision: number;

  @Column({
    length: 96,
    name: 'active_run_id',
    nullable: true,
    type: 'varchar',
  })
  activeRunId: null | string;

  @Column({ length: 64, name: 'input_snapshot_sha256', type: 'varchar' })
  inputSnapshotSha256: string;

  @Column({
    length: 64,
    name: 'sealed_plan_sha256',
    nullable: true,
    type: 'varchar',
  })
  sealedPlanSha256: null | string;

  @Column({ name: 'metadata_identity', nullable: true, type: 'simple-json' })
  metadataIdentity: null | Record<string, unknown>;

  @Column({ length: 32, name: 'closed_mode', nullable: true, type: 'varchar' })
  closedMode: null | string;

  @Column({ name: 'closed_at', nullable: true, type: 'datetime' })
  closedAt: Date | null;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;
}

@Entity('media_governance_unit')
export class MediaGovernanceUnitEntity {
  @PrimaryColumn({ length: 96, type: 'varchar' })
  id: string;

  @Index()
  @Column({ length: 96, name: 'task_id', type: 'varchar' })
  taskId: string;

  @Column({ length: 24, name: 'unit_kind', type: 'varchar' })
  unitKind: string;

  @Column({ length: 8, name: 'season_number', nullable: true, type: 'varchar' })
  seasonNumber: null | string;

  @Column({ name: 'expected_episode_numbers', type: 'simple-json' })
  expectedEpisodeNumbers: string[];

  @Column({ name: 'subtitle_contract', nullable: true, type: 'simple-json' })
  subtitleContract: null | Record<string, unknown>;

  @Column({ name: 'metadata_projection', nullable: true, type: 'simple-json' })
  metadataProjection: null | Record<string, unknown>;

  @Column({ name: 'local_accepted_at', nullable: true, type: 'datetime' })
  localAcceptedAt: Date | null;

  @Column({
    length: 64,
    name: 'evidence_sha256',
    nullable: true,
    type: 'varchar',
  })
  evidenceSha256: null | string;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;
}

@Entity('media_governance_source')
export class MediaGovernanceSourceEntity {
  @PrimaryColumn({ length: 96, type: 'varchar' })
  id: string;

  @Index()
  @Column({ length: 96, name: 'task_id', type: 'varchar' })
  taskId: string;

  @Column({ length: 24, name: 'transport_kind', type: 'varchar' })
  transportKind: string;

  @Column({ length: 32, name: 'source_role', type: 'varchar' })
  sourceRole: string;

  @Column({ length: 32, name: 'content_kind', type: 'varchar' })
  contentKind: string;

  @Column({ default: 1, name: 'descriptor_revision', type: 'int' })
  descriptorRevision: number;

  @Column({ length: 512, name: 'descriptor_object_id', type: 'varchar' })
  descriptorObjectId: string;

  @Column({ length: 64, name: 'descriptor_sha256', type: 'varchar' })
  descriptorSha256: string;

  @Column({ length: 64, name: 'info_hash', nullable: true, type: 'varchar' })
  infoHash: null | string;

  @Column({
    length: 64,
    name: 'manifest_sha256',
    nullable: true,
    type: 'varchar',
  })
  manifestSha256: null | string;

  @Column({ name: 'manifest_projection', type: 'simple-json' })
  manifestProjection: Array<Record<string, unknown>>;

  @Column({ length: 32, name: 'manifest_state', type: 'varchar' })
  manifestState: string;

  @Column({ name: 'selected_bytes', type: 'bigint' })
  selectedBytes: string;

  @Column({ name: 'selected_file_count', type: 'int' })
  selectedFileCount: number;

  @Column({
    length: 160,
    name: 'release_group',
    nullable: true,
    type: 'varchar',
  })
  releaseGroup: null | string;

  @Column({ name: 'season_numbers', type: 'simple-json' })
  seasonNumbers: string[];

  @Column({ length: 32, name: 'source_health', type: 'varchar' })
  sourceHealth: string;

  @Column({ length: 160, name: 'source_health_label', type: 'varchar' })
  sourceHealthLabel: string;

  @Column({
    length: 400,
    name: 'source_health_reason',
    nullable: true,
    type: 'varchar',
  })
  sourceHealthReason: null | string;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;
}

@Entity('media_governance_descriptor_revision')
export class MediaGovernanceDescriptorRevisionEntity {
  @PrimaryColumn({ length: 96, type: 'varchar' })
  id: string;

  @Index()
  @Column({ length: 96, name: 'source_id', type: 'varchar' })
  sourceId: string;

  @Column({ type: 'int' })
  revision: number;

  @Index({ unique: true })
  @Column({ length: 512, name: 'object_id', type: 'varchar' })
  objectId: string;

  @Column({ length: 64, type: 'varchar' })
  sha256: string;

  @Column({ length: 64, name: 'info_hash', nullable: true, type: 'varchar' })
  infoHash: null | string;

  @Column({ name: 'bytes', type: 'bigint' })
  bytes: string;

  @Column({ length: 64, name: 'manifest_sha256', type: 'varchar' })
  manifestSha256: string;

  @Column({ default: true, type: 'boolean' })
  active: boolean;

  @Column({ name: 'tombstoned_at', nullable: true, type: 'datetime' })
  tombstonedAt: Date | null;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;
}

@Entity('media_governance_run')
export class MediaGovernanceRunEntity {
  @PrimaryColumn({ length: 96, type: 'varchar' })
  id: string;

  @Index()
  @Column({ length: 96, name: 'task_id', type: 'varchar' })
  taskId: string;

  @Column({ name: 'task_revision', type: 'int' })
  taskRevision: number;

  @Column({ length: 48, type: 'varchar' })
  action: string;

  @Column({ length: 32, type: 'varchar' })
  status: string;

  @Index({ unique: true })
  @Column({ length: 160, name: 'replay_key', type: 'varchar' })
  replayKey: string;

  @Column({ length: 64, name: 'input_snapshot_sha256', type: 'varchar' })
  inputSnapshotSha256: string;

  @Column({ length: 64, name: 'plan_sha256', nullable: true, type: 'varchar' })
  planSha256: null | string;

  @Column({
    length: 64,
    name: 'runner_sha256',
    nullable: true,
    type: 'varchar',
  })
  runnerSha256: null | string;

  @Column({ name: 'progress', type: 'simple-json' })
  progress: Record<string, unknown>;

  @Column({ name: 'started_at', nullable: true, type: 'datetime' })
  startedAt: Date | null;

  @Column({ name: 'finished_at', nullable: true, type: 'datetime' })
  finishedAt: Date | null;

  @Column({
    length: 64,
    name: 'evidence_sha256',
    nullable: true,
    type: 'varchar',
  })
  evidenceSha256: null | string;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;
}

@Entity('media_governance_event')
@Index(
  'uk_media_governance_event_task_run_sequence',
  ['taskId', 'runId', 'sequence'],
  { unique: true },
)
export class MediaGovernanceEventEntity {
  @PrimaryColumn({ length: 96, type: 'varchar' })
  id: string;

  @Index({ unique: true })
  @Column({ length: 160, name: 'event_id', type: 'varchar' })
  eventId: string;

  @Index()
  @Column({ length: 96, name: 'task_id', type: 'varchar' })
  taskId: string;

  @Column({ length: 96, name: 'run_id', nullable: true, type: 'varchar' })
  runId: null | string;

  @Column({ type: 'int' })
  sequence: number;

  @Column({ length: 48, type: 'varchar' })
  type: string;

  @Column({ name: 'observed_at', type: 'datetime' })
  observedAt: Date;

  @Column({ length: 32, type: 'varchar' })
  stage: string;

  @Column({ length: 32, name: 'run_state', type: 'varchar' })
  runState: string;

  @Column({ length: 400, type: 'varchar' })
  summary: string;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;
}

@Entity('media_governance_agent_session')
export class MediaGovernanceAgentSessionEntity {
  @PrimaryColumn({ length: 96, type: 'varchar' })
  id: string;

  @Index({ unique: true })
  @Column({ length: 96, name: 'task_id', type: 'varchar' })
  taskId: string;

  @Column({ length: 96, name: 'thread_id', type: 'varchar' })
  threadId: string;

  @Column({
    length: 96,
    name: 'current_unit_id',
    nullable: true,
    type: 'varchar',
  })
  currentUnitId: null | string;

  @Column({ length: 64, name: 'policy_sha256', type: 'varchar' })
  policySha256: string;

  @Column({ length: 64, name: 'capsule_sha256', type: 'varchar' })
  capsuleSha256: string;

  @Column({ length: 64, name: 'checkpoint_sha256', type: 'varchar' })
  checkpointSha256: string;

  @Column({ length: 48, name: 'policy_version', type: 'varchar' })
  policyVersion: string;

  @Column({ default: 0, name: 'last_sequence', type: 'int' })
  lastSequence: number;

  @Column({
    length: 64,
    name: 'pending_plan_sha256',
    nullable: true,
    type: 'varchar',
  })
  pendingPlanSha256: null | string;

  @Column({ length: 400, name: 'current_action_label', type: 'varchar' })
  currentActionLabel: string;

  @Column({ length: 160, name: 'status_label', type: 'varchar' })
  statusLabel: string;

  @Column({ length: 240, name: 'policy_boundary_label', type: 'varchar' })
  policyBoundaryLabel: string;

  @Column({ length: 32, type: 'varchar' })
  status: string;

  @Column({ name: 'last_heartbeat_at', type: 'datetime' })
  lastHeartbeatAt: Date;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;
}

@Entity('media_governance_metadata_exception')
export class MediaGovernanceMetadataExceptionEntity {
  @PrimaryColumn({ length: 96, type: 'varchar' })
  id: string;

  @Index()
  @Column({ length: 96, name: 'unit_id', type: 'varchar' })
  unitId: string;

  @Column({ length: 160, name: 'field_path', type: 'varchar' })
  fieldPath: string;

  @Column({ length: 8, type: 'varchar' })
  tier: string;

  @Column({ length: 64, name: 'reason_code', type: 'varchar' })
  reasonCode: string;

  @Column({ name: 'sources_checked', type: 'simple-json' })
  sourcesChecked: string[];

  @Column({ default: 0, type: 'int' })
  attempts: number;

  @Column({ name: 'selected_fallback', nullable: true, type: 'simple-json' })
  selectedFallback: null | Record<string, unknown>;

  @Column({
    length: 96,
    name: 'agent_thread_id',
    nullable: true,
    type: 'varchar',
  })
  agentThreadId: null | string;

  @Column({ length: 48, name: 'policy_version', type: 'varchar' })
  policyVersion: string;

  @Column({ name: 'task_revision', type: 'int' })
  taskRevision: number;

  @Column({ length: 64, name: 'evidence_sha256', type: 'varchar' })
  evidenceSha256: string;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;
}

@Entity('media_governance_operator_decision')
export class MediaGovernanceOperatorDecisionEntity {
  @PrimaryColumn({ length: 96, type: 'varchar' })
  id: string;

  @Index()
  @Column({ length: 96, name: 'task_id', type: 'varchar' })
  taskId: string;

  @Column({ length: 96, name: 'unit_id', nullable: true, type: 'varchar' })
  unitId: null | string;

  @Column({ length: 64, name: 'candidate_snapshot_sha256', type: 'varchar' })
  candidateSnapshotSha256: string;

  @Column({ length: 160, name: 'selected_candidate_id', type: 'varchar' })
  selectedCandidateId: string;

  @Column({ length: 400, type: 'varchar' })
  reason: string;

  @Column({ name: 'previous_revision', type: 'int' })
  previousRevision: number;

  @Column({ name: 'next_revision', type: 'int' })
  nextRevision: number;

  @Column({
    length: 96,
    name: 'verification_run_id',
    nullable: true,
    type: 'varchar',
  })
  verificationRunId: null | string;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;
}

@Entity('media_governance_outbox')
export class MediaGovernanceOutboxEntity {
  @PrimaryColumn({ length: 96, type: 'varchar' })
  id: string;

  @Index()
  @Column({ length: 96, name: 'task_id', type: 'varchar' })
  taskId: string;

  @Index({ unique: true })
  @Column({ length: 160, name: 'idempotency_key', type: 'varchar' })
  idempotencyKey: string;

  @Column({ length: 96, name: 'flow_id', type: 'varchar' })
  flowId: string;

  @Column({ length: 64, name: 'sealed_input_sha256', type: 'varchar' })
  sealedInputSha256: string;

  @Column({ default: 0, type: 'int' })
  attempts: number;

  @Column({ name: 'lease_until', nullable: true, type: 'datetime' })
  leaseUntil: Date | null;

  @Column({ length: 96, name: 'execution_id', nullable: true, type: 'varchar' })
  executionId: null | string;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;
}

export const MEDIA_GOVERNANCE_ENTITIES = [
  MediaGovernanceTaskEntity,
  MediaGovernanceUnitEntity,
  MediaGovernanceSourceEntity,
  MediaGovernanceDescriptorRevisionEntity,
  MediaGovernanceRunEntity,
  MediaGovernanceEventEntity,
  MediaGovernanceAgentSessionEntity,
  MediaGovernanceMetadataExceptionEntity,
  MediaGovernanceOperatorDecisionEntity,
  MediaGovernanceOutboxEntity,
];
