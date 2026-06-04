import { PartialType } from '@nestjs/swagger';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { KtPageQuery } from '@/common';
import type {
  QqbotCommandParserType,
  QqbotMessageType,
  QqbotRuleTargetType,
} from '../qqbot.types';

export class QqbotCommandQueryDto implements KtPageQuery {
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
  targetType?: QqbotRuleTargetType;
}

export class QqbotCommandBodyDto {
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
  parserKey?: QqbotCommandParserType;

  @ApiPropertyOptional()
  targetType?: QqbotRuleTargetType;

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

export class QqbotCommandUpdateDto extends PartialType(QqbotCommandBodyDto) {
  @ApiProperty()
  id: string;
}

export class QqbotCommandTestDto {
  @ApiPropertyOptional()
  commandId?: string;

  @ApiProperty()
  text: string;

  @ApiPropertyOptional()
  selfId?: string;

  @ApiPropertyOptional()
  targetType?: QqbotMessageType;

  @ApiPropertyOptional()
  targetId?: string;

  @ApiPropertyOptional()
  userId?: string;
}
