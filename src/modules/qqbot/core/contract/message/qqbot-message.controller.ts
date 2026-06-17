import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/jwt-auth.guard';
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
  /**
   * 初始化 QqbotMessageController 实例。
   * @param messageService - messageService 服务依赖；影响 constructor 的返回值。
   */
  constructor(private readonly messageService: QqbotMessageService) {}

  /**
   * QQBot 会话分页。
   * @param query - 查询参数 DTO；限定 QQBot分页、搜索或详情查询条件。
   */
  @Get('conversation/list')
  @ApiOperation({ summary: 'QQBot 会话分页' })
  async conversationList(@Query() query: QqbotConversationQueryDto) {
    return vbenSuccess(await this.messageService.conversationPage(query));
  }

  /**
   * QQBot 消息分页。
   * @param query - 查询参数 DTO；限定 QQBot分页、搜索或详情查询条件。
   */
  @Get('message/list')
  @ApiOperation({ summary: 'QQBot 消息分页' })
  async messageList(@Query() query: QqbotMessageQueryDto) {
    return vbenSuccess(await this.messageService.messagePage(query));
  }
}
