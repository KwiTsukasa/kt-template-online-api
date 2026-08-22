import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import type { BotPermissionTargetType } from '../bot.types';

export class BotPermissionConfigDto {
  @ApiPropertyOptional({ default: false })
  allowlistEnabled?: boolean;

  @ApiPropertyOptional({ default: true })
  blocklistEnabled?: boolean;
}

export class BotPermissionBodyDto {
  @ApiPropertyOptional({ example: '10000' })
  selfId?: string;

  @ApiProperty({ default: 'qq' })
  targetType: BotPermissionTargetType;

  @ApiProperty({ example: '123456' })
  targetId: string;

  @ApiPropertyOptional({ example: '123456' })
  userId?: string;

  @ApiPropertyOptional({ default: false })
  preciseUser?: boolean;

  @ApiPropertyOptional({ default: true })
  enabled?: boolean;

  @ApiPropertyOptional()
  remark?: string;
}

export class BotPermissionUpdateDto extends PartialType(
  BotPermissionBodyDto,
) {
  @ApiProperty()
  id: string;
}

export class BotPermissionQueryDto {
  @ApiPropertyOptional({ default: 1 })
  pageNo?: number;

  @ApiPropertyOptional({ default: 10 })
  pageSize?: number;

  @ApiPropertyOptional()
  selfId?: string;

  @ApiPropertyOptional()
  targetType?: BotPermissionTargetType;

  @ApiPropertyOptional()
  targetId?: string;

  @ApiPropertyOptional()
  userId?: string;

  @ApiPropertyOptional()
  preciseUser?: boolean;
}
