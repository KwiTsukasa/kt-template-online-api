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
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { Public, vbenSuccess } from '@/common';
import { BlogThemeConfigBodyDto } from './blog-theme-config.dto';
import { BlogThemeConfigService } from '../application/blog-theme-config.service';

@ApiTags('Blog - 主题')
@Controller('blog/theme')
@UseGuards(JwtAuthGuard)
export class BlogThemeConfigController {
  constructor(
    private readonly blogThemeConfigService: BlogThemeConfigService,
  ) {}

  /**
   * 根据参数 `res`，获取本地博客主题配置。
   * @param res - 包含 `send` 字段的上游服务响应。
   * @returns 根据参数 `res`，获取本地博客主题配置。
   */
  @Get('config')
  @Public()
  @ApiOperation({ summary: '获取本地博客主题配置' })
  async config(@Res() res) {
    const config = await this.blogThemeConfigService.publicConfig();

    return res.send(vbenSuccess(config));
  }

  /**
   * 根据`res`、`body`更新针对本地博客主题配置；向目标通道投递结果（`res.send`）。
   * @param res - 包含 `send` 字段的上游服务响应。
   * @param body - 用于针对本地博客主题配置的结构化输入。
   * @returns 针对本地博客主题配置。
   */
  @Post('save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '保存本地博客主题配置' })
  async save(@Res() res, @Body() body: BlogThemeConfigBodyDto) {
    const result = await this.blogThemeConfigService.save(body);

    return res.send(vbenSuccess(result));
  }
}
