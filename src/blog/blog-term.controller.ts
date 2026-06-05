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
import { JwtAuthGuard } from '@/admin/auth/jwt-auth.guard';
import { vbenSuccess } from '@/common';
import type { BlogTermKind } from './blog-term.entity';
import {
  BlogTermBodyDto,
  BlogTermListQueryDto,
  BlogTermUpdateBodyDto,
} from './blog-term.dto';
import { BlogTermService } from './blog-term.service';

@ApiTags('Blog - 分类标签')
@Controller('blog')
@UseGuards(JwtAuthGuard)
export class BlogTermController {
  constructor(private readonly blogTermService: BlogTermService) {}

  @Get('category/list')
  @ApiOperation({ summary: '获取本地博客分类分页列表' })
  async categoryList(@Res() res, @Query() query: BlogTermListQueryDto) {
    const list = await this.blogTermService.page('category', query);

    return res.send(vbenSuccess(list));
  }

  @Get('category/detail')
  @ApiOperation({ summary: '获取本地博客分类详情' })
  @ApiQuery({ name: 'id', type: String })
  async categoryDetail(@Res() res, @Query('id') id: string) {
    const detail = await this.blogTermService.detail('category', id);

    return res.send(vbenSuccess(detail));
  }

  @Post('category/save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '新增本地博客分类' })
  async categorySave(@Res() res, @Body() body: BlogTermBodyDto) {
    const result = await this.blogTermService.save('category', body);

    return res.send(vbenSuccess(result));
  }

  @Post('category/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '编辑本地博客分类' })
  async categoryUpdate(@Res() res, @Body() body: BlogTermUpdateBodyDto) {
    const result = await this.blogTermService.update('category', body);

    return res.send(vbenSuccess(result));
  }

  @Post('category/remove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除本地博客分类' })
  @ApiQuery({ name: 'id', type: String })
  async categoryRemove(@Res() res, @Query('id') id: string) {
    const result = await this.blogTermService.remove('category', id);

    return res.send(vbenSuccess(result));
  }

  @Get('tag/list')
  @ApiOperation({ summary: '获取本地博客标签分页列表' })
  async tagList(@Res() res, @Query() query: BlogTermListQueryDto) {
    const list = await this.blogTermService.page('tag', query);

    return res.send(vbenSuccess(list));
  }

  @Get('tag/detail')
  @ApiOperation({ summary: '获取本地博客标签详情' })
  @ApiQuery({ name: 'id', type: String })
  async tagDetail(@Res() res, @Query('id') id: string) {
    const detail = await this.blogTermService.detail('tag', id);

    return res.send(vbenSuccess(detail));
  }

  @Post('tag/save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '新增本地博客标签' })
  async tagSave(@Res() res, @Body() body: BlogTermBodyDto) {
    const result = await this.blogTermService.save('tag', body);

    return res.send(vbenSuccess(result));
  }

  @Post('tag/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '编辑本地博客标签' })
  async tagUpdate(@Res() res, @Body() body: BlogTermUpdateBodyDto) {
    const result = await this.blogTermService.update('tag', body);

    return res.send(vbenSuccess(result));
  }

  @Post('tag/remove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除本地博客标签' })
  @ApiQuery({ name: 'id', type: String })
  async tagRemove(@Res() res, @Query('id') id: string) {
    const result = await this.blogTermService.remove('tag', id);

    return res.send(vbenSuccess(result));
  }

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
