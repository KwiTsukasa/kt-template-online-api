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

export type BlogTermKind = 'category' | 'tag';

@Entity('blog_term')
export class BlogTerm {
  @ApiPropertyOptional()
  @PrimaryColumn({
    type: 'bigint',
  })
  id: string;

  @ApiProperty({
    enum: ['category', 'tag'],
  })
  @Column()
  kind: BlogTermKind;

  @ApiProperty()
  @Column()
  name: string;

  @ApiPropertyOptional()
  @Column({
    default: '',
  })
  slug: string;

  @ApiPropertyOptional()
  @Column({
    type: 'text',
    nullable: true,
  })
  description: string;

  @ApiPropertyOptional()
  @Column({
    name: 'parent_id',
    nullable: true,
  })
  parentId: string;

  @ApiPropertyOptional()
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

  @ApiPropertyOptional()
  count?: number;

  @ApiPropertyOptional()
  parent?: string;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
