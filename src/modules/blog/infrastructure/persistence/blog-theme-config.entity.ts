import { Column, Entity, PrimaryColumn } from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { KtCreateDateColumn, KtDateTime, KtUpdateDateColumn } from '@/common';
import type { WordpressArgonThemeConfig } from '@/modules/wordpress/domain/wordpress.types';

@Entity('blog_theme_config')
export class BlogThemeConfig {
  @ApiProperty()
  @PrimaryColumn({
    length: 64,
    type: 'varchar',
  })
  id: string;

  @ApiProperty()
  @Column({
    type: 'simple-json',
  })
  config: WordpressArgonThemeConfig;

  @ApiPropertyOptional()
  @Column({
    default: 'local',
  })
  source: string;

  @KtCreateDateColumn({
    name: 'create_time',
  })
  createTime: KtDateTime;

  @KtUpdateDateColumn({
    name: 'update_time',
  })
  updateTime: KtDateTime;
}
