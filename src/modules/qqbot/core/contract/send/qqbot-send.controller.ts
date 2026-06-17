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
import { JwtAuthGuard } from '@/modules/admin/identity/auth/jwt-auth.guard';
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
  /**
   * 初始化 QqbotSendController 实例。
   * @param sendService - sendService 服务依赖；影响 constructor 的返回值。
   */
  constructor(private readonly sendService: QqbotSendService) {}

  /**
   * QQBot 发送日志分页。
   * @param query - 查询参数 DTO；限定 QQBot分页、搜索或详情查询条件。
   */
  @Get('log/list')
  @ApiOperation({ summary: 'QQBot 发送日志分页' })
  async logList(@Query() query: QqbotSendLogQueryDto) {
    return vbenSuccess(await this.sendService.logPage(query));
  }

  /**
   * QQBot 发送私聊消息。
   * @param body - 请求体 DTO；承载 QQBot新增、更新、导入或执行字段。
   */
  @Post('private')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'QQBot 发送私聊消息' })
  async private(@Body() body: QqbotSendPrivateDto) {
    return vbenSuccess(await this.sendService.sendPrivate(body));
  }

  /**
   * QQBot 发送群聊消息。
   * @param body - 请求体 DTO；承载 QQBot新增、更新、导入或执行字段。
   */
  @Post('group')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'QQBot 发送群聊消息' })
  async group(@Body() body: QqbotSendGroupDto) {
    return vbenSuccess(await this.sendService.sendGroup(body));
  }
}
