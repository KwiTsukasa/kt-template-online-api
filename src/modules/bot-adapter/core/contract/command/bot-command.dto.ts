import { PartialType } from '@nestjs/swagger';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { KtPageQuery } from '@/common';
import type {
  BotCommandParserType,
  BotMessageType,
  BotRuleTargetType,
} from '../bot.types';

export class BotCommandQueryDto implements KtPageQuery {
  @ApiPropertyOptional()
  pageNo?: number | string;

  @ApiPropertyOptional()
  pageSize?: number | string;

  @ApiPropertyOptional()
  keyword?: string;

  @ApiPropertyOptional()
  selfId?: string;

  @ApiPropertyOptional()
  pluginKey?: string;

  @ApiPropertyOptional()
  operationKey?: string;

  @ApiPropertyOptional()
  enabled?: boolean | string;

  @ApiPropertyOptional()
  targetType?: BotRuleTargetType;
}

export class BotCommandBodyDto {
  @ApiProperty()
  code: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ type: [String] })
  aliases?: string[] | string;

  @ApiPropertyOptional({ type: [String] })
  prefixes?: string[] | string;

  @ApiProperty()
  pluginKey: string;

  @ApiProperty()
  operationKey: string;

  @ApiPropertyOptional()
  parserKey?: BotCommandParserType;

  @ApiPropertyOptional()
  targetType?: BotRuleTargetType;

  @ApiPropertyOptional()
  defaultParams?: any;

  @ApiPropertyOptional()
  replyTemplate?: string;

  @ApiPropertyOptional()
  errorTemplate?: string;

  @ApiPropertyOptional()
  enabled?: boolean;

  @ApiPropertyOptional()
  priority?: number;

  @ApiPropertyOptional()
  cooldownMs?: number;

  @ApiPropertyOptional()
  remark?: string;
}

export class BotCommandUpdateDto extends PartialType(BotCommandBodyDto) {
  @ApiProperty()
  id: string;
}

export class BotCommandTestDto {
  @ApiPropertyOptional()
  commandId?: string;

  @ApiProperty()
  text: string;

  @ApiPropertyOptional()
  selfId?: string;

  @ApiPropertyOptional()
  targetType?: BotMessageType;

  @ApiPropertyOptional()
  targetId?: string;

  @ApiPropertyOptional()
  userId?: string;
}
