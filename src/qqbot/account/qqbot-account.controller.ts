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
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/admin/auth/jwt-auth.guard';
import { vbenSuccess } from '@/common';
import {
  QqbotAccountBodyDto,
  QqbotAccountQueryDto,
  QqbotAccountUpdateDto,
} from './qqbot-account.dto';
import { QqbotAccountService } from './qqbot-account.service';
import { QqbotReverseWsService } from '../connection/qqbot-reverse-ws.service';

@ApiTags('qqbot-account')
@Controller('qqbot/account')
@UseGuards(JwtAuthGuard)
export class QqbotAccountController {
  constructor(
    private readonly accountService: QqbotAccountService,
    private readonly reverseWsService: QqbotReverseWsService,
  ) {}

  @Get('list')
  @ApiOperation({ summary: 'QQBot 账号分页' })
  async list(@Query() query: QqbotAccountQueryDto) {
    return vbenSuccess(await this.accountService.page(query));
  }

  @Get('enabled')
  @ApiOperation({ summary: 'QQBot 可用账号' })
  async enabled() {
    return vbenSuccess(await this.accountService.allEnabled());
  }

  @Post('save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '新增 QQBot 账号' })
  async save(@Body() body: QqbotAccountBodyDto) {
    return vbenSuccess(await this.accountService.save(body));
  }

  @Post('update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '编辑 QQBot 账号' })
  async update(@Body() body: QqbotAccountUpdateDto) {
    return vbenSuccess(await this.accountService.update(body));
  }

  @Post('delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除 QQBot 账号' })
  @ApiQuery({ name: 'id', type: String })
  async delete(@Query('id') id: string) {
    return vbenSuccess(await this.accountService.remove(id));
  }

  @Post('kick')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '断开 QQBot 反向 WS 会话' })
  @ApiQuery({ name: 'selfId', type: String })
  async kick(@Query('selfId') selfId: string) {
    return vbenSuccess(await this.reverseWsService.kick(selfId));
  }
}
