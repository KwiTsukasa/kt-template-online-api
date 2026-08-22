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
  BotSendGroupDto,
  BotSendLogQueryDto,
  BotSendPrivateDto,
} from './bot-send.dto';
import { BotSendService } from '../../application/send/bot-send.service';

@ApiTags('Bot - 发送日志')
@Controller('bot/send')
@UseGuards(JwtAuthGuard)
export class BotSendController {
  constructor(private readonly sendService: BotSendService) {}

  /**
   * 根据`query`处理Bot 发送日志分页。
   * @param query - 限定Bot 发送日志分页筛选、排序与分页范围的查询条件。
   * @returns Bot 发送日志分页。
   */
  @Get('log/list')
  @ApiOperation({ summary: 'Bot 发送日志分页' })
  async logList(@Query() query: BotSendLogQueryDto) {
    return vbenSuccess(await this.sendService.logPage(query));
  }

  /**
   * 根据`body`处理Bot 发送私聊消息。
   * @param body - 用于Bot 发送私聊消息的结构化输入。
   * @returns Bot 发送私聊消息。
   */
  @Post('private')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bot 发送私聊消息' })
  async private(@Body() body: BotSendPrivateDto) {
    return vbenSuccess(await this.sendService.sendPrivate(body));
  }

  /**
   * 根据`body`处理Bot 发送群聊消息。
   * @param body - 用于Bot 发送群聊消息的结构化输入。
   * @returns Bot 发送群聊消息。
   */
  @Post('group')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bot 发送群聊消息' })
  async group(@Body() body: BotSendGroupDto) {
    return vbenSuccess(await this.sendService.sendGroup(body));
  }
}
