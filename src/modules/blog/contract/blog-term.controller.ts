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
import { vbenSuccess } from '@/common';
import type { BlogTermKind } from '../infrastructure/persistence/blog-term.entity';
import {
  BlogTermBodyDto,
  BlogTermListQueryDto,
  BlogTermUpdateBodyDto,
} from './blog-term.dto';
import { BlogTermService } from '../application/blog-term.service';

@ApiTags('Blog - 分类标签')
@Controller('blog')
@UseGuards(JwtAuthGuard)
export class BlogTermController {
  constructor(private readonly blogTermService: BlogTermService) {}

  /**
   * 根据参数 `query`，获取本地博客分类分页列表。
   * @param res - 包含 `send` 字段的上游服务响应。
   * @param query - 限定根据参数 `query`，获取本地博客分类分页列表筛选、排序与分页范围的查询条件。
   * @returns 根据参数 `query`，获取本地博客分类分页列表。
   */
  @Get('category/list')
  @ApiOperation({ summary: '获取本地博客分类分页列表' })
  async categoryList(@Res() res, @Query() query: BlogTermListQueryDto) {
    const list = await this.blogTermService.page('category', query);

    return res.send(vbenSuccess(list));
  }

  /**
   * 根据参数 `id`，获取本地博客分类详情。
   * @param res - 包含 `send` 字段的上游服务响应。
   * @param id - 决定根据参数 `id`，获取本地博客分类详情内容、边界或目标的 `id` 值。
   * @returns 根据参数 `id`，获取本地博客分类详情。
   */
  @Get('category/detail')
  @ApiOperation({ summary: '获取本地博客分类详情' })
  @ApiQuery({ name: 'id', type: String })
  async categoryDetail(@Res() res, @Query('id') id: string) {
    const detail = await this.blogTermService.detail('category', id);

    return res.send(vbenSuccess(detail));
  }

  /**
   * 根据`res`、`body`处理针对本地博客分类；向目标通道投递结果（`res.send`）。
   * @param res - 包含 `send` 字段的上游服务响应。
   * @param body - 用于针对本地博客分类的结构化输入。
   * @returns 针对本地博客分类。
   */
  @Post('category/save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '新增本地博客分类' })
  async categorySave(@Res() res, @Body() body: BlogTermBodyDto) {
    const result = await this.blogTermService.save('category', body);

    return res.send(vbenSuccess(result));
  }

  /**
   * 根据`res`、`body`处理针对本地博客分类；向目标通道投递结果（`res.send`）。
   * @param res - 包含 `send` 字段的上游服务响应。
   * @param body - 用于针对本地博客分类的结构化输入。
   * @returns 针对本地博客分类。
   */
  @Post('category/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '编辑本地博客分类' })
  async categoryUpdate(@Res() res, @Body() body: BlogTermUpdateBodyDto) {
    const result = await this.blogTermService.update('category', body);

    return res.send(vbenSuccess(result));
  }

  /**
   * 根据`res`、`id`处理针对删除本地博客分类；向目标通道投递结果（`res.send`）。
   * @param res - 包含 `send` 字段的上游服务响应。
   * @param id - 决定针对删除本地博客分类内容、边界或目标的 `id` 值。
   * @returns 针对删除本地博客分类。
   */
  @Post('category/remove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除本地博客分类' })
  @ApiQuery({ name: 'id', type: String })
  async categoryRemove(@Res() res, @Query('id') id: string) {
    const result = await this.blogTermService.remove('category', id);

    return res.send(vbenSuccess(result));
  }

  /**
   * 根据参数 `query`，获取本地博客标签分页列表。
   * @param res - 包含 `send` 字段的上游服务响应。
   * @param query - 限定根据参数 `query`，获取本地博客标签分页列表筛选、排序与分页范围的查询条件。
   * @returns 根据参数 `query`，获取本地博客标签分页列表。
   */
  @Get('tag/list')
  @ApiOperation({ summary: '获取本地博客标签分页列表' })
  async tagList(@Res() res, @Query() query: BlogTermListQueryDto) {
    const list = await this.blogTermService.page('tag', query);

    return res.send(vbenSuccess(list));
  }

  /**
   * 根据参数 `id`，获取本地博客标签详情。
   * @param res - 包含 `send` 字段的上游服务响应。
   * @param id - 决定根据参数 `id`，获取本地博客标签详情内容、边界或目标的 `id` 值。
   * @returns 根据参数 `id`，获取本地博客标签详情。
   */
  @Get('tag/detail')
  @ApiOperation({ summary: '获取本地博客标签详情' })
  @ApiQuery({ name: 'id', type: String })
  async tagDetail(@Res() res, @Query('id') id: string) {
    const detail = await this.blogTermService.detail('tag', id);

    return res.send(vbenSuccess(detail));
  }

  /**
   * 根据`res`、`body`处理针对本地博客标签；向目标通道投递结果（`res.send`）。
   * @param res - 包含 `send` 字段的上游服务响应。
   * @param body - 用于针对本地博客标签的结构化输入。
   * @returns 针对本地博客标签。
   */
  @Post('tag/save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '新增本地博客标签' })
  async tagSave(@Res() res, @Body() body: BlogTermBodyDto) {
    const result = await this.blogTermService.save('tag', body);

    return res.send(vbenSuccess(result));
  }

  /**
   * 根据`res`、`body`处理针对本地博客标签；向目标通道投递结果（`res.send`）。
   * @param res - 包含 `send` 字段的上游服务响应。
   * @param body - 用于针对本地博客标签的结构化输入。
   * @returns 针对本地博客标签。
   */
  @Post('tag/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '编辑本地博客标签' })
  async tagUpdate(@Res() res, @Body() body: BlogTermUpdateBodyDto) {
    const result = await this.blogTermService.update('tag', body);

    return res.send(vbenSuccess(result));
  }

  /**
   * 根据`res`、`id`处理针对删除本地博客标签；向目标通道投递结果（`res.send`）。
   * @param res - 包含 `send` 字段的上游服务响应。
   * @param id - 决定针对删除本地博客标签内容、边界或目标的 `id` 值。
   * @returns 针对删除本地博客标签。
   */
  @Post('tag/remove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除本地博客标签' })
  @ApiQuery({ name: 'id', type: String })
  async tagRemove(@Res() res, @Query('id') id: string) {
    const result = await this.blogTermService.remove('tag', id);

    return res.send(vbenSuccess(result));
  }

  /**
   * 根据参数 `kind`，获取本地博客分类或标签选项。
   * @param res - 包含 `send` 字段的上游服务响应。
   * @param kind - 决定根据参数 `kind`，获取本地博客分类或标签选项内容、边界或目标的 `kind` 值。
   * @param query - 限定根据参数 `kind`，获取本地博客分类或标签选项筛选、排序与分页范围的查询条件。
   * @returns 根据参数 `kind`，获取本地博客分类或标签选项。
   */
  @Get('term/options')
  @ApiOperation({ summary: '获取本地博客分类或标签选项' })
  async options(
    @Res() res,
    @Query('kind') kind: BlogTermKind,
    @Query() query: BlogTermListQueryDto,
  ) {
    const result = await this.blogTermService.options(kind, query);

    return res.send(vbenSuccess(result));
  }
}
