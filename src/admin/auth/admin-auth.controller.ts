import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentAdminUser, Public, vbenSuccess } from '@/common';
import { AdminMenuService } from '../menu/admin-menu.service';
import { AdminUser } from '../user/admin-user.entity';
import { AdminUserService } from '../user/admin-user.service';
import { AdminAuthService } from './admin-auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { WordpressService } from '@/wordpress/wordpress.service';

@ApiTags('admin-auth')
@Controller()
@UseGuards(JwtAuthGuard)
export class AdminAuthController {
  constructor(
    private readonly authService: AdminAuthService,
    private readonly menuService: AdminMenuService,
    private readonly userService: AdminUserService,
    private readonly wordpressService: WordpressService,
  ) {}

  @Post('auth/login')
  @Public()
  async login(
    @Body() body: { password?: string; username?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken, user } = await this.authService.login(
      body.username,
      body.password,
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

  @Post('auth/refresh')
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

  @Post('auth/logout')
  @Public()
  logout(@Res({ passthrough: true }) res: Response) {
    this.authService.clearAccessTokenCookie(res);
    this.authService.clearRefreshTokenCookie(res);
    this.wordpressService.clearAuthCookie(res);
    return vbenSuccess('');
  }

  @Get('auth/codes')
  async getAccessCodes(@CurrentAdminUser() user: AdminUser) {
    return vbenSuccess(await this.menuService.getAccessCodes(user));
  }
}
