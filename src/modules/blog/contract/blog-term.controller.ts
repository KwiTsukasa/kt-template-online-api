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
  /**
   * 初始化 BlogTermController 实例。
   * @param blogTermService - blogTermService 服务依赖；影响 constructor 的返回值。
   */
  constructor(private readonly blogTermService: BlogTermService) {}

  /**
   * 获取本地博客分类分页列表。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param query - 查询参数 DTO；限定 博客分页、搜索或详情查询条件。
   */
  @Get('category/list')
  @ApiOperation({ summary: '获取本地博客分类分页列表' })
  async categoryList(@Res() res, @Query() query: BlogTermListQueryDto) {
    const list = await this.blogTermService.page('category', query);

    return res.send(vbenSuccess(list));
  }

  /**
   * 获取本地博客分类详情。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param id - 博客记录 ID；定位本次读取、更新、删除或关联的博客记录。
   */
  @Get('category/detail')
  @ApiOperation({ summary: '获取本地博客分类详情' })
  @ApiQuery({ name: 'id', type: String })
  async categoryDetail(@Res() res, @Query('id') id: string) {
    const detail = await this.blogTermService.detail('category', id);

    return res.send(vbenSuccess(detail));
  }

  /**
   * 新增本地博客分类。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param body - 请求体 DTO；承载 博客新增、更新、导入或执行字段。
   */
  @Post('category/save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '新增本地博客分类' })
  async categorySave(@Res() res, @Body() body: BlogTermBodyDto) {
    const result = await this.blogTermService.save('category', body);

    return res.send(vbenSuccess(result));
  }

  /**
   * 编辑本地博客分类。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param body - 请求体 DTO；承载 博客新增、更新、导入或执行字段。
   */
  @Post('category/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '编辑本地博客分类' })
  async categoryUpdate(@Res() res, @Body() body: BlogTermUpdateBodyDto) {
    const result = await this.blogTermService.update('category', body);

    return res.send(vbenSuccess(result));
  }

  /**
   * 删除本地博客分类。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param id - 博客记录 ID；定位本次读取、更新、删除或关联的博客记录。
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
   * 获取本地博客标签分页列表。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param query - 查询参数 DTO；限定 博客分页、搜索或详情查询条件。
   */
  @Get('tag/list')
  @ApiOperation({ summary: '获取本地博客标签分页列表' })
  async tagList(@Res() res, @Query() query: BlogTermListQueryDto) {
    const list = await this.blogTermService.page('tag', query);

    return res.send(vbenSuccess(list));
  }

  /**
   * 获取本地博客标签详情。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param id - 博客记录 ID；定位本次读取、更新、删除或关联的博客记录。
   */
  @Get('tag/detail')
  @ApiOperation({ summary: '获取本地博客标签详情' })
  @ApiQuery({ name: 'id', type: String })
  async tagDetail(@Res() res, @Query('id') id: string) {
    const detail = await this.blogTermService.detail('tag', id);

    return res.send(vbenSuccess(detail));
  }

  /**
   * 新增本地博客标签。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param body - 请求体 DTO；承载 博客新增、更新、导入或执行字段。
   */
  @Post('tag/save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '新增本地博客标签' })
  async tagSave(@Res() res, @Body() body: BlogTermBodyDto) {
    const result = await this.blogTermService.save('tag', body);

    return res.send(vbenSuccess(result));
  }

  /**
   * 编辑本地博客标签。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param body - 请求体 DTO；承载 博客新增、更新、导入或执行字段。
   */
  @Post('tag/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '编辑本地博客标签' })
  async tagUpdate(@Res() res, @Body() body: BlogTermUpdateBodyDto) {
    const result = await this.blogTermService.update('tag', body);

    return res.send(vbenSuccess(result));
  }

  /**
   * 删除本地博客标签。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param id - 博客记录 ID；定位本次读取、更新、删除或关联的博客记录。
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
   * 获取本地博客分类或标签选项。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param kind - kind 输入；驱动 `blogTermService.options()` 的 博客步骤。
   * @param query - 查询参数 DTO；限定 博客分页、搜索或详情查询条件。
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
