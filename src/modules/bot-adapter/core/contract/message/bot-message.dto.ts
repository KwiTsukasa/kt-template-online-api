import { ApiPropertyOptional } from '@nestjs/swagger';
import type { BotMessageType } from '../bot.types';

export class BotConversationQueryDto {
  @ApiPropertyOptional({ default: 1 })
  pageNo?: number;

  @ApiPropertyOptional({ default: 10 })
  pageSize?: number;

  @ApiPropertyOptional()
  selfId?: string;

  @ApiPropertyOptional()
  targetType?: BotMessageType;

  @ApiPropertyOptional()
  targetId?: string;
}

export class BotMessageQueryDto extends BotConversationQueryDto {
  @ApiPropertyOptional()
  conversationId?: string;

  @ApiPropertyOptional()
  keyword?: string;
}
