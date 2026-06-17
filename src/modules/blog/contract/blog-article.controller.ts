import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/jwt-auth.guard';
import { Public, vbenSuccess } from '@/common';
import {
  BlogArticleBodyDto,
  BlogArticleImportWordpressDto,
  BlogArticleListQueryDto,
  BlogArticleTermOptionsQueryDto,
  BlogArticleUpdateBodyDto,
} from './blog-article.dto';
import { BlogArticleService } from '../application/blog-article.service';

@ApiTags('Blog - 文章')
@Controller('blog/article')
@UseGuards(JwtAuthGuard)
export class BlogArticleController {
  /**
   * 初始化 BlogArticleController 实例。
   * @param blogArticleService - blogArticleService 服务依赖；影响 constructor 的返回值。
   */
  constructor(private readonly blogArticleService: BlogArticleService) {}

  /**
   * 获取公开博客文章分页列表。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param query - 查询参数 DTO；限定 博客分页、搜索或详情查询条件。
   */
  @Get('public/list')
  @Public()
  @ApiOperation({ summary: '获取公开博客文章分页列表' })
  async publicList(@Res() res, @Query() query: BlogArticleListQueryDto) {
    const list = await this.blogArticleService.publicList(query);

    return res.send(vbenSuccess(list));
  }

  /**
   * 获取公开博客文章详情。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param slug - slug 输入；影响 publicDetail 的返回值。
   * @param id - 博客记录 ID；定位本次读取、更新、删除或关联的博客记录。
   */
  @Get('public/detail')
  @Public()
  @ApiOperation({ summary: '获取公开博客文章详情' })
  @ApiQuery({ name: 'slug', required: false, type: String })
  @ApiQuery({ name: 'id', required: false, type: String })
  async publicDetail(
    @Res() res,
    @Query('slug') slug?: string,
    @Query('id') id?: string,
  ) {
    const detail = await this.blogArticleService.publicDetail({
      id,
      slug,
    });

    return res.send(vbenSuccess(detail));
  }

  /**
   * 获取博客文章分页列表。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param query - 查询参数 DTO；限定 博客分页、搜索或详情查询条件。
   */
  @Get('list')
  @ApiOperation({ summary: '获取博客文章分页列表' })
  async list(@Res() res, @Query() query: BlogArticleListQueryDto) {
    const list = await this.blogArticleService.page(query);

    return res.send(vbenSuccess(list));
  }

  /**
   * 获取博客文章详情。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param id - 博客记录 ID；定位本次读取、更新、删除或关联的博客记录。
   */
  @Get('detail')
  @ApiOperation({ summary: '获取博客文章详情' })
  @ApiQuery({ name: 'id', type: String })
  async detail(@Res() res, @Query('id') id: string) {
    const detail = await this.blogArticleService.detail(id);

    return res.send(vbenSuccess(detail));
  }

  /**
   * 新增博客文章。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param body - 请求体 DTO；承载 博客新增、更新、导入或执行字段。
   */
  @Post('save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '新增博客文章' })
  async save(@Res() res, @Body() body: BlogArticleBodyDto) {
    const result = await this.blogArticleService.save(body);

    return res.send(vbenSuccess(result));
  }

  /**
   * 编辑博客文章。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param body - 请求体 DTO；承载 博客新增、更新、导入或执行字段。
   */
  @Post('update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '编辑博客文章' })
  async update(@Res() res, @Body() body: BlogArticleUpdateBodyDto) {
    const result = await this.blogArticleService.update(body);

    return res.send(vbenSuccess(result));
  }

  /**
   * 删除博客文章。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param id - 博客记录 ID；定位本次读取、更新、删除或关联的博客记录。
   */
  @Post('remove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除博客文章' })
  @ApiQuery({ name: 'id', type: String })
  async remove(@Res() res, @Query('id') id: string) {
    const result = await this.blogArticleService.remove(id);

    return res.send(vbenSuccess(result));
  }

  /**
   * 获取本地博客文章分类选项。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param query - 查询参数 DTO；限定 博客分页、搜索或详情查询条件。
   */
  @Get('category-options')
  @ApiOperation({ summary: '获取本地博客文章分类选项' })
  async categoryOptions(
    @Res() res,
    @Query() query: BlogArticleTermOptionsQueryDto,
  ) {
    const result = await this.blogArticleService.categoryOptions(query);

    return res.send(vbenSuccess(result));
  }

  /**
   * 获取本地博客文章标签选项。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param query - 查询参数 DTO；限定 博客分页、搜索或详情查询条件。
   */
  @Get('tag-options')
  @ApiOperation({ summary: '获取本地博客文章标签选项' })
  async tagOptions(@Res() res, @Query() query: BlogArticleTermOptionsQueryDto) {
    const result = await this.blogArticleService.tagOptions(query);

    return res.send(vbenSuccess(result));
  }

  /**
   * 从 WordPress 导入文章到本地博客。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param body - 请求体 DTO；承载 博客新增、更新、导入或执行字段。
   */
  @Post('import-wordpress')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '从 WordPress 导入文章到本地博客' })
  async importWordpress(
    @Res() res,
    @Body() body: BlogArticleImportWordpressDto,
  ) {
    const result = await this.blogArticleService.importFromWordpress(body);

    return res.send(vbenSuccess(result));
  }
}
