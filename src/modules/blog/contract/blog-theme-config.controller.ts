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
  constructor(
    private readonly blogThemeConfigService: BlogThemeConfigService,
  ) {}

  @Get('config')
  @Public()
  @ApiOperation({ summary: '获取本地博客主题配置' })
  async config(@Res() res) {
    const config = await this.blogThemeConfigService.publicConfig();

    return res.send(vbenSuccess(config));
  }

  @Post('save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '保存本地博客主题配置' })
  async save(@Res() res, @Body() body: BlogThemeConfigBodyDto) {
    const result = await this.blogThemeConfigService.save(body);

    return res.send(vbenSuccess(result));
  }

  @Post('import-wordpress')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '从 WordPress 导入主题配置到本地博客' })
  async importWordpress(@Res() res) {
    const result = await this.blogThemeConfigService.importFromWordpress();

    return res.send(vbenSuccess(result));
  }
}
