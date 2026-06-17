import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/jwt-auth.guard';
import { Public, vbenSuccess } from '@/common';
import { BlogThemeConfigBodyDto } from './blog-theme-config.dto';
import { BlogThemeConfigService } from '../application/blog-theme-config.service';

@ApiTags('Blog - 主题')
@Controller('blog/theme')
@UseGuards(JwtAuthGuard)
export class BlogThemeConfigController {
  /**
   * 初始化 BlogThemeConfigController 实例。
   * @param blogThemeConfigService - blogThemeConfigService 服务依赖；影响 constructor 的返回值。
   */
  constructor(
    private readonly blogThemeConfigService: BlogThemeConfigService,
  ) {}

  /**
   * 获取本地博客主题配置。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   */
  @Get('config')
  @Public()
  @ApiOperation({ summary: '获取本地博客主题配置' })
  async config(@Res() res) {
    const config = await this.blogThemeConfigService.publicConfig();

    return res.send(vbenSuccess(config));
  }

  /**
   * 保存本地博客主题配置。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param body - 请求体 DTO；承载 博客新增、更新、导入或执行字段。
   */
  @Post('save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '保存本地博客主题配置' })
  async save(@Res() res, @Body() body: BlogThemeConfigBodyDto) {
    const result = await this.blogThemeConfigService.save(body);

    return res.send(vbenSuccess(result));
  }

  /**
   * 从 WordPress 导入主题配置到本地博客。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   */
  @Post('import-wordpress')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '从 WordPress 导入主题配置到本地博客' })
  async importWordpress(@Res() res) {
    const result = await this.blogThemeConfigService.importFromWordpress();

    return res.send(vbenSuccess(result));
  }
}
