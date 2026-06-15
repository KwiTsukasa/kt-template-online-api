import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/jwt-auth.guard';
import { vbenSuccess } from '@/common';
import { QqbotNapcatLoginService } from '../application/login/qqbot-napcat-login.service';
import {
  QqbotNapcatScanCaptchaDto,
  QqbotNapcatScanStatusDto,
} from './qqbot-napcat-login.dto';

@ApiTags('QQBot - NapCat 登录')
@Controller('qqbot/account')
@UseGuards(JwtAuthGuard)
export class QqbotNapcatLoginController {
  constructor(private readonly napcatLoginService: QqbotNapcatLoginService) {}

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
  async scanStatus(@Query() query: QqbotNapcatScanStatusDto) {
    return vbenSuccess(await this.napcatLoginService.status(query.sessionId));
  }

  @Sse('scan/events')
  @ApiOperation({ summary: '订阅 QQBot 扫码登录进度' })
  scanEvents(@Query() query: QqbotNapcatScanStatusDto) {
    return this.napcatLoginService.events(query.sessionId);
  }

  @Post('scan/qrcode/refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '刷新 QQBot 扫码二维码' })
  async refreshScanQrcode(@Query() query: QqbotNapcatScanStatusDto) {
    return vbenSuccess(
      await this.napcatLoginService.refreshQrcode(query.sessionId),
    );
  }

  @Post('scan/captcha/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '提交 QQBot 登录安全验证码' })
  async submitScanCaptcha(@Body() body: QqbotNapcatScanCaptchaDto) {
    return vbenSuccess(
      await this.napcatLoginService.submitCaptcha(body.sessionId, body),
    );
  }

  @Post('scan/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '取消 QQBot 扫码登录会话' })
  async cancelScan(@Query() query: QqbotNapcatScanStatusDto) {
    return vbenSuccess(await this.napcatLoginService.cancel(query.sessionId));
  }
}
