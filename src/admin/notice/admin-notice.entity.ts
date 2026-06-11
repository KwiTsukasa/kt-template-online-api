import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ensureSnowflakeId, FormatDateTime } from '@/common';

@Entity('admin_notice')
export class AdminNotice {
  @ApiPropertyOptional()
  @PrimaryColumn({
    type: 'bigint',
  })
  id: string;

  @ApiProperty({
    example: '系统公告',
  })
  @Column()
  title: string;

  @ApiProperty({
    example: '这是站内信内容',
  })
  @Column({
    type: 'longtext',
  })
  content: string;

  @ApiPropertyOptional({
    example: '系统公告摘要',
  })
  @Column({
    nullable: true,
    type: 'text',
  })
  summary?: string;

  @ApiProperty({
    example: 1,
  })
  @Column({
    default: 1,
  })
  level: number;

  @ApiProperty({
    example: 1,
  })
  @Column({
    default: 1,
  })
  status: number;

  @ApiProperty({
    example: 'error',
  })
  @Column({
    default: 'info',
    length: 16,
  })
  severity: string;

  @ApiProperty({
    example: 'api',
  })
  @Column({
    default: 'system',
    length: 64,
  })
  source: string;

  @ApiProperty({
    example: 'api.error',
  })
  @Column({
    default: 'system.event',
    length: 120,
    name: 'event_type',
  })
  eventType: string;

  @ApiPropertyOptional({
    example: 'api:error:GET:/boom:500',
  })
  @Column({
    length: 255,
    name: 'dedupe_key',
    nullable: true,
  })
  dedupeKey?: string;

  @ApiProperty({
    example: 1,
  })
  @Column({
    default: 1,
    name: 'occurrence_count',
  })
  occurrenceCount: number;

  @ApiProperty({
    example: 'super',
  })
  @Column({
    default: 'super',
    length: 64,
    name: 'notify_role_code',
  })
  notifyRoleCode: string;

  @ApiPropertyOptional()
  @Column({
    nullable: true,
    type: 'json',
  })
  metadata?: Record<string, unknown>;

  @ApiProperty({
    example: false,
  })
  @Column({
    default: false,
    name: 'is_top',
    type: 'boolean',
  })
  isTop: boolean;

  @ApiPropertyOptional({
    example: '100001,100002',
  })
  @Column({
    name: 'notify_users',
    nullable: true,
    type: 'text',
  })
  notifyUsers?: string;

  @ApiPropertyOptional({
    example: '2041700000000100001',
  })
  @Column({
    name: 'created_by',
    nullable: true,
    type: 'bigint',
  })
  createdBy?: string;

  @ApiProperty({
    example: false,
  })
  @Column({
    default: false,
    name: 'is_deleted',
  })
  isDeleted: boolean;

  @CreateDateColumn({
    name: 'create_time',
  })
  @FormatDateTime()
  createTime: Date;

  @UpdateDateColumn({
    name: 'update_time',
  })
  @FormatDateTime()
  updateTime: Date;

  @Column({
    name: 'first_seen_at',
    nullable: true,
    type: 'datetime',
  })
  @FormatDateTime()
  firstSeenAt?: Date;

  @Column({
    name: 'last_seen_at',
    nullable: true,
    type: 'datetime',
  })
  @FormatDateTime()
  lastSeenAt?: Date;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
