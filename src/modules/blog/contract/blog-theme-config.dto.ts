import { ApiPropertyOptional } from '@nestjs/swagger';
import type { BlogArgonThemeConfig } from '../domain/blog-argon-theme.types';

export class BlogThemeConfigBodyDto {
  @ApiPropertyOptional({
    description: 'Argon 主题配置 JSON',
  })
  config?: BlogArgonThemeConfig;

  @ApiPropertyOptional({
    description: '配置来源',
  })
  source?: string;
}
