import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import type { BotPermissionTargetType } from '../bot.types';

export class BotPermissionConfigDto {
  @ApiPropertyOptional({
    default: true,
    description: '白名单固定启用，不接受 false',
  })
  allowlistEnabled?: boolean;

  @ApiPropertyOptional({
    default: true,
    description: '黑名单固定启用，优先于白名单，不接受 false',
  })
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

  @ApiPropertyOptional({
    type: [String],
    description: '同一群或频道名单内的精确用户集合，不拆分记录',
  })
  userIds?: string[];

  @ApiPropertyOptional({ default: false })
  preciseUser?: boolean;

  @ApiPropertyOptional({ default: true })
  enabled?: boolean;

  @ApiPropertyOptional()
  remark?: string;
}

export class BotPermissionUpdateDto extends PartialType(BotPermissionBodyDto) {
  @ApiProperty()
  id: string;
}

export class BotPermissionQueryDto {
  @ApiPropertyOptional({
    enum: ['tree'],
    description: '树表读取全部筛选结果，省略时保持分页',
  })
  view?: 'tree';
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

export class BotPermissionOptionsQueryDto {
  @ApiPropertyOptional()
  selfId?: string;

  @ApiPropertyOptional()
  targetId?: string;

  @ApiPropertyOptional({ enum: ['channel', 'group', 'qq'] })
  targetType?: 'channel' | 'group' | 'qq';
}
