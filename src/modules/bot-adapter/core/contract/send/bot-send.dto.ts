import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { BotMessageType, BotSendStatus } from '../bot.types';

export class BotSendPrivateDto {
  @ApiPropertyOptional()
  selfId?: string;

  @ApiProperty({ example: '123456' })
  userId: string;

  @ApiProperty({ example: '你好' })
  message: string;
}

export class BotSendGroupDto {
  @ApiPropertyOptional()
  selfId?: string;

  @ApiProperty({ example: '123456' })
  groupId: string;

  @ApiProperty({ example: '你好' })
  message: string;
}

export class BotSendLogQueryDto {
  @ApiPropertyOptional({ default: 1 })
  pageNo?: number;

  @ApiPropertyOptional({ default: 10 })
  pageSize?: number;

  @ApiPropertyOptional()
  selfId?: string;

  @ApiPropertyOptional()
  targetType?: BotMessageType;

  @ApiPropertyOptional()
  targetId?: string;

  @ApiPropertyOptional()
  status?: BotSendStatus;
}
