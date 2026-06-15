import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtDateTimeColumn,
  KtUpdateDateColumn,
} from '@/common';

export type NapcatLoginChallengeType = 'captcha' | 'new-device';

@Entity('napcat_login_challenge')
@Index('idx_napcat_login_challenge_session', ['sessionId'])
export class NapcatLoginChallengeEntity {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'session_id', type: 'bigint' })
  sessionId: string;

  @Column({ length: 64, name: 'challenge_type' })
  challengeType: NapcatLoginChallengeType;

  @Column({ length: 32 })
  status: string;

  @Column({ default: null, name: 'challenge_url', nullable: true, type: 'text' })
  challengeUrl: null | string;

  @Column({
    default: null,
    name: 'challenge_payload',
    nullable: true,
    type: 'json',
  })
  challengePayload: null | Record<string, unknown>;

  @KtDateTimeColumn({
    default: null,
    name: 'resolved_at',
    nullable: true,
    type: 'datetime',
  })
  resolvedAt: KtDateTime | null;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
