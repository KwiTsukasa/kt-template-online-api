import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { vbenSuccess } from '@/common';
import {
  QqbotConversationQueryDto,
  QqbotMessageQueryDto,
} from './qqbot-message.dto';
import { QqbotMessageService } from '../../application/message/qqbot-message.service';

@ApiTags('QQBot - 会话与消息')
@Controller('qqbot')
@UseGuards(JwtAuthGuard)
export class QqbotMessageController {
  constructor(private readonly messageService: QqbotMessageService) {}

  /**
   * 按查询条件读取 QQBot 会话分页，并封装为 Vben 成功响应。
   * @param query - 限定会话消息筛选、排序与分页范围的查询条件。
   * @returns 会话消息。
   */
  @Get('conversation/list')
  @ApiOperation({ summary: 'QQBot 会话分页' })
  async conversationList(@Query() query: QqbotConversationQueryDto) {
    return vbenSuccess(await this.messageService.conversationPage(query));
  }

  /**
   * 按查询条件读取 QQBot 消息分页，并封装为 Vben 成功响应。
   * @param query - 限定消息筛选、排序与分页范围的查询条件。
   * @returns 消息。
   */
  @Get('message/list')
  @ApiOperation({ summary: 'QQBot 消息分页' })
  async messageList(@Query() query: QqbotMessageQueryDto) {
    return vbenSuccess(await this.messageService.messagePage(query));
  }
}
