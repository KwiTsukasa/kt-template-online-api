import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  CurrentAdminUser,
  Public,
  TrustedCredentialTransportService,
  vbenSuccess,
} from '@/common';
import { AdminMenuService } from '@/modules/admin/identity/menu/admin-menu.service';
import { AdminUser } from '@/modules/admin/identity/user/admin-user.entity';
import { AdminUserService } from '@/modules/admin/identity/user/admin-user.service';
import { AdminAuthService } from '@/modules/admin/identity/auth/application/admin-auth.service';
import { AdminLoginDto } from '@/modules/admin/identity/auth/contract/admin-auth.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@ApiTags('Admin - 认证')
@Controller()
@UseGuards(JwtAuthGuard)
export class AdminAuthController {
  constructor(
    private readonly authService: AdminAuthService,
    private readonly trustedCredentialTransportService: TrustedCredentialTransportService,
    private readonly menuService: AdminMenuService,
    private readonly userService: AdminUserService,
  ) {}

  /**
   * 根据`body`、`req`、`res`处理Admin 用户登录；先通过 `trustedCredentialTransportService.assertTrusted` 校验输入边界。
   * @param body - 用于Admin 用户登录的结构化输入，包含 `username`、`password` 字段。
   * @param req - 用于Admin 用户登录的当前 HTTP 请求。
   * @param res - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns Admin 用户登录。
   */
  @Post('auth/login')
  @ApiOperation({ summary: 'Admin 用户登录' })
  @Public()
  async login(
    @Body() body: AdminLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.trustedCredentialTransportService.assertTrusted(req);
    const { accessToken, refreshToken, user } = await this.authService.login(
      body.username,
      body.password,
    );
    this.authService.setAccessTokenCookie(res, accessToken);
    this.authService.setRefreshTokenCookie(res, refreshToken);

    return vbenSuccess({
      ...this.userService.serializeUser(user),
      accessToken,
    });
  }

  /**
   * 校验凭据传输边界后用请求中的刷新令牌轮换会话，并把新访问令牌与刷新令牌写回 Cookie。
   * @param req - 用于刷新结果的当前 HTTP 请求。
   * @param res - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 刷新。
   */
  @Post('auth/refresh')
  @ApiOperation({ summary: '刷新 Admin 访问令牌' })
  @Public()
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.trustedCredentialTransportService.assertTrusted(req);
    const refreshToken = this.authService.getRefreshTokenFromRequest(req);
    const refreshed = await this.authService.refresh(refreshToken, res);
    this.authService.setAccessTokenCookie(res, refreshed.accessToken);
    this.authService.setRefreshTokenCookie(res, refreshed.refreshToken);
    return refreshed.accessToken;
  }

  /**
   * 校验刷新令牌后消费账号级退出限流并撤销对应服务端会话；令牌缺失或无效时直接结束。
   * @param req - 用于刷新令牌后消费账号级退出限流并撤销对应服务端会话的当前 HTTP 请求。
   * @param res - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 刷新令牌后消费账号级退出限流并撤销对应服务端会话。
   */
  @Post('auth/logout')
  @ApiOperation({ summary: 'Admin 用户退出登录' })
  @Public()
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.trustedCredentialTransportService.assertTrusted(req);
    await this.authService.logout(
      this.authService.getRefreshTokenFromRequest(req),
      res,
    );
    this.authService.clearAccessTokenCookie(res);
    this.authService.clearRefreshTokenCookie(res);
    return vbenSuccess('');
  }

  /**
   * 获取当前用户按钮权限码。
   * @param user - 决定是否启用“用户”分支的布尔选项。
   * @returns 当前用户按钮权限码。
   */
  @Get('auth/codes')
  @ApiOperation({ summary: '获取当前用户按钮权限码' })
  async getAccessCodes(@CurrentAdminUser() user: AdminUser) {
    return vbenSuccess(await this.menuService.getAccessCodes(user));
  }
}
