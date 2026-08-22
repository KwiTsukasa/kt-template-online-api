import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import type { BotRuleMatchType, BotRuleTargetType } from '../bot.types';

export class BotRuleBodyDto {
  @ApiPropertyOptional()
  name?: string;

  @ApiProperty({ default: 'keyword' })
  matchType: BotRuleMatchType;

  @ApiProperty({ example: 'ping' })
  keyword: string;

  @ApiPropertyOptional({ default: 'all' })
  targetType?: BotRuleTargetType;

  @ApiProperty({ example: 'pong' })
  replyContent: string;

  @ApiPropertyOptional({ default: true })
  enabled?: boolean;

  @ApiPropertyOptional({ default: 0 })
  priority?: number;

  @ApiPropertyOptional({ default: 1500 })
  cooldownMs?: number;

  @ApiPropertyOptional()
  remark?: string;
}

export class BotRuleUpdateDto extends PartialType(BotRuleBodyDto) {
  @ApiProperty()
  id: string;
}

export class BotRuleQueryDto {
  @ApiPropertyOptional({ default: 1 })
  pageNo?: number;

  @ApiPropertyOptional({ default: 10 })
  pageSize?: number;

  @ApiPropertyOptional()
  keyword?: string;

  @ApiPropertyOptional()
  selfId?: string;

  @ApiPropertyOptional()
  targetType?: BotRuleTargetType;

  @ApiPropertyOptional()
  enabled?: boolean;
}
