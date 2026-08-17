import { Controller, Get, Redirect } from '@nestjs/common';
import {
  ApiMovedPermanentlyResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

@ApiTags('基础能力 - 根入口')
@Controller()
export class AppController {
  /**
   * 将应用根路径请求重定向到 Swagger 文档地址。
   * @returns 包含 `url` 字段的将应用根路径请求重定向到 Swagger 文档地址。
   */
  @Get()
  @Redirect('/api#/', 301)
  @ApiOperation({ summary: '重定向到Swagger文档' })
  @ApiMovedPermanentlyResponse({
    description: '重定向到 /api#/',
  })
  getHome() {
    return { url: '/api#/' };
  }
}
