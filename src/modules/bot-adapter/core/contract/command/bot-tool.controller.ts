import { Controller, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { BotToolSessionService } from '../../application/command/bot-tool-session.service';

@Controller('bot/tools')
export class BotToolController {
  constructor(
    private readonly config: ConfigService,
    private readonly sessions: BotToolSessionService,
  ) {}

  /**
   * 验证 NAS Hermes 的已有服务凭据，再按当前消息上下文执行受限命令工具。
   * @param request - 携带服务凭据及执行层上下文的请求。
   * @param response - 不经过管理端响应包装的工具响应。
   * @returns HTTP 鉴权、业务拒绝或工具结果。
   */
  @Post('call')
  async call(@Req() request: Request, @Res() response: Response) {
    const key = this.config.get<string>('HERMES_AGENT_API_KEY') || '';
    const actual = Buffer.from(request.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${key}`);
    if (
      !key ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      return response.status(401).json({ error: 'Unauthorized' });
    }
    const body = request.body as Record<string, unknown> | undefined;
    if (!body || typeof body.contextId !== 'string')
      return response.status(400).json({ error: 'Invalid context' });
    try {
      return response.status(200).json({
        result: await this.sessions.call(body.contextId, body),
      });
    } catch (error) {
      let message = '工具调用失败';
      if (error instanceof Error) message = error.message;
      return response.status(403).json({ error: message });
    }
  }
}
