import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
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
  ValidateNested,
} from 'class-validator';

export const SNOWFLAKE_ID_PATTERN = /^[1-9]\d{0,23}$/;
export const QQ_TARGET_ID_PATTERN = /^[1-9]\d{4,19}$/;
const SOURCE_KEY_MAX_LENGTH = 128;

/** 判断消息源配置是否为仅含字符串值的普通键值对象。 */
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

export class MessagePushSourceParamDto {
  @IsString()
  @Length(1, SOURCE_KEY_MAX_LENGTH)
  sourceKey: string;
}

export class MessagePushIdParamDto {
  @IsString()
  @Matches(SNOWFLAKE_ID_PATTERN)
  id: string;
}

export class AccountMessagePushParamDto {
  @IsString()
  @Matches(QQ_TARGET_ID_PATTERN)
  selfId: string;
}

export class AccountMessagePushBindingParamDto extends AccountMessagePushParamDto {
  @IsString()
  @Matches(SNOWFLAKE_ID_PATTERN)
  id: string;
}

export class MessagePushListQueryDto {
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

export class MessageSubscriptionListQueryDto extends MessagePushListQueryDto {}

export class MessageTemplateListQueryDto extends MessagePushListQueryDto {}

export class MessageSubscriptionInputDto {
  @IsString()
  @Length(1, 100)
  @Matches(/\S/)
  name: string;

  @IsString()
  @Length(1, SOURCE_KEY_MAX_LENGTH)
  sourceKey: string;

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

export class MessagePushEnabledDto {
  @IsBoolean()
  enabled: boolean;
}

export class MessagePublishTargetInputDto {
  @IsIn(['group', 'private'])
  targetType: 'group' | 'private';

  @IsString()
  @Matches(QQ_TARGET_ID_PATTERN)
  targetId: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  targetName?: string;
}

export class MessagePublishBindingInputDto {
  @IsString()
  @Matches(SNOWFLAKE_ID_PATTERN)
  subscriptionId: string;

  @IsString()
  @Matches(SNOWFLAKE_ID_PATTERN)
  templateId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => MessagePublishTargetInputDto)
  targets: MessagePublishTargetInputDto[];

  @IsBoolean()
  enabled: boolean;
}
