import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import type { QqbotPermissionTargetType } from '../contract/qqbot.types';

export class QqbotPermissionConfigDto {
  @ApiPropertyOptional({ default: false })
  allowlistEnabled?: boolean;

  @ApiPropertyOptional({ default: true })
  blocklistEnabled?: boolean;
}

export class QqbotPermissionBodyDto {
  @ApiPropertyOptional({ example: '10000' })
  selfId?: string;

  @ApiProperty({ default: 'qq' })
  targetType: QqbotPermissionTargetType;

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

export class QqbotPermissionUpdateDto extends PartialType(
  QqbotPermissionBodyDto,
) {
  @ApiProperty()
  id: string;
}

export class QqbotPermissionQueryDto {
  @ApiPropertyOptional({ default: 1 })
  pageNo?: number;

  @ApiPropertyOptional({ default: 10 })
  pageSize?: number;

  @ApiPropertyOptional()
  selfId?: string;

  @ApiPropertyOptional()
  targetType?: QqbotPermissionTargetType;

  @ApiPropertyOptional()
  targetId?: string;

  @ApiPropertyOptional()
  userId?: string;

  @ApiPropertyOptional()
  preciseUser?: boolean;
}
