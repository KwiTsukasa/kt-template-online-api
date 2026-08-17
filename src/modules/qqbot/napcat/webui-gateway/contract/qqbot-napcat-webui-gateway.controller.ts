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
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
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
  constructor(
    private readonly gatewayService: QqbotNapcatWebuiGatewayService,
  ) {}

  /** 创建会话。 */
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

  /** 返回心跳。 */
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

  /** 吊销QQBotNapCatWebUI记录。 */
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

  /** 断言WebUI权限。 */
  private assertWebuiPermission(user: AdminUser) {
    if (!this.hasWebuiPermission(user)) {
      throwVbenError('无权访问 NapCat WebUI', HttpStatus.FORBIDDEN);
    }
  }

  /** 判断WebUI权限是否存在。 */
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

  /** 返回必需账号标识。 */
  private requireAccountId(accountId: string) {
    const normalized = String(accountId || '').trim();
    if (!ACCOUNT_ID_PATTERN.test(normalized)) {
      throwVbenError('QQBot 账号ID不合法', HttpStatus.BAD_REQUEST);
    }
    return normalized;
  }

  /** 返回必需会话标识。 */
  private requireSessionId(sessionId: string) {
    const normalized = String(sessionId || '').trim();
    if (!SESSION_ID_PATTERN.test(normalized)) {
      throwVbenError('Gateway 会话ID不合法', HttpStatus.BAD_REQUEST);
    }
    return normalized;
  }

  /** 返回到客户端证据。 */
  private toClientEvidence(user: AdminUser, req: AdminRequest) {
    const userAgent = req.headers['user-agent'];

    return {
      adminUserId: user.id,
      clientIp: req.ip,
      userAgent: Array.isArray(userAgent) ? userAgent.join(', ') : userAgent,
    };
  }
}
