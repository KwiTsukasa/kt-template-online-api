import {
  Controller,
  Param,
  Post,
  Req,
  Res,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { TencentBotService } from '../infrastructure/tencent-bot.service';

@ApiTags('BotAdapter - Tencent Webhook')
@Controller('bot-adapter/tencent')
export class TencentBotWebhookController {
  constructor(private readonly officialService: TencentBotService) {}

  /**
   * 接收 QQ 开放平台 challenge 与事件推送，原始请求体仅在账号 URL token 和官方签名校验后进入业务链。
   * @param appId - 回调 URL 绑定的 QQ 官方 Bot AppID。
   * @param webhookToken - 使用 AppSecret 派生的账号级 URL capability token。
   * @param request - 携带 Nest 原始请求体和 QQ 签名头的 Express 请求。
   * @param response - 用于返回 challenge、ACK 或固定错误的 Express 响应。
   * @returns 已发送的 Express 响应。
   */
  @Post('webhook/:appId/:webhookToken')
  @ApiOperation({ summary: 'QQ 官方 Bot Webhook 回调' })
  async webhook(
    @Param('appId') appId: string,
    @Param('webhookToken') webhookToken: string,
    @Req() request: RawBodyRequest<Request>,
    @Res() response: Response,
  ) {
    if (!Buffer.isBuffer(request.rawBody)) {
      return response.status(400).json({ error: 'raw body unavailable' });
    }
    const result = await this.officialService.handleWebhook({
      appId,
      body: request.rawBody,
      signature: readHeader(request, 'x-signature-ed25519'),
      timestamp: readHeader(request, 'x-signature-timestamp'),
      webhookToken,
    });
    return response.status(result.status).json(result.body);
  }
}

/**
 * 从 Express 请求读取单值头；多值头只接受第一项，缺失时返回空字符串。
 * @param request - 当前 Webhook 请求。
 * @param name - 已规范为小写的 QQ 官方签名头名称。
 * @returns 首个头值或空字符串。
 */
function readHeader(request: Request, name: string) {
  const value = request.headers[name];
  if (Array.isArray(value)) return value[0] || '';
  return `${value || ''}`;
}
