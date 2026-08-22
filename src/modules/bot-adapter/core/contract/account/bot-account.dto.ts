import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import type { BotConnectionMode } from '../bot.types';

export class BotAccountBodyDto {
  @ApiPropertyOptional({
    default: 'reverse-ws',
    enum: ['reverse-ws', 'official-websocket', 'official-webhook'],
  })
  connectionMode?: BotConnectionMode;

  @ApiPropertyOptional({
    description: 'NapCat QQ 号；官方 Bot 由后端根据 AppID 生成稳定 selfId',
    example: '10000',
  })
  selfId?: string;

  @ApiPropertyOptional({
    description: 'QQ 开放平台官方 Bot AppID',
    example: '1020000000',
  })
  appId?: string;

  @ApiPropertyOptional({ example: '主账号' })
  name?: string;

  @ApiPropertyOptional({ description: 'OneBot 反向 WS token' })
  accessToken?: string;

  @ApiPropertyOptional({
    description: 'QQ 开放平台 AppSecret；编辑时留空表示保持原值',
  })
  appSecret?: string;

  @ApiPropertyOptional({
    description: 'NapCat 登录密码，仅在当前 TLS 请求内包装为服务端密文',
  })
  loginPassword?: string;

  @ApiPropertyOptional({ default: true })
  enabled?: boolean;

  @ApiPropertyOptional()
  remark?: string;
}

export class BotAccountUpdateDto extends PartialType(BotAccountBodyDto) {
  @ApiProperty()
  id: string;
}

export class BotAccountQueryDto {
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
