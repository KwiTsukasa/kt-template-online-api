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
import { CurrentAdminUser, throwVbenError, vbenSuccess } from '@/common';
import type { AdminRequest } from '@/modules/admin/contract/admin.types';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/jwt-auth.guard';
import { AdminUser } from '@/modules/admin/identity/user/admin-user.entity';
import { QqbotNapcatWebuiGatewayService } from '../application/qqbot-napcat-webui-gateway.service';
import {
  QqbotNapcatWebuiSessionCreateDto,
  QqbotNapcatWebuiSessionResponseDto,
} from './qqbot-napcat-webui-gateway.dto';

const WEBUI_PERMISSION_AUTH_CODE = 'QqBot:Account:WebUI';
const ACCOUNT_ID_PATTERN = /^[1-9]\d{0,31}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

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
    this.assertWebuiPermission(user);

    return vbenSuccess(
      await this.gatewayService.createSession({
        accountId: this.requireAccountId(body.accountId),
        ...this.toClientEvidence(user, req),
      }),
    );
  }

  /**
   * Refreshes the Gateway heartbeat for one active WebUI session.
   * @param sessionId - Gateway session id returned by the create-session endpoint.
   * @param user - Authenticated Admin user from JwtAuthGuard.
   * @param req - Express request used only for IP and user-agent Gateway evidence.
   * @returns Vben response containing Gateway lifecycle state.
   */
  @Post('session/:sessionId/heartbeat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '刷新 NapCat WebUI Gateway 会话心跳' })
  async heartbeat(
    @Param('sessionId') sessionId: string,
    @CurrentAdminUser() user: AdminUser,
    @Req() req: AdminRequest,
  ) {
    this.assertWebuiPermission(user);

    return vbenSuccess(
      await this.gatewayService.heartbeat({
        sessionId: this.requireSessionId(sessionId),
        ...this.toClientEvidence(user, req),
      }),
    );
  }

  /**
   * Revokes one active WebUI Gateway session.
   * @param sessionId - Gateway session id returned by the create-session endpoint.
   * @param user - Authenticated Admin user from JwtAuthGuard.
   * @param req - Express request used only for IP and user-agent Gateway evidence.
   * @returns Vben response containing Gateway lifecycle state.
   */
  @Post('session/:sessionId/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '撤销 NapCat WebUI Gateway 会话' })
  async revoke(
    @Param('sessionId') sessionId: string,
    @CurrentAdminUser() user: AdminUser,
    @Req() req: AdminRequest,
  ) {
    this.assertWebuiPermission(user);

    return vbenSuccess(
      await this.gatewayService.revoke({
        sessionId: this.requireSessionId(sessionId),
        ...this.toClientEvidence(user, req),
      }),
    );
  }

  /**
   * Enforces the Admin menu permission required for NapCat WebUI session access.
   * @param user - Authenticated Admin user with eager role/menu relations.
   */
  private assertWebuiPermission(user: AdminUser) {
    if (!this.hasWebuiPermission(user)) {
      throwVbenError('无权访问 NapCat WebUI', HttpStatus.FORBIDDEN);
    }
  }

  /**
   * Checks active roles for WebUI menu permission, allowing active super role as bypass.
   * @param user - Authenticated Admin user.
   * @returns Whether the user may create or manage WebUI Gateway sessions.
   */
  private hasWebuiPermission(user: AdminUser) {
    const roles = Array.isArray(user?.roles) ? user.roles : [];
    return roles.some((role) => {
      if (!role || role.isDeleted || role.status !== 1) return false;
      if (role.roleCode === 'super') return true;

      const menus = Array.isArray(role.menus) ? role.menus : [];
      return menus.some((menu) => {
        return (
          !!menu &&
          !menu.isDeleted &&
          (menu.status === undefined || menu.status === 1) &&
          menu.authCode === WEBUI_PERMISSION_AUTH_CODE
        );
      });
    });
  }

  /**
   * Validates a QQBot account id before handing work to the application service.
   * @param accountId - Candidate account id from the request body.
   * @returns Trimmed account id.
   */
  private requireAccountId(accountId: string) {
    const normalized = String(accountId || '').trim();
    if (!ACCOUNT_ID_PATTERN.test(normalized)) {
      throwVbenError('QQBot 账号ID不合法', HttpStatus.BAD_REQUEST);
    }
    return normalized;
  }

  /**
   * Validates a Gateway session id before lifecycle forwarding.
   * @param sessionId - Candidate session id from the route.
   * @returns Trimmed Gateway session id.
   */
  private requireSessionId(sessionId: string) {
    const normalized = String(sessionId || '').trim();
    if (!SESSION_ID_PATTERN.test(normalized)) {
      throwVbenError('Gateway 会话ID不合法', HttpStatus.BAD_REQUEST);
    }
    return normalized;
  }

  /**
   * Builds the Admin actor and client evidence passed through to Gateway ownership checks.
   * @param user - Authenticated Admin user.
   * @param req - Express request carrying IP and user-agent.
   * @returns Lifecycle evidence for application and Gateway calls.
   */
  private toClientEvidence(user: AdminUser, req: AdminRequest) {
    const userAgent = req.headers['user-agent'];

    return {
      adminUserId: user.id,
      clientIp: req.ip,
      userAgent: Array.isArray(userAgent) ? userAgent.join(', ') : userAgent,
    };
  }
}
