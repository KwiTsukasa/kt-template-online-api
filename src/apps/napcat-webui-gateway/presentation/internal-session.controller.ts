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

  /**
   * 根据`secret`、`body`构造NapCat WebUI 网关会话；先通过 `requireInternalSecret` 校验输入边界。
   * @param secret - 决定NapCat WebUI 网关会话内容、边界或目标的 `secret` 值。
   * @param body - 用于NapCat WebUI 网关会话的结构化输入。
   * @returns 包含 `account`、`container`、`expiresAt`、`iframeUrl`、`sessionId` 字段的NapCat WebUI 网关会话。
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

  /**
   * 使用会话标识提交心跳续期请求，并返回续期后的会话状态。
   * @param sessionId - 用于精确定位会话的标识。
   * @param secret - 决定心跳内容、边界或目标的 `secret` 值。
   * @param body - 用于心跳的结构化输入。
   * @returns 返回续期后的网关会话状态或对应的成功响应。
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
   * 按`sessionId`、`secret`、`body`移除内部会话记录；先通过 `requireInternalSecret` 校验输入边界。
   * @param sessionId - 用于精确定位会话的标识。
   * @param secret - 决定内部会话记录内容、边界或目标的 `secret` 值。
   * @param body - 用于内部会话记录的结构化输入。
   * @returns 内部会话记录。
   */
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

  /**
   * 按输入分支映射健康状态。
   * @returns 包含 `ok`、`service` 字段的按输入分支映射健康状态。
   */
  @Get('health')
  health() {
    return {
      ok: true,
      service: 'napcat-webui-gateway',
    };
  }

  /**
   * 校验`secret`是否满足前置条件并返回必需内部密钥约束，并拒绝不合法输入。
   * @param secret - 决定前置条件并返回必需内部密钥内容、边界或目标的 `secret` 值。
   * @throws 当 `!configured || secret !== configured` 成立时拒绝当前输入并抛出 `UnauthorizedException`。
   */
  private requireInternalSecret(secret: string) {
    const configured = this.config.internalSecret();
    if (!configured || secret !== configured) {
      throw new UnauthorizedException('Gateway internal secret mismatch');
    }
  }
}
