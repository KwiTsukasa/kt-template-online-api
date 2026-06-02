import { Controller, Get, Redirect } from '@nestjs/common';
import {
  ApiMovedPermanentlyResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('基础能力 - 根入口')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

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
