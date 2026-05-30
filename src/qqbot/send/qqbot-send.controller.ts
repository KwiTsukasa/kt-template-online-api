import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/admin/auth/jwt-auth.guard';
import { vbenSuccess } from '@/common';
import {
  QqbotSendGroupDto,
  QqbotSendLogQueryDto,
  QqbotSendPrivateDto,
} from './qqbot-send.dto';
import { QqbotSendService } from './qqbot-send.service';

@ApiTags('qqbot-send')
@Controller('qqbot/send')
@UseGuards(JwtAuthGuard)
export class QqbotSendController {
  constructor(private readonly sendService: QqbotSendService) {}

  @Get('log/list')
  @ApiOperation({ summary: 'QQBot 发送日志分页' })
  async logList(@Query() query: QqbotSendLogQueryDto) {
    return vbenSuccess(await this.sendService.logPage(query));
  }

  @Post('private')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'QQBot 发送私聊消息' })
  async private(@Body() body: QqbotSendPrivateDto) {
    return vbenSuccess(await this.sendService.sendPrivate(body));
  }

  @Post('group')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'QQBot 发送群聊消息' })
  async group(@Body() body: QqbotSendGroupDto) {
    return vbenSuccess(await this.sendService.sendGroup(body));
  }
}
