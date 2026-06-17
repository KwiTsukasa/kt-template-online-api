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
import { JwtAuthGuard } from '@/modules/admin/identity/auth/jwt-auth.guard';
import { Public, vbenSuccess } from '@/common';
import {
  WordpressArticleBodyDto,
  WordpressArticleListQueryDto,
  WordpressArticleUpdateBodyDto,
} from './wordpress.dto';
import { WordpressService } from '../application/wordpress.service';

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
  /**
   * 初始化 WordpressArticleController 实例。
   * @param wordpressService - wordpressService 服务依赖；影响 constructor 的返回值。
   */
  constructor(private readonly wordpressService: WordpressService) {}

  /**
   * 获取公开 WordPress 文章分页列表。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param query - 查询参数 DTO；限定 WordPress分页、搜索或详情查询条件。
   */
  @Get('public/list')
  @Public()
  @ApiOperation({ summary: '获取公开 WordPress 文章分页列表' })
  async publicList(@Res() res, @Query() query: WordpressArticleListQueryDto) {
    const list = await this.wordpressService.publicArticleList(query);

    return res.send(vbenSuccess(list));
  }

  /**
   * 获取公开 WordPress 文章详情。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param slug - slug 输入；影响 publicDetail 的返回值。
   * @param id - WordPress记录 ID；定位本次读取、更新、删除或关联的WordPress记录。
   */
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

  /**
   * 获取 WordPress 文章分页列表。
   * @param req - 当前 HTTP 请求；提供路由、用户、请求体或查询参数。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param query - 查询参数 DTO；限定 WordPress分页、搜索或详情查询条件。
   */
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

  /**
   * 获取 WordPress 文章详情。
   * @param req - 当前 HTTP 请求；提供路由、用户、请求体或查询参数。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param id - WordPress记录 ID；定位本次读取、更新、删除或关联的WordPress记录。
   */
  @Get('detail')
  @ApiOperation({ summary: '获取 WordPress 文章详情' })
  @ApiQuery({ name: 'id', type: Number })
  async detail(@Req() req: Request, @Res() res, @Query('id') id: string) {
    const auth = this.wordpressService.getAuthContext(req);
    const detail = await this.wordpressService.articleDetail(id, auth);

    return res.send(vbenSuccess(detail));
  }

  /**
   * 新增 WordPress 文章。
   * @param req - 当前 HTTP 请求；提供路由、用户、请求体或查询参数。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param body - 请求体 DTO；承载 WordPress新增、更新、导入或执行字段。
   */
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

  /**
   * 编辑 WordPress 文章。
   * @param req - 当前 HTTP 请求；提供路由、用户、请求体或查询参数。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param body - 请求体 DTO；承载 WordPress新增、更新、导入或执行字段。
   */
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

  /**
   * 删除 WordPress 文章。
   * @param req - 当前 HTTP 请求；提供路由、用户、请求体或查询参数。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param id - WordPress记录 ID；定位本次读取、更新、删除或关联的WordPress记录。
   * @param force - force 输入；驱动 `wordpressService.articleRemove()` 的 WordPress步骤。
   */
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
