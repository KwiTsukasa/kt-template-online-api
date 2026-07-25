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
import { NapcatWebuiProxyService } from '../infrastructure/proxy/napcat-webui-proxy.service';
import { NapcatWebuiGatewayTicketService } from '../infrastructure/session/napcat-webui-gateway-ticket.service';

@Controller('napcat-webui')
export class PublicWebuiController {
  constructor(
    private readonly sessionService: NapcatWebuiGatewaySessionService,
    private readonly ticketService: NapcatWebuiGatewayTicketService,
    private readonly proxyService: NapcatWebuiProxyService,
  ) {}

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
    res.cookie('kt_napcat_webui_gateway', 'active', {
      httpOnly: true,
      path: `/napcat-webui/session/${encodeURIComponent(sessionId)}`,
      sameSite: 'lax',
    });
    res.redirect(
      HttpStatus.FOUND,
      `/napcat-webui/session/${encodeURIComponent(sessionId)}/webui/webui`,
    );
  }

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

  private requireTicket(ticket: string) {
    const value = String(ticket || '').trim();
    if (!value) {
      throw new GoneException('Gateway bootstrap ticket is not active');
    }
    return value;
  }
}
