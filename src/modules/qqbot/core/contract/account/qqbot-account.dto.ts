import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import type { QqbotConnectionMode } from '../qqbot.types';

export class QqbotAccountBodyDto {
  @ApiPropertyOptional({ default: 'reverse-ws' })
  connectionMode?: QqbotConnectionMode;

  @ApiProperty({ example: '10000' })
  selfId: string;

  @ApiPropertyOptional({ example: '主账号' })
  name?: string;

  @ApiPropertyOptional({ description: 'OneBot 反向 WS token' })
  accessToken?: string;

  @ApiPropertyOptional({ description: 'RSA-OAEP 加密后的 NapCat 登录密码' })
  encryptedLoginPassword?: string;

  @ApiPropertyOptional({ default: true })
  enabled?: boolean;

  @ApiPropertyOptional()
  remark?: string;
}

export class QqbotAccountUpdateDto extends PartialType(QqbotAccountBodyDto) {
  @ApiProperty()
  id: string;
}

export class QqbotAccountQueryDto {
  @ApiPropertyOptional({ default: 1 })
  pageNo?: number;

  @ApiPropertyOptional({ default: 10 })
  pageSize?: number;

  @ApiPropertyOptional()
  selfId?: string;

  @ApiPropertyOptional()
  name?: string;

  @ApiPropertyOptional()
  connectStatus?: string;
}
