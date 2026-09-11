import { Controller, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { TencentBotService } from '../infrastructure/tencent-bot.service';

@Controller('bot-adapter/tencent/profile')
export class TencentBotProfileController {
  constructor(
    private readonly config: ConfigService,
    private readonly official: TencentBotService,
  ) {}

  /**
   * 验证 NAS 服务凭据后读取指定已启用账号的官方资料，不传递账号密钥或代理写请求。
   * @param request - 仅携带稳定账号身份的内部请求。
   * @param response - 不经过管理端包装的有限资料响应。
   * @returns 鉴权结果、账号不可用或官方资料。
   */
  @Post('read')
  async read(@Req() request: Request, @Res() response: Response) {
    const key = this.config.get<string>('PERSONA_EXECUTOR_TOKEN') || '';
    const actual = Buffer.from(request.headers.authorization || '');
    const expected = Buffer.from('Bearer ' + key);
    if (
      key.length < 32 ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    )
      return response.status(401).json({ error: 'unauthorized' });
    const selfId = request.body?.selfId;
    if (
      typeof selfId !== 'string' ||
      !/^qq-official:[1-9]\d{4,11}$/u.test(selfId)
    )
      return response.status(400).json({ error: 'invalid_identity' });
    try {
      return response
        .status(200)
        .json(await this.official.readOwnProfile(selfId));
    } catch {
      return response
        .status(503)
        .json({ error: 'official_profile_unavailable' });
    }
  }
}
