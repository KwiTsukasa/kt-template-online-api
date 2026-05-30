import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import type { QqbotPermissionTargetType } from '../qqbot.types';

export class QqbotPermissionBodyDto {
  @ApiPropertyOptional({ example: '10000' })
  selfId?: string;

  @ApiProperty({ default: 'private' })
  targetType: QqbotPermissionTargetType;

  @ApiProperty({ example: '123456' })
  targetId: string;

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
}
