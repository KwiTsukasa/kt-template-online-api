import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { NapcatWebuiGatewaySessionService } from '../application/napcat-webui-gateway-session.service';
import { NapcatWebuiGatewayConfigService } from '../config/napcat-webui-gateway-config.service';
import type {
  NapcatWebuiGatewayCreateSessionInput,
  NapcatWebuiGatewayLifecycleInput,
} from '../domain/napcat-webui-gateway.types';
import { NapcatWebuiGatewayTicketService } from '../infrastructure/session/napcat-webui-gateway-ticket.service';

type CreateSessionBody = NapcatWebuiGatewayCreateSessionInput;
type LifecycleBody = Omit<NapcatWebuiGatewayLifecycleInput, 'sessionId'>;

@Controller('internal')
export class InternalSessionController {
  /**
   * Creates the internal API-to-Gateway session controller.
   * @param sessionService - Gateway session lifecycle application service.
   * @param ticketService - One-time bootstrap ticket service.
   * @param config - Gateway config used for secret validation and public URL prefix.
   */
  constructor(
    private readonly sessionService: NapcatWebuiGatewaySessionService,
    private readonly ticketService: NapcatWebuiGatewayTicketService,
    private readonly config: NapcatWebuiGatewayConfigService,
  ) {}

  /**
   * Creates a Gateway session and returns only browser-safe bootstrap metadata.
   * @param secret - Shared API-to-Gateway secret header.
   * @param body - Internal create-session payload from the API service.
   * @returns Browser-safe session id, expiry, and relative iframe URL.
   */
  @Post('sessions')
  async createSession(
    @Headers('x-kt-gateway-secret') secret: string,
    @Body() body: CreateSessionBody,
  ) {
    this.requireInternalSecret(secret);
    const session = await this.sessionService.create(body);
    const ticket = await this.ticketService.issue(session.sessionId);

    return {
      expiresAt: session.expiresAt,
      iframeUrl: `${this.config.publicSessionPrefix()}/${
        session.sessionId
      }/bootstrap?ticket=${ticket}`,
      sessionId: session.sessionId,
    };
  }

  /**
   * Refreshes one Gateway session heartbeat from the internal API.
   * @param sessionId - Gateway session id from the route.
   * @param secret - Shared API-to-Gateway secret header.
   * @param body - Admin ownership and client evidence payload.
   * @returns Browser-safe heartbeat lifecycle result.
   */
  @Post('sessions/:sessionId/heartbeat')
  heartbeat(
    @Param('sessionId') sessionId: string,
    @Headers('x-kt-gateway-secret') secret: string,
    @Body() body: LifecycleBody,
  ) {
    this.requireInternalSecret(secret);
    return this.sessionService.heartbeat({
      ...body,
      sessionId,
    });
  }

  /**
   * Revokes one Gateway session from the internal API.
   * @param sessionId - Gateway session id from the route.
   * @param secret - Shared API-to-Gateway secret header.
   * @param body - Admin ownership and client evidence payload.
   * @returns Browser-safe revoke lifecycle result.
   */
  @Post('sessions/:sessionId/revoke')
  revoke(
    @Param('sessionId') sessionId: string,
    @Headers('x-kt-gateway-secret') secret: string,
    @Body() body: LifecycleBody,
  ) {
    this.requireInternalSecret(secret);
    return this.sessionService.revoke({
      ...body,
      sessionId,
    });
  }

  /**
   * Returns a public health response for process and route liveness checks.
   * @returns Simple Gateway health payload.
   */
  @Get('health')
  health() {
    return {
      ok: true,
      service: 'napcat-webui-gateway',
    };
  }

  /**
   * Validates the shared secret and fails closed when it is missing or mismatched.
   * @param secret - Request header value.
   */
  private requireInternalSecret(secret: string) {
    const configured = this.config.internalSecret();
    if (!configured || secret !== configured) {
      throw new UnauthorizedException('Gateway internal secret mismatch');
    }
  }
}
