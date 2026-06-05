import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '@/admin/auth/jwt-auth.guard';
import { Public, vbenSuccess } from '@/common';
import {
  WordpressArticleBodyDto,
  WordpressArticleListQueryDto,
  WordpressArticleUpdateBodyDto,
} from './wordpress.dto';
import { WordpressService } from './wordpress.service';

@ApiTags('WordPress - 文章')
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
@Controller('wordpress/article')
@UseGuards(JwtAuthGuard)
export class WordpressArticleController {
  constructor(private readonly wordpressService: WordpressService) {}

  @Get('public/list')
  @Public()
  @ApiOperation({ summary: '获取公开 WordPress 文章分页列表' })
  async publicList(@Res() res, @Query() query: WordpressArticleListQueryDto) {
    const list = await this.wordpressService.publicArticleList(query);

    return res.send(vbenSuccess(list));
  }

  @Get('public/detail')
  @Public()
  @ApiOperation({ summary: '获取公开 WordPress 文章详情' })
  @ApiQuery({ name: 'slug', required: false, type: String })
  @ApiQuery({ name: 'id', required: false, type: Number })
  async publicDetail(
    @Res() res,
    @Query('slug') slug?: string,
    @Query('id') id?: string,
  ) {
    const detail = await this.wordpressService.publicArticleDetail({
      id,
      slug,
    });

    return res.send(vbenSuccess(detail));
  }

  @Get('list')
  @ApiOperation({ summary: '获取 WordPress 文章分页列表' })
  async list(
    @Req() req: Request,
    @Res() res,
    @Query() query: WordpressArticleListQueryDto,
  ) {
    const auth = this.wordpressService.getAuthContext(req);
    const list = await this.wordpressService.articleList(query, auth);

    return res.send(vbenSuccess(list));
  }

  @Get('detail')
  @ApiOperation({ summary: '获取 WordPress 文章详情' })
  @ApiQuery({ name: 'id', type: Number })
  async detail(@Req() req: Request, @Res() res, @Query('id') id: string) {
    const auth = this.wordpressService.getAuthContext(req);
    const detail = await this.wordpressService.articleDetail(id, auth);

    return res.send(vbenSuccess(detail));
  }

  @Post('save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '新增 WordPress 文章' })
  async save(
    @Req() req: Request,
    @Res() res,
    @Body() body: WordpressArticleBodyDto,
  ) {
    const auth = this.wordpressService.getAuthContext(req);
    const result = await this.wordpressService.articleSave(body, auth);

    return res.send(vbenSuccess(result));
  }

  @Post('update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '编辑 WordPress 文章' })
  async update(
    @Req() req: Request,
    @Res() res,
    @Body() body: WordpressArticleUpdateBodyDto,
  ) {
    const auth = this.wordpressService.getAuthContext(req);
    const result = await this.wordpressService.articleUpdate(body, auth);

    return res.send(vbenSuccess(result));
  }

  @Post('remove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除 WordPress 文章' })
  @ApiQuery({ name: 'id', type: Number })
  @ApiQuery({ name: 'force', required: false, type: Boolean })
  async remove(
    @Req() req: Request,
    @Res() res,
    @Query('id') id: string,
    @Query('force') force?: string,
  ) {
    const auth = this.wordpressService.getAuthContext(req);
    const result = await this.wordpressService.articleRemove(
      id,
      force !== 'false',
      auth,
    );

    return res.send(vbenSuccess(result));
  }
}
