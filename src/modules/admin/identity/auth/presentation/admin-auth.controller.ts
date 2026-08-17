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
   * Admin 用户登录。
   * @param body - 请求体 DTO；承载 Admin新增、更新、导入或执行字段。
   * @param req - 当前 HTTP 请求；用于可信代理后的公开 Origin 校验。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
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
   * 刷新 Admin 访问令牌。
   * @param req - 当前 HTTP 请求；提供路由、用户、请求体或查询参数。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
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
   * Admin 用户退出登录。
   * @param req - 当前 HTTP 请求；读取已签名的 refresh token。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
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
   * @param user - user 输入；驱动 `vbenSuccess()` 的 Admin步骤。
   */
  @Get('auth/codes')
  @ApiOperation({ summary: '获取当前用户按钮权限码' })
  async getAccessCodes(@CurrentAdminUser() user: AdminUser) {
    return vbenSuccess(await this.menuService.getAccessCodes(user));
  }
}
