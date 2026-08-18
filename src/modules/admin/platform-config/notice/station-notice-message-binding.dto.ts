import {
  IsBoolean,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { SNOWFLAKE_ID_PATTERN } from '@/modules/message-management/contract/message-management.dto';

export class StationNoticeMessageBindingParamDto {
  @IsString()
  @Matches(SNOWFLAKE_ID_PATTERN)
  id: string;
}

export class StationNoticeMessageBindingInputDto {
  @IsString()
  @Matches(SNOWFLAKE_ID_PATTERN)
  subscriptionId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  notifyRoleCode: string;

  @IsBoolean()
  enabled: boolean;
}
