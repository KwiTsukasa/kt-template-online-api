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
import { vbenSuccess } from '@/common';
import {
  WordpressTermBodyDto,
  WordpressTermListQueryDto,
  WordpressTermUpdateBodyDto,
} from './wordpress.dto';
import { WordpressService } from './wordpress.service';

@ApiTags('wordpress-tag')
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
@Controller('wordpress/tag')
@UseGuards(JwtAuthGuard)
export class WordpressTagController {
  constructor(private readonly wordpressService: WordpressService) {}

  @Get('list')
  @ApiOperation({ summary: '获取 WordPress 标签分页列表' })
  async list(
    @Req() req: Request,
    @Res() res,
    @Query() query: WordpressTermListQueryDto,
  ) {
    const auth = this.wordpressService.getAuthContext(req);
    const list = await this.wordpressService.tagList(query, auth);

    return res.send(vbenSuccess(list));
  }

  @Get('detail')
  @ApiOperation({ summary: '获取 WordPress 标签详情' })
  @ApiQuery({ name: 'id', type: Number })
  async detail(@Req() req: Request, @Res() res, @Query('id') id: string) {
    const auth = this.wordpressService.getAuthContext(req);
    const detail = await this.wordpressService.tagDetail(id, auth);

    return res.send(vbenSuccess(detail));
  }

  @Post('save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '新增 WordPress 标签' })
  async save(
    @Req() req: Request,
    @Res() res,
    @Body() body: WordpressTermBodyDto,
  ) {
    const auth = this.wordpressService.getAuthContext(req);
    const result = await this.wordpressService.tagSave(body, auth);

    return res.send(vbenSuccess(result));
  }

  @Post('update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '编辑 WordPress 标签' })
  async update(
    @Req() req: Request,
    @Res() res,
    @Body() body: WordpressTermUpdateBodyDto,
  ) {
    const auth = this.wordpressService.getAuthContext(req);
    const result = await this.wordpressService.tagUpdate(body, auth);

    return res.send(vbenSuccess(result));
  }

  @Post('remove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除 WordPress 标签' })
  @ApiQuery({ name: 'id', type: Number })
  @ApiQuery({ name: 'force', required: false, type: Boolean })
  async remove(
    @Req() req: Request,
    @Res() res,
    @Query('id') id: string,
    @Query('force') force?: string,
  ) {
    const auth = this.wordpressService.getAuthContext(req);
    const result = await this.wordpressService.tagRemove(
      id,
      force !== 'false',
      auth,
    );

    return res.send(vbenSuccess(result));
  }
}
