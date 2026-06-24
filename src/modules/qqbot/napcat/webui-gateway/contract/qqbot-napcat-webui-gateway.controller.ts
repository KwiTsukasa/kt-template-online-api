import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAdminUser, vbenSuccess } from '@/common';
import type { AdminRequest } from '@/modules/admin/contract/admin.types';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/jwt-auth.guard';
import { AdminUser } from '@/modules/admin/identity/user/admin-user.entity';
import { QqbotNapcatWebuiGatewayService } from '../application/qqbot-napcat-webui-gateway.service';
import {
  QqbotNapcatWebuiSessionCreateDto,
  QqbotNapcatWebuiSessionResponseDto,
} from './qqbot-napcat-webui-gateway.dto';

@ApiTags('QQBot - NapCat WebUI Gateway')
@Controller('qqbot/napcat/webui')
@UseGuards(JwtAuthGuard)
export class QqbotNapcatWebuiGatewayController {
  /**
   * Creates the Admin-authenticated WebUI Gateway controller.
   * @param gatewayService - Application service that creates, heartbeats, and revokes Gateway sessions.
   */
  constructor(
    private readonly gatewayService: QqbotNapcatWebuiGatewayService,
  ) {}

  /**
   * Creates a browser-safe Gateway session for an account-bound NapCat WebUI.
   * @param body - Request body containing the QQBot account id.
   * @param user - Authenticated Admin user from JwtAuthGuard.
   * @param req - Express request used only for IP and user-agent audit evidence.
   * @returns Vben response containing safe session metadata for the Admin page.
   */
  @Post('session')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '创建 NapCat WebUI Gateway 会话' })
  @ApiOkResponse({ type: QqbotNapcatWebuiSessionResponseDto })
  async createSession(
    @Body() body: QqbotNapcatWebuiSessionCreateDto,
    @CurrentAdminUser() user: AdminUser,
    @Req() req: AdminRequest,
  ) {
    const userAgent = req.headers['user-agent'];

    return vbenSuccess(
      await this.gatewayService.createSession({
        accountId: body.accountId,
        adminUserId: user.id,
        clientIp: req.ip,
        userAgent: Array.isArray(userAgent) ? userAgent.join(', ') : userAgent,
      }),
    );
  }

  /**
   * Refreshes the Gateway heartbeat for one active WebUI session.
   * @param sessionId - Gateway session id returned by the create-session endpoint.
   * @returns Vben response containing Gateway lifecycle state.
   */
  @Post('session/:sessionId/heartbeat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '刷新 NapCat WebUI Gateway 会话心跳' })
  async heartbeat(@Param('sessionId') sessionId: string) {
    return vbenSuccess(await this.gatewayService.heartbeat(sessionId));
  }

  /**
   * Revokes one active WebUI Gateway session.
   * @param sessionId - Gateway session id returned by the create-session endpoint.
   * @returns Vben response containing Gateway lifecycle state.
   */
  @Post('session/:sessionId/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '撤销 NapCat WebUI Gateway 会话' })
  async revoke(@Param('sessionId') sessionId: string) {
    return vbenSuccess(await this.gatewayService.revoke(sessionId));
  }
}
