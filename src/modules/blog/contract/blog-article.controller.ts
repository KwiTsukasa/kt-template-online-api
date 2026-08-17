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
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { Public, vbenSuccess } from '@/common';
import {
  BlogArticleBodyDto,
  BlogArticleListQueryDto,
  BlogArticleTermOptionsQueryDto,
  BlogArticleUpdateBodyDto,
} from './blog-article.dto';
import { BlogArticleService } from '../application/blog-article.service';

@ApiTags('Blog - 文章')
@Controller('blog/article')
@UseGuards(JwtAuthGuard)
export class BlogArticleController {
  constructor(private readonly blogArticleService: BlogArticleService) {}

  /**
   * 根据参数 `query`，获取公开博客文章分页列表。
   * @param res - 包含 `send` 字段的上游服务响应。
   * @param query - 限定根据参数 `query`，获取公开博客文章分页列表筛选、排序与分页范围的查询条件。
   * @returns 根据参数 `query`，获取公开博客文章分页列表。
   */
  @Get('public/list')
  @Public()
  @ApiOperation({ summary: '获取公开博客文章分页列表' })
  async publicList(@Res() res, @Query() query: BlogArticleListQueryDto) {
    const list = await this.blogArticleService.publicList(query);

    return res.send(vbenSuccess(list));
  }

  /**
   * 根据参数 `slug`，获取公开博客文章详情。
   * @param res - 包含 `send` 字段的上游服务响应。
   * @param slug - 决定根据参数 `slug`，获取公开博客文章详情内容、边界或目标的 `slug` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @param id - 决定根据参数 `slug`，获取公开博客文章详情内容、边界或目标的 `id` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 根据参数 `slug`，获取公开博客文章详情。
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
   * 根据参数 `query`，获取博客文章分页列表。
   * @param res - 包含 `send` 字段的上游服务响应。
   * @param query - 限定根据参数 `query`，获取博客文章分页列表筛选、排序与分页范围的查询条件。
   * @returns 根据参数 `query`，获取博客文章分页列表。
   */
  @Get('list')
  @ApiOperation({ summary: '获取博客文章分页列表' })
  async list(@Res() res, @Query() query: BlogArticleListQueryDto) {
    const list = await this.blogArticleService.page(query);

    return res.send(vbenSuccess(list));
  }

  /**
   * 根据参数 `id`，获取博客文章详情。
   * @param res - 包含 `send` 字段的上游服务响应。
   * @param id - 决定根据参数 `id`，获取博客文章详情内容、边界或目标的 `id` 值。
   * @returns 根据参数 `id`，获取博客文章详情。
   */
  @Get('detail')
  @ApiOperation({ summary: '获取博客文章详情' })
  @ApiQuery({ name: 'id', type: String })
  async detail(@Res() res, @Query('id') id: string) {
    const detail = await this.blogArticleService.detail(id);

    return res.send(vbenSuccess(detail));
  }

  /**
   * 根据`res`、`body`更新针对博客文章；向目标通道投递结果（`res.send`）。
   * @param res - 包含 `send` 字段的上游服务响应。
   * @param body - 用于针对博客文章的结构化输入。
   * @returns 针对博客文章。
   */
  @Post('save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '新增博客文章' })
  async save(@Res() res, @Body() body: BlogArticleBodyDto) {
    const result = await this.blogArticleService.save(body);

    return res.send(vbenSuccess(result));
  }

  /**
   * 根据`res`、`body`更新针对博客文章；向目标通道投递结果（`res.send`）。
   * @param res - 包含 `send` 字段的上游服务响应。
   * @param body - 用于针对博客文章的结构化输入。
   * @returns 针对博客文章。
   */
  @Post('update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '编辑博客文章' })
  async update(@Res() res, @Body() body: BlogArticleUpdateBodyDto) {
    const result = await this.blogArticleService.update(body);

    return res.send(vbenSuccess(result));
  }

  /**
   * 按`res`、`id`移除针对删除博客文章；向目标通道投递结果（`res.send`）。
   * @param res - 包含 `send` 字段的上游服务响应。
   * @param id - 决定针对删除博客文章内容、边界或目标的 `id` 值。
   * @returns 针对删除博客文章。
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
   * 根据参数 `query`，获取本地博客文章分类选项。
   * @param res - 包含 `send` 字段的上游服务响应。
   * @param query - 限定根据参数 `query`，获取本地博客文章分类选项筛选、排序与分页范围的查询条件。
   * @returns 根据参数 `query`，获取本地博客文章分类选项。
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
   * 根据参数 `query`，获取本地博客文章标签选项。
   * @param res - 包含 `send` 字段的上游服务响应。
   * @param query - 限定根据参数 `query`，获取本地博客文章标签选项筛选、排序与分页范围的查询条件。
   * @returns 根据参数 `query`，获取本地博客文章标签选项。
   */
  @Get('tag-options')
  @ApiOperation({ summary: '获取本地博客文章标签选项' })
  async tagOptions(@Res() res, @Query() query: BlogArticleTermOptionsQueryDto) {
    const result = await this.blogArticleService.tagOptions(query);

    return res.send(vbenSuccess(result));
  }
}
