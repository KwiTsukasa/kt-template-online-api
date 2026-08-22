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
import { NapcatWebuiGatewayService } from '../application/napcat-webui-gateway.service';
import {
  NapcatWebuiSessionCreateDto,
  NapcatWebuiSessionResponseDto,
} from './napcat-webui-gateway.dto';

const WEBUI_PERMISSION_AUTH_CODE = 'Bot:Account:WebUI';
const ACCOUNT_ID_PATTERN = /^[1-9]\d{0,31}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

@ApiTags('Bot - NapCat WebUI Gateway')
@Controller('bot-adapter/napcat/webui')
@UseGuards(JwtAuthGuard)
export class NapcatWebuiGatewayController {
  constructor(private readonly gatewayService: NapcatWebuiGatewayService) {}

  /**
   * 根据`body`、`user`、`req`构造NapCat WebUI 网关会话；先通过 `assertWebuiPermission` 校验输入边界。
   * @param body - 用于NapCat WebUI 网关会话的结构化输入，包含 `accountId` 字段。
   * @param user - 决定是否启用“用户”分支的布尔选项。
   * @param req - 用于NapCat WebUI 网关会话的当前 HTTP 请求。
   * @returns NapCat WebUI 网关会话。
   */
  @Post('session')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '创建 NapCat WebUI Gateway 会话' })
  @ApiOkResponse({ type: NapcatWebuiSessionResponseDto })
  async createSession(
    @Body() body: NapcatWebuiSessionCreateDto,
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
   * 使用会话标识提交心跳续期请求，并返回续期后的会话状态。
   * @param sessionId - 用于精确定位会话的标识。
   * @param user - 决定是否启用“用户”分支的布尔选项。
   * @param req - 用于心跳的当前 HTTP 请求。
   * @returns 返回续期后的网关会话状态或对应的成功响应。
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
   * 按`sessionId`、`user`、`req`移除BotNapCatWebUI记录；先通过 `assertWebuiPermission` 校验输入边界。
   * @param sessionId - 用于精确定位会话的标识。
   * @param user - 决定是否启用“用户”分支的布尔选项。
   * @param req - 用于BotNapCatWebUI记录的当前 HTTP 请求。
   * @returns BotNapCatWebUI记录。
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
   * 校验`user`是否满足WebUI权限约束，并拒绝不合法输入。
   * @param user - 决定是否启用“用户”分支的布尔选项。
   */
  private assertWebuiPermission(user: AdminUser) {
    if (!this.hasWebuiPermission(user)) {
      throwVbenError('无权访问 NapCat WebUI', HttpStatus.FORBIDDEN);
    }
  }

  /**
   * 根据`user`与当前约束判定WebUI权限是否存在。
   * @param user - 决定是否启用“用户”分支的布尔选项。
   * @returns 满足WebUI权限是否存在约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private hasWebuiPermission(user: AdminUser) {
    const roles = (() => {
      if (Array.isArray(user?.roles)) {
        return user.roles;
      }
      return [];
    })();
    return roles.some((role) => {
      if (!role || role.isDeleted || role.status !== 1) return false;
      if (role.roleCode === 'super') return true;

      const menus = (() => {
        if (Array.isArray(role.menus)) {
          return role.menus;
        }
        return [];
      })();
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
   * 校验`accountId`是否满足前置条件并返回必需账号标识约束，并拒绝不合法输入。
   * @param accountId - 用于精确定位账号的标识。
   * @returns 前置条件并返回必需账号标识。
   */
  private requireAccountId(accountId: string) {
    const normalized = String(accountId || '').trim();
    if (!ACCOUNT_ID_PATTERN.test(normalized)) {
      throwVbenError('Bot 账号ID不合法', HttpStatus.BAD_REQUEST);
    }
    return normalized;
  }

  /**
   * 校验`sessionId`是否满足前置条件并返回必需会话标识约束，并拒绝不合法输入。
   * @param sessionId - 用于精确定位会话的标识。
   * @returns 前置条件并返回必需会话标识。
   */
  private requireSessionId(sessionId: string) {
    const normalized = String(sessionId || '').trim();
    if (!SESSION_ID_PATTERN.test(normalized)) {
      throwVbenError('Gateway 会话ID不合法', HttpStatus.BAD_REQUEST);
    }
    return normalized;
  }

  /**
   * 将输入收敛并投影为客户端证据。
   * @param user - 决定是否启用“用户”分支的布尔选项。
   * @param req - 用于客户端证据的当前 HTTP 请求，包含 `headers`、`ip` 字段。
   * @returns 包含 `adminUserId`、`clientIp`、`userAgent` 字段的客户端证据。
   */
  private toClientEvidence(user: AdminUser, req: AdminRequest) {
    const userAgent = req.headers['user-agent'];

    return {
      adminUserId: user.id,
      clientIp: req.ip,
      userAgent: (() => {
        if (Array.isArray(userAgent)) {
          return userAgent.join(', ');
        }
        return userAgent;
      })(),
    };
  }
}
