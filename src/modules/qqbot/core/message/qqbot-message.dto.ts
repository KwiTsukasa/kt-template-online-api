import { ApiPropertyOptional } from '@nestjs/swagger';
import type { QqbotMessageType } from '../contract/qqbot.types';

export class QqbotConversationQueryDto {
  @ApiPropertyOptional({ default: 1 })
  pageNo?: number;

  @ApiPropertyOptional({ default: 10 })
  pageSize?: number;

  @ApiPropertyOptional()
  selfId?: string;

  @ApiPropertyOptional()
  targetType?: QqbotMessageType;

  @ApiPropertyOptional()
  targetId?: string;
}

export class QqbotMessageQueryDto extends QqbotConversationQueryDto {
  @ApiPropertyOptional()
  conversationId?: string;

  @ApiPropertyOptional()
  keyword?: string;
}
