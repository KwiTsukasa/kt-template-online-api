import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { KtCreateDateColumn, KtDateTime, KtDateTimeColumn } from '@/common';
import {
  DefinitionDraftRow,
  DefinitionRevisionRow,
} from '@/common/automation/definition.entities';
import type {
  ScheduleDefinition,
  ScheduleDispatchStatus,
} from '../../contract/schedule.types';

@Entity('automation_schedule')
export class ScheduleDraft extends DefinitionDraftRow {}
@Entity('automation_schedule_revision')
export class ScheduleRevision extends DefinitionRevisionRow {}

@Entity('automation_schedule_state')
export class ScheduleState {
  @PrimaryColumn({ name: 'schedule_id', type: 'bigint' }) scheduleId: string;
  @Column({ type: 'int', default: 0 }) revision: number;
  @Column({ default: false }) enabled: boolean;
  @Column({ name: 'active_binding_id', type: 'bigint', nullable: true })
  activeBindingId: string | null;
  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;
}

@Entity('automation_schedule_binding')
@Index(
  'uk_automation_schedule_activation',
  ['scheduleId', 'activationRevision'],
  { unique: true },
)
@Index('uk_automation_schedule_registration', ['registrationId'], {
  unique: true,
})
export class ScheduleRegistration {
  @PrimaryColumn({ type: 'bigint' }) id: string;
  @Column({ name: 'schedule_id', type: 'bigint' }) scheduleId: string;
  @Column({ name: 'schedule_version', type: 'int' }) scheduleVersion: number;
  @Column({ name: 'activation_revision', type: 'int' })
  activationRevision: number;
  @Column({ name: 'registration_id', type: 'bigint' }) registrationId: string;
  @Column({ default: false }) retired: boolean;
  @KtCreateDateColumn({ name: 'create_time' }) createTime: KtDateTime;
}

@Entity('automation_schedule_dispatch')
@Index('uk_automation_schedule_occurrence', ['occurrenceId'], { unique: true })
@Index('idx_automation_schedule_dispatch', ['scheduleId', 'status', 'id'])
export class ScheduleDispatch {
  @PrimaryColumn({ type: 'bigint' }) id: string;
  @Column({ name: 'schedule_id', type: 'bigint' }) scheduleId: string;
  @Column({ name: 'schedule_version', type: 'int' }) scheduleVersion: number;
  @Column({ name: 'binding_id', type: 'bigint' }) bindingId: string;
  @Column({ name: 'occurrence_id', type: 'bigint' }) occurrenceId: string;
  @Column({ name: 'registration_id', type: 'bigint' }) registrationId: string;
  @Column({ name: 'occurrence_payload', type: 'json' })
  occurrencePayload: Record<string, unknown>;
  @KtDateTimeColumn({ name: 'occurred_at' }) occurredAt: KtDateTime;
  @Column({ type: 'json' }) definition: ScheduleDefinition;
  @Column({ length: 16 }) status: ScheduleDispatchStatus;
  @Column({ name: 'target_run_id', type: 'bigint', nullable: true })
  targetRunId: string | null;
  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;
  @KtDateTimeColumn({ name: 'deadline_at' }) deadlineAt: KtDateTime;
  @KtDateTimeColumn({ name: 'next_attempt_at' }) nextAttemptAt: KtDateTime;
  @KtDateTimeColumn({ name: 'finished_at', nullable: true })
  finishedAt: KtDateTime | null;
  @KtCreateDateColumn({ name: 'create_time' }) createTime: KtDateTime;
}
