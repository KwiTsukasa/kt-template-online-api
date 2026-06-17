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
import { CurrentAdminUser, Public, vbenSuccess } from '@/common';
import { AdminMenuService } from '../menu/admin-menu.service';
import { AdminUser } from '../user/admin-user.entity';
import { AdminUserService } from '../user/admin-user.service';
import { AdminAuthService } from './admin-auth.service';
import { AdminLoginDto } from './admin-auth.dto';
import { AdminPasswordCryptoService } from './admin-password-crypto.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { WordpressService } from '@/modules/wordpress/application/wordpress.service';

@ApiTags('Admin - 认证')
@Controller()
@UseGuards(JwtAuthGuard)
export class AdminAuthController {
  /**
   * 初始化 AdminAuthController 实例。
   * @param authService - authService 服务依赖；影响 constructor 的返回值。
   * @param passwordCryptoService - passwordCryptoService 服务依赖；影响 constructor 的返回值。
   * @param menuService - menuService 服务依赖；影响 constructor 的返回值。
   * @param userService - userService 服务依赖；影响 constructor 的返回值。
   * @param wordpressService - wordpressService 服务依赖；影响 constructor 的返回值。
   */
  constructor(
    private readonly authService: AdminAuthService,
    private readonly passwordCryptoService: AdminPasswordCryptoService,
    private readonly menuService: AdminMenuService,
    private readonly userService: AdminUserService,
    private readonly wordpressService: WordpressService,
  ) {}

  /**
   * 获取 Admin 登录密码加密公钥。
   */
  @Get('auth/password-public-key')
  @ApiOperation({ summary: '获取 Admin 登录密码加密公钥' })
  @Public()
  getPasswordPublicKey() {
    return vbenSuccess(this.passwordCryptoService.getPublicKey());
  }

  /**
   * Admin 用户登录。
   * @param body - 请求体 DTO；承载 Admin新增、更新、导入或执行字段。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   */
  @Post('auth/login')
  @ApiOperation({ summary: 'Admin 用户登录' })
  @Public()
  async login(
    @Body() body: AdminLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const password = this.passwordCryptoService.decryptPassword(
      body.encryptedPassword,
    );
    const { accessToken, refreshToken, user } = await this.authService.login(
      body.username,
      password,
    );
    const wordpressLogin =
      await this.wordpressService.tryLoginWithConfiguredAdmin();
    this.authService.setAccessTokenCookie(res, accessToken);
    this.authService.setRefreshTokenCookie(res, refreshToken);
    if (wordpressLogin.available) {
      this.wordpressService.setAuthCookie(res, wordpressLogin.result.cookie);
    } else {
      this.wordpressService.clearAuthCookie(res);
    }

    return vbenSuccess({
      ...this.userService.serializeUser(user),
      accessToken,
      wordpressAuth: wordpressLogin.available
        ? {
            ...wordpressLogin.result.auth,
            user: wordpressLogin.result.user,
          }
        : null,
      wordpressAvailable: wordpressLogin.available,
      wordpressError: wordpressLogin.error,
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
    const refreshToken = this.authService.getRefreshTokenFromRequest(req);
    const refreshed = await this.authService.refresh(refreshToken);
    this.authService.setAccessTokenCookie(res, refreshed.accessToken);
    this.authService.setRefreshTokenCookie(res, refreshed.refreshToken);
    return refreshed.accessToken;
  }

  /**
   * Admin 用户退出登录。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   */
  @Post('auth/logout')
  @ApiOperation({ summary: 'Admin 用户退出登录' })
  @Public()
  logout(@Res({ passthrough: true }) res: Response) {
    this.authService.clearAccessTokenCookie(res);
    this.authService.clearRefreshTokenCookie(res);
    this.wordpressService.clearAuthCookie(res);
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
