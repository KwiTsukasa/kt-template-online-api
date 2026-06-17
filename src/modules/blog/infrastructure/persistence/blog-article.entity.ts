import { BeforeInsert, Column, Entity, PrimaryColumn } from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtDateTimeColumn,
  KtUpdateDateColumn,
} from '@/common';
export type BlogArticleStatus = 'draft' | 'pending' | 'private' | 'publish';

export type BlogArticleTerm = {
  count?: number;
  id?: string;
  name: string;
  slug: string;
};

@Entity('blog_article')
export class BlogArticle {
  @ApiPropertyOptional()
  @PrimaryColumn({
    type: 'bigint',
  })
  id: string;

  @ApiProperty()
  @Column()
  title: string;

  @ApiPropertyOptional()
  @Column({
    default: '',
  })
  slug: string;

  @ApiPropertyOptional({
    enum: ['draft', 'pending', 'private', 'publish'],
  })
  @Column({
    default: 'draft',
  })
  status: BlogArticleStatus;

  @ApiPropertyOptional()
  @Column({
    type: 'text',
    nullable: true,
  })
  excerpt: string;

  @ApiPropertyOptional()
  @Column({
    name: 'content_markdown',
    type: 'mediumtext',
    nullable: true,
  })
  contentMarkdown: string;

  @ApiPropertyOptional()
  @Column({
    name: 'content_html',
    type: 'mediumtext',
    nullable: true,
  })
  contentHtml: string;

  @ApiPropertyOptional()
  @Column({
    type: 'text',
    nullable: true,
  })
  cover: string;

  @ApiPropertyOptional()
  @Column({
    name: 'author_name',
    default: 'KwiTsukasa',
  })
  authorName: string;

  @ApiPropertyOptional()
  @Column({
    name: 'category_items',
    type: 'simple-json',
    nullable: true,
  })
  categoryItems: BlogArticleTerm[];

  @ApiPropertyOptional()
  @Column({
    name: 'tag_items',
    type: 'simple-json',
    nullable: true,
  })
  tagItems: BlogArticleTerm[];

  @ApiPropertyOptional()
  @Column({
    default: 0,
  })
  views: number;

  @ApiPropertyOptional()
  @Column({
    default: 0,
  })
  comments: number;

  @ApiPropertyOptional()
  @Column({
    default: false,
    name: 'is_deleted',
  })
  isDeleted: boolean;

  @ApiPropertyOptional()
  @KtDateTimeColumn({
    name: 'publish_time',
    nullable: true,
    type: 'datetime',
  })
  publishTime: KtDateTime;

  @KtCreateDateColumn({
    name: 'create_time',
  })
  createTime: KtDateTime;

  @KtUpdateDateColumn({
    name: 'update_time',
  })
  updateTime: KtDateTime;

  @ApiPropertyOptional()
  categories?: string[];

  @ApiPropertyOptional()
  tags?: string[];

  @ApiPropertyOptional()
  categoriesResolved?: BlogArticleTerm[];

  @ApiPropertyOptional()
  tagsResolved?: BlogArticleTerm[];

  @ApiPropertyOptional()
  excerptText?: string;

  /**
   * 创建 博客内容对象或配置。
   */
  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
