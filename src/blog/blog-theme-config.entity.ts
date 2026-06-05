import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FormatDateTime } from '@/common';
import type { WordpressArgonThemeConfig } from '@/wordpress/wordpress.types';

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
}
