import { BeforeInsert, Column, Entity, PrimaryColumn } from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtUpdateDateColumn,
} from '@/common';
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

  @KtCreateDateColumn({
    name: 'create_time',
  })
  createTime: KtDateTime;

  @KtUpdateDateColumn({
    name: 'update_time',
  })
  updateTime: KtDateTime;

  @ApiPropertyOptional()
  count?: number;

  @ApiPropertyOptional()
  parent?: string;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
