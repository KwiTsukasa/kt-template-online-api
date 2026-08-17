import {
  All,
  Controller,
  Get,
  GoneException,
  HttpStatus,
  Next,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { NapcatWebuiGatewaySessionService } from '../application/napcat-webui-gateway-session.service';
import { NapcatWebuiGatewayConfigService } from '../config/napcat-webui-gateway-config.service';
import { NapcatWebuiProxyService } from '../infrastructure/proxy/napcat-webui-proxy.service';
import { NapcatWebuiGatewayTicketService } from '../infrastructure/session/napcat-webui-gateway-ticket.service';

@Controller('napcat-webui')
export class PublicWebuiController {
  constructor(
    private readonly sessionService: NapcatWebuiGatewaySessionService,
    private readonly ticketService: NapcatWebuiGatewayTicketService,
    private readonly proxyService: NapcatWebuiProxyService,
    private readonly config: NapcatWebuiGatewayConfigService,
  ) {}

  /**
   * 消费一次性引导票据并激活对应会话，随后写入会话路径 Cookie 并重定向到 NapCat WebUI。
   * @param sessionId - 路由中声明的待激活网关会话标识。
   * @param ticket - 仅可兑换一次的网关引导票据。
   * @param res - 用于写入会话 Cookie 和跳转响应的 HTTP 响应对象。
   * @throws 票据兑换出的会话与路由会话不一致时抛出 `GoneException`。
   */
  @Get('session/:sessionId/bootstrap')
  async bootstrap(
    @Param('sessionId') sessionId: string,
    @Query('ticket') ticket: string,
    @Res() res: Response,
  ) {
    const redeemedSessionId = await this.ticketService.redeem(
      this.requireTicket(ticket),
    );
    if (redeemedSessionId !== sessionId) {
      throw new GoneException('Gateway bootstrap ticket is not active');
    }

    await this.sessionService.requireBootstrapSession(sessionId);
    await this.sessionService.markActive(sessionId);
    const publicSessionPath = `${this.config.publicSessionPrefix()}/${encodeURIComponent(
      sessionId,
    )}`;
    res.cookie('kt_napcat_webui_gateway', 'active', {
      httpOnly: true,
      path: publicSessionPath,
      sameSite: 'lax',
    });
    res.redirect(HttpStatus.FOUND, `${publicSessionPath}/webui/webui`);
  }

  /**
   * 把当前 HTTP 请求委托给受控上游代理。
   * @param sessionId - 用于精确定位会话的标识。
   * @param proxyPath - 必须保持在受控根目录内的代理路径。
   * @param req - 用于把当前 HTTP 请求委托给受控上游代理的当前 HTTP 请求。
   * @param res - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @param next - 决定把当前 HTTP 请求委托给受控上游代理内容、边界或目标的 `next` 值。
   * @returns 把当前 HTTP 请求委托给受控上游代理。
   */
  @All('session/:sessionId/webui/*proxyPath')
  proxy(
    @Param('sessionId') sessionId: string,
    @Param('proxyPath') proxyPath: string | string[] | undefined,
    @Req() req: Request,
    @Res() res: Response,
    @Next() next: NextFunction,
  ) {
    return this.proxyService.handleHttpProxy(
      sessionId,
      proxyPath,
      req,
      res,
      next,
    );
  }

  /**
   * 去除票据两端空白，并在兑换前拒绝缺失的引导凭据。
   * @param ticket - 查询参数携带的一次性网关引导票据。
   * @returns 去除两端空白后的非空票据。
   * @throws 票据为空或仅含空白时抛出 `GoneException`。
   */
  private requireTicket(ticket: string) {
    const value = String(ticket || '').trim();
    if (!value) {
      throw new GoneException('Gateway bootstrap ticket is not active');
    }
    return value;
  }
}
