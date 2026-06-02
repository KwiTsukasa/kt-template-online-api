import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/admin/auth/jwt-auth.guard';
import { vbenSuccess } from '@/common';
import {
  QqbotConversationQueryDto,
  QqbotMessageQueryDto,
} from './qqbot-message.dto';
import { QqbotMessageService } from './qqbot-message.service';

@ApiTags('QQBot - 会话与消息')
@Controller('qqbot')
@UseGuards(JwtAuthGuard)
export class QqbotMessageController {
  constructor(private readonly messageService: QqbotMessageService) {}

  @Get('conversation/list')
  @ApiOperation({ summary: 'QQBot 会话分页' })
  async conversationList(@Query() query: QqbotConversationQueryDto) {
    return vbenSuccess(await this.messageService.conversationPage(query));
  }

  @Get('message/list')
  @ApiOperation({ summary: 'QQBot 消息分页' })
  async messageList(@Query() query: QqbotMessageQueryDto) {
    return vbenSuccess(await this.messageService.messagePage(query));
  }
}
