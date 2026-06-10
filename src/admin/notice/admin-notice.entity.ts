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

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}

