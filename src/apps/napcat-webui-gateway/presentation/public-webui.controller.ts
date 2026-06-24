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
  /**
   * Creates the browser-facing NapCat WebUI controller.
   * @param sessionService - Gateway session lifecycle service.
   * @param ticketService - One-time bootstrap ticket service.
   * @param proxyService - HTTP/WebSocket proxy delegation service.
   */
  constructor(
    private readonly sessionService: NapcatWebuiGatewaySessionService,
    private readonly ticketService: NapcatWebuiGatewayTicketService,
    private readonly proxyService: NapcatWebuiProxyService,
  ) {}

  /**
   * Redeems a one-time bootstrap ticket, activates the session, and enters WebUI.
   * @param sessionId - Gateway session id from the public route.
   * @param ticket - One-time ticket issued by the internal create-session endpoint.
   * @param res - Express response used to set the scoped cookie and redirect.
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

  /**
   * Delegates Gateway-owned WebUI HTTP routes to the proxy service.
   * @param sessionId - Gateway session id from the public route.
   * @param proxyPath - Path-to-regexp route tail for the upstream pathname.
   * @param req - Express request passed through to HPM.
   * @param res - Express response passed through to HPM.
   * @param next - Express next callback passed through to HPM.
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
   * Requires a non-empty bootstrap ticket before touching the ticket store.
   * @param ticket - Candidate query ticket.
   * @returns Trimmed ticket value.
   */
  private requireTicket(ticket: string) {
    const value = String(ticket || '').trim();
    if (!value) {
      throw new GoneException('Gateway bootstrap ticket is not active');
    }
    return value;
  }
}
