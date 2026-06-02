import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '@/admin/auth/jwt-auth.guard';
import { Public, vbenSuccess } from '@/common';
import { WordpressService } from './wordpress.service';

@ApiTags('WordPress - 认证')
@ApiHeader({
  name: 'X-WordPress-Authorization',
  required: false,
  description: 'WordPress 客户端登录后拿到的授权头，例如 Bearer token',
})
@ApiHeader({
  name: 'X-WP-Nonce',
  required: false,
  description: 'WordPress REST cookie 认证 nonce',
})
@Controller('wordpress/auth')
@UseGuards(JwtAuthGuard)
export class WordpressAuthController {
  constructor(private readonly wordpressService: WordpressService) {}

  @Post('login')
  @ApiOperation({ summary: '使用环境变量中的 WordPress 管理员账号自动认证' })
  async login(@Res({ passthrough: true }) res: Response) {
    const { auth, cookie, user } =
      await this.wordpressService.loginWithConfiguredAdmin();
    this.wordpressService.setAuthCookie(res, cookie);

    return vbenSuccess({
      auth,
      user,
    });
  }

  @Post('logout')
  @Public()
  @ApiOperation({ summary: '清理本系统保存的 WordPress 授权态' })
  logout(@Res({ passthrough: true }) res: Response) {
    this.wordpressService.clearAuthCookie(res);

    return vbenSuccess(true);
  }

  @Get('check')
  @ApiOperation({ summary: '校验 WordPress 客户端登录态' })
  async check(@Req() req: Request, @Res() res) {
    const auth = this.wordpressService.getAuthContext(req);
    const user = await this.wordpressService.checkAuth(auth);

    return res.send(vbenSuccess(user));
  }
}
