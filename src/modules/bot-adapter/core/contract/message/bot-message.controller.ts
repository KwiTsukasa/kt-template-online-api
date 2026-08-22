import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { vbenSuccess } from '@/common';
import {
  BotConversationQueryDto,
  BotMessageQueryDto,
} from './bot-message.dto';
import { BotMessageService } from '../../application/message/bot-message.service';

@ApiTags('Bot - 会话与消息')
@Controller('bot')
@UseGuards(JwtAuthGuard)
export class BotMessageController {
  constructor(private readonly messageService: BotMessageService) {}

  /**
   * 按查询条件读取 Bot 会话分页，并封装为 Vben 成功响应。
   * @param query - 限定会话消息筛选、排序与分页范围的查询条件。
   * @returns 会话消息。
   */
  @Get('conversation/list')
  @ApiOperation({ summary: 'Bot 会话分页' })
  async conversationList(@Query() query: BotConversationQueryDto) {
    return vbenSuccess(await this.messageService.conversationPage(query));
  }

  /**
   * 按查询条件读取 Bot 消息分页，并封装为 Vben 成功响应。
   * @param query - 限定消息筛选、排序与分页范围的查询条件。
   * @returns 消息。
   */
  @Get('message/list')
  @ApiOperation({ summary: 'Bot 消息分页' })
  async messageList(@Query() query: BotMessageQueryDto) {
    return vbenSuccess(await this.messageService.messagePage(query));
  }
}
