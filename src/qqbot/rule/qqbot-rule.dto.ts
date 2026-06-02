import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import type { QqbotRuleMatchType, QqbotRuleTargetType } from '../qqbot.types';

export class QqbotRuleBodyDto {
  @ApiPropertyOptional()
  name?: string;

  @ApiProperty({ default: 'keyword' })
  matchType: QqbotRuleMatchType;

  @ApiProperty({ example: 'ping' })
  keyword: string;

  @ApiPropertyOptional({ default: 'all' })
  targetType?: QqbotRuleTargetType;

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

export class QqbotRuleUpdateDto extends PartialType(QqbotRuleBodyDto) {
  @ApiProperty()
  id: string;
}

export class QqbotRuleQueryDto {
  @ApiPropertyOptional({ default: 1 })
  pageNo?: number;

  @ApiPropertyOptional({ default: 10 })
  pageSize?: number;

  @ApiPropertyOptional()
  keyword?: string;

  @ApiPropertyOptional()
  selfId?: string;

  @ApiPropertyOptional()
  targetType?: QqbotRuleTargetType;

  @ApiPropertyOptional()
  enabled?: boolean;
}
