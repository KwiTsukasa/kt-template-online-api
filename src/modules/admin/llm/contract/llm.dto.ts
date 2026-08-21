import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import type { LlmConnectionStatus, LlmProvider } from './llm.types';

const PROVIDERS: LlmProvider[] = [
  'anthropic',
  'codex',
  'deepseek',
  'moonshot',
  'openai',
  'zhipu',
];
const CONNECTION_STATUSES: LlmConnectionStatus[] = [
  'connected',
  'disabled',
  'error',
  'untested',
];
const SNOWFLAKE_ID_PATTERN = /^[1-9]\d{0,23}$/;
const CLIENT_MESSAGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$/;

const trimText = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  return value.trim();
};

export class LlmConfigCreateDto {
  @ApiProperty({ maxLength: 100 })
  @Transform(trimText)
  @IsString()
  @Length(1, 100)
  name: string;

  @ApiProperty({ enum: PROVIDERS })
  @IsIn(PROVIDERS)
  provider: LlmProvider;

  @ApiProperty({ maxLength: 1000 })
  @Transform(trimText)
  @IsString()
  @Length(1, 1000)
  @Matches(/^https?:\/\/\S+$/i)
  baseUrl: string;

  @ApiPropertyOptional({ maxLength: 4096 })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  apiKey?: string;

  @ApiProperty()
  @IsBoolean()
  enabled: boolean;

  @ApiProperty()
  @IsBoolean()
  isDefault: boolean;
}

export class LlmConfigUpdateDto extends PartialType(LlmConfigCreateDto) {}

export class LlmConfigListQueryDto {
  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageNo?: number;

  @ApiPropertyOptional({ maximum: 100, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @Transform(trimText)
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @ApiPropertyOptional({ enum: PROVIDERS })
  @IsOptional()
  @IsIn(PROVIDERS)
  provider?: LlmProvider;

  @ApiPropertyOptional({ enum: CONNECTION_STATUSES })
  @IsOptional()
  @IsIn(CONNECTION_STATUSES)
  status?: LlmConnectionStatus;
}

export class LlmConfigEnabledDto {
  @ApiProperty()
  @IsBoolean()
  enabled: boolean;
}

export class LlmConfigTestDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @Transform(trimText)
  @IsString()
  @Length(1, 200)
  model?: string;
}

export class LlmConversationListQueryDto {
  @ApiProperty()
  @IsString()
  @Matches(SNOWFLAKE_ID_PATTERN)
  configId: string;

  @ApiPropertyOptional({ maximum: 100, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class LlmConversationCreateDto {
  @ApiProperty()
  @IsString()
  @Matches(SNOWFLAKE_ID_PATTERN)
  configId: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @Transform(trimText)
  @IsString()
  @MaxLength(200)
  title?: string;
}

export class LlmConversationMessageStreamDto {
  @ApiProperty({ maxLength: 96 })
  @IsString()
  @Matches(CLIENT_MESSAGE_ID_PATTERN)
  clientMessageId: string;

  @ApiProperty({ maxLength: 20000 })
  @Transform(trimText)
  @IsString()
  @Length(1, 20000)
  content: string;

  @ApiProperty({ maxLength: 200 })
  @Transform(trimText)
  @IsString()
  @Length(1, 200)
  model: string;

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @Transform(trimText)
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)
  reasoningEffort?: string;

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @Transform(trimText)
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)
  serviceTier?: string;
}
