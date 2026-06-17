import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/jwt-auth.guard';
import { Public, vbenSuccess } from '@/common';
import { WordpressService } from '../application/wordpress.service';

@ApiTags('WordPress - 主题')
@Controller('wordpress/theme')
@UseGuards(JwtAuthGuard)
export class WordpressThemeController {
  /**
   * 初始化 WordpressThemeController 实例。
   * @param wordpressService - wordpressService 服务依赖；影响 constructor 的返回值。
   */
  constructor(private readonly wordpressService: WordpressService) {}

  /**
   * 获取 WordPress Argon 主题配置。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   */
  @Get('config')
  @Public()
  @ApiOperation({ summary: '获取 WordPress Argon 主题配置' })
  async config(@Res() res) {
    const config = await this.wordpressService.themeConfig();

    return res.send(vbenSuccess(config));
  }
}
