import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { QqbotMessageType, QqbotSendStatus } from '../qqbot.types';

export class QqbotSendPrivateDto {
  @ApiPropertyOptional()
  selfId?: string;

  @ApiProperty({ example: '123456' })
  userId: string;

  @ApiProperty({ example: '你好' })
  message: string;
}

export class QqbotSendGroupDto {
  @ApiPropertyOptional()
  selfId?: string;

  @ApiProperty({ example: '123456' })
  groupId: string;

  @ApiProperty({ example: '你好' })
  message: string;
}

export class QqbotSendLogQueryDto {
  @ApiPropertyOptional({ default: 1 })
  pageNo?: number;

  @ApiPropertyOptional({ default: 10 })
  pageSize?: number;

  @ApiPropertyOptional()
  selfId?: string;

  @ApiPropertyOptional()
  targetType?: QqbotMessageType;

  @ApiPropertyOptional()
  targetId?: string;

  @ApiPropertyOptional()
  status?: QqbotSendStatus;
}
