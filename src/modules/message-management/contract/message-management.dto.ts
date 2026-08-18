import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateBy,
} from 'class-validator';

export const SNOWFLAKE_ID_PATTERN = /^[1-9]\d{0,23}$/;
const SOURCE_KEY_MAX_LENGTH = 128;
const SUBSCRIBER_KEY_MAX_LENGTH = 64;

/**
 * 判断消息源配置是否为仅含字符串值的普通键值对象。
 * @param value - 待判定是否满足消息源配置是否为仅含字符串值的普通键值对象约束的候选值。
 * @returns 满足消息源配置是否为仅含字符串值的普通键值对象约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === 'string')
  );
}

const strictQueryBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
};

export class MessageSourceParamDto {
  @IsString()
  @Length(1, SOURCE_KEY_MAX_LENGTH)
  sourceKey: string;
}

export class MessageIdParamDto {
  @IsString()
  @Matches(SNOWFLAKE_ID_PATTERN)
  id: string;
}

export class MessageListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageNo?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, SOURCE_KEY_MAX_LENGTH)
  sourceKey?: string;

  @IsOptional()
  @Transform(strictQueryBoolean)
  @IsBoolean()
  enabled?: boolean;
}

export class MessageSubscriptionListQueryDto extends MessageListQueryDto {
  @IsOptional()
  @IsString()
  @Length(1, SUBSCRIBER_KEY_MAX_LENGTH)
  subscriberKey?: string;

  @IsOptional()
  @IsString()
  @Matches(SNOWFLAKE_ID_PATTERN)
  templateId?: string;
}

export class MessageTemplateListQueryDto extends MessageListQueryDto {}

export class MessageSubscriptionInputDto {
  @IsString()
  @Length(1, 100)
  @Matches(/\S/)
  name: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Matches(SNOWFLAKE_ID_PATTERN, { each: true })
  templateIds: string[];

  @IsString()
  @Length(1, SUBSCRIBER_KEY_MAX_LENGTH)
  subscriberKey: string;

  @ValidateBy({
    name: 'isStringRecord',
    validator: { validate: isStringRecord },
  })
  @IsDefined()
  @IsObject()
  sourceConfig: Record<string, string>;

  @IsBoolean()
  enabled: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}

export class MessageTemplateInputDto {
  @IsString()
  @Length(1, 100)
  @Matches(/\S/)
  name: string;

  @IsString()
  @Length(1, SOURCE_KEY_MAX_LENGTH)
  sourceKey: string;

  @IsString()
  @MaxLength(2000)
  content: string;

  @IsBoolean()
  enabled: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}

export class MessageTemplatePreviewDto {
  @IsString()
  @Length(1, SOURCE_KEY_MAX_LENGTH)
  sourceKey: string;

  @IsString()
  @MaxLength(2000)
  content: string;
}

export class MessageEnabledDto {
  @IsBoolean()
  enabled: boolean;
}
