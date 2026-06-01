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
  QqbotAccountScanStatusDto,
  QqbotAccountUpdateDto,
} from './qqbot-account.dto';
import { QqbotAccountService } from './qqbot-account.service';
import { QqbotNapcatLoginService } from './qqbot-napcat-login.service';
import { QqbotReverseWsService } from '../connection/qqbot-reverse-ws.service';

@ApiTags('qqbot-account')
@Controller('qqbot/account')
@UseGuards(JwtAuthGuard)
export class QqbotAccountController {
  constructor(
    private readonly accountService: QqbotAccountService,
    private readonly napcatLoginService: QqbotNapcatLoginService,
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

  @Post('scan/create')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '扫码新增 QQBot 账号' })
  async scanCreate() {
    return vbenSuccess(await this.napcatLoginService.startCreate());
  }

  @Post('scan/refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '扫码刷新 QQBot 账号登录态' })
  @ApiQuery({ name: 'id', type: String })
  async scanRefresh(@Query('id') id: string) {
    return vbenSuccess(await this.napcatLoginService.startRefresh(id));
  }

  @Get('scan/status')
  @ApiOperation({ summary: '查询 QQBot 扫码登录状态' })
  async scanStatus(@Query() query: QqbotAccountScanStatusDto) {
    return vbenSuccess(await this.napcatLoginService.status(query.sessionId));
  }

  @Post('scan/qrcode/refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '刷新 QQBot 扫码二维码' })
  async refreshScanQrcode(@Query() query: QqbotAccountScanStatusDto) {
    return vbenSuccess(
      await this.napcatLoginService.refreshQrcode(query.sessionId),
    );
  }

  @Post('scan/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '取消 QQBot 扫码登录会话' })
  async cancelScan(@Query() query: QqbotAccountScanStatusDto) {
    return vbenSuccess(this.napcatLoginService.cancel(query.sessionId));
  }

  @Post('delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除 QQBot 账号' })
  @ApiQuery({ name: 'id', type: String })
  async delete(@Query('id') id: string) {
    const account = await this.accountService.findById(id);
    if (account) await this.reverseWsService.kick(account.selfId);
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
