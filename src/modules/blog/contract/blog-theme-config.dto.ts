import { ApiPropertyOptional } from '@nestjs/swagger';
import type { WordpressArgonThemeConfig } from '@/modules/wordpress/domain/wordpress.types';

export class BlogThemeConfigBodyDto {
  @ApiPropertyOptional({
    description: 'Argon 主题配置 JSON',
  })
  config?: WordpressArgonThemeConfig;

  @ApiPropertyOptional({
    description: '配置来源',
  })
  source?: string;
}
