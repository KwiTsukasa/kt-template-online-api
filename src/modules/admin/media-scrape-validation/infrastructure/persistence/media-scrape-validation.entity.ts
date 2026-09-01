import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { KtCreateDateColumn, KtDateTime, KtUpdateDateColumn } from '@/common';

@Entity('media_scrape_validation')
export class MediaScrapeValidationEntity {
  @PrimaryColumn({ length: 96, type: 'varchar' })
  id: string;

  @Index({ unique: true })
  @Column({ length: 96, name: 'task_id', type: 'varchar' })
  taskId: string;

  @Index()
  @Column({ length: 96, name: 'series_id', nullable: true, type: 'varchar' })
  seriesId: null | string;

  @Index()
  @Column({ length: 96, name: 'work_id', nullable: true, type: 'varchar' })
  workId: null | string;

  @Column({ length: 200, type: 'varchar' })
  title: string;

  @Column({ length: 24, name: 'media_type', type: 'varchar' })
  mediaType: string;

  @Column({ name: 'identity_snapshot', type: 'simple-json' })
  identitySnapshot: Record<string, unknown>;

  @Column({ name: 'governance_snapshot', type: 'simple-json' })
  governanceSnapshot: Record<string, unknown>;

  @Column({ length: 24, type: 'varchar' })
  status: string;

  @Column({ length: 400, nullable: true, type: 'varchar' })
  reason: null | string;

  @Column({ name: 'issue_projection', type: 'simple-json' })
  issueProjection: Array<Record<string, unknown>>;

  @Column({
    length: 64,
    name: 'evidence_sha256',
    nullable: true,
    type: 'varchar',
  })
  evidenceSha256: null | string;

  @Column({ name: 'governance_revision', type: 'int' })
  governanceRevision: number;

  @Column({ default: 1, type: 'int' })
  revision: number;

  @Column({ name: 'requested_at', type: 'datetime' })
  requestedAt: Date;

  @Column({ name: 'started_at', nullable: true, type: 'datetime' })
  startedAt: Date | null;

  @Column({ name: 'completed_at', nullable: true, type: 'datetime' })
  completedAt: Date | null;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;
}
