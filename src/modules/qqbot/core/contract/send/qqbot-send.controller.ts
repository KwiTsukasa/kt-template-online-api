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
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { vbenSuccess } from '@/common';
import {
  QqbotSendGroupDto,
  QqbotSendLogQueryDto,
  QqbotSendPrivateDto,
} from './qqbot-send.dto';
import { QqbotSendService } from '../../application/send/qqbot-send.service';

@ApiTags('QQBot - 发送日志')
@Controller('qqbot/send')
@UseGuards(JwtAuthGuard)
export class QqbotSendController {
  constructor(private readonly sendService: QqbotSendService) {}

  /**
   * 根据`query`处理QQBot 发送日志分页。
   * @param query - 限定QQBot 发送日志分页筛选、排序与分页范围的查询条件。
   * @returns QQBot 发送日志分页。
   */
  @Get('log/list')
  @ApiOperation({ summary: 'QQBot 发送日志分页' })
  async logList(@Query() query: QqbotSendLogQueryDto) {
    return vbenSuccess(await this.sendService.logPage(query));
  }

  /**
   * 根据`body`处理QQBot 发送私聊消息。
   * @param body - 用于QQBot 发送私聊消息的结构化输入。
   * @returns QQBot 发送私聊消息。
   */
  @Post('private')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'QQBot 发送私聊消息' })
  async private(@Body() body: QqbotSendPrivateDto) {
    return vbenSuccess(await this.sendService.sendPrivate(body));
  }

  /**
   * 根据`body`处理QQBot 发送群聊消息。
   * @param body - 用于QQBot 发送群聊消息的结构化输入。
   * @returns QQBot 发送群聊消息。
   */
  @Post('group')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'QQBot 发送群聊消息' })
  async group(@Body() body: QqbotSendGroupDto) {
    return vbenSuccess(await this.sendService.sendGroup(body));
  }
}
