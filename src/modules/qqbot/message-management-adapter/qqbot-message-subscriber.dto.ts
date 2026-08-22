import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { SNOWFLAKE_ID_PATTERN } from '@/modules/message-management/contract/message-management.dto';

export const QQ_ACCOUNT_SELF_ID_PATTERN =
  /^(?:[1-9]\d{4,19}|qq-official:\d{5,20})$/;
export const QQ_TARGET_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export class AccountMessagePushParamDto {
  @IsString()
  @Matches(QQ_ACCOUNT_SELF_ID_PATTERN)
  selfId: string;
}

export class AccountMessagePushBindingParamDto extends AccountMessagePushParamDto {
  @IsString()
  @Matches(SNOWFLAKE_ID_PATTERN)
  id: string;
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

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => MessagePublishTargetInputDto)
  targets: MessagePublishTargetInputDto[];

  @IsBoolean()
  enabled: boolean;
}
