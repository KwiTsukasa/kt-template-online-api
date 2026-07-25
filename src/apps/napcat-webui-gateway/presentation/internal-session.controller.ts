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
import { NapcatWebuiCredentialClient } from '../infrastructure/napcat-webui-credential.client';
import { NapcatWebuiGatewayTicketService } from '../infrastructure/session/napcat-webui-gateway-ticket.service';

type CreateSessionBody = NapcatWebuiGatewayCreateSessionInput;
type LifecycleBody = Omit<NapcatWebuiGatewayLifecycleInput, 'sessionId'>;

@Controller('internal')
export class InternalSessionController {
  constructor(
    private readonly sessionService: NapcatWebuiGatewaySessionService,
    private readonly ticketService: NapcatWebuiGatewayTicketService,
    private readonly credentialClient: NapcatWebuiCredentialClient,
    private readonly config: NapcatWebuiGatewayConfigService,
  ) {}

  @Post('sessions')
  async createSession(
    @Headers('x-kt-gateway-secret') secret: string,
    @Body() body: CreateSessionBody,
  ) {
    this.requireInternalSecret(secret);
    const session = await this.sessionService.create(body);
    const ticket = await this.ticketService.issue(session.sessionId);

    return {
      account: {
        accountId: session.accountId,
        selfId: session.selfId,
      },
      container: {
        containerName: session.containerName,
      },
      expiresAt: session.expiresAt,
      iframeUrl: `${this.config.publicSessionPrefix()}/${
        session.sessionId
      }/bootstrap?ticket=${ticket}`,
      sessionId: session.sessionId,
    };
  }

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

  @Post('sessions/:sessionId/revoke')
  async revoke(
    @Param('sessionId') sessionId: string,
    @Headers('x-kt-gateway-secret') secret: string,
    @Body() body: LifecycleBody,
  ) {
    this.requireInternalSecret(secret);
    const result = await this.sessionService.revoke({
      ...body,
      sessionId,
    });
    this.credentialClient.clear(sessionId);
    return result;
  }

  @Get('health')
  health() {
    return {
      ok: true,
      service: 'napcat-webui-gateway',
    };
  }

  private requireInternalSecret(secret: string) {
    const configured = this.config.internalSecret();
    if (!configured || secret !== configured) {
      throw new UnauthorizedException('Gateway internal secret mismatch');
    }
  }
}
