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
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
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

  /**
   * 根据当前运行态处理扫码会话。
   * @returns 扫码会话。
   */
  @Post('scan/create')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '扫码新增 QQBot 账号' })
  async scanCreate() {
    return vbenSuccess(await this.napcatLoginService.startCreate());
  }

  /**
   * 根据参数 `id`，扫码刷新 QQBot 账号登录态。
   * @param id - 决定根据参数 `id`，扫码刷新 QQBot 账号登录态内容、边界或目标的 `id` 值。
   * @returns 根据参数 `id`，扫码刷新 QQBot 账号登录态。
   */
  @Post('scan/refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '扫码刷新 QQBot 账号登录态' })
  @ApiQuery({ name: 'id', type: String })
  async scanRefresh(@Query('id') id: string) {
    return vbenSuccess(await this.napcatLoginService.startRefresh(id));
  }

  /**
   * 根据参数 `query`，查询 QQBot 扫码登录状态。
   * @param query - 限定根据参数 `query`，查询 QQBot 扫码登录状态筛选、排序与分页范围的查询条件，包含 `sessionId` 字段。
   * @returns 根据参数 `query`，查询 QQBot 扫码登录状态。
   */
  @Get('scan/status')
  @ApiOperation({ summary: '查询 QQBot 扫码登录状态' })
  async scanStatus(@Query() query: QqbotNapcatScanStatusDto) {
    return vbenSuccess(await this.napcatLoginService.status(query.sessionId));
  }

  /**
   * 根据`query`处理QQBot 扫码登录进度。
   * @param query - 限定QQBot 扫码登录进度筛选、排序与分页范围的查询条件，包含 `sessionId` 字段。
   * @returns QQBot 扫码登录进度。
   */
  @Sse('scan/events')
  @ApiOperation({ summary: '订阅 QQBot 扫码登录进度' })
  scanEvents(@Query() query: QqbotNapcatScanStatusDto) {
    return this.napcatLoginService.events(query.sessionId);
  }

  /**
   * 根据`query`处理QQBot 扫码二维码。
   * @param query - 限定QQBot 扫码二维码筛选、排序与分页范围的查询条件，包含 `sessionId` 字段。
   * @returns QQBot 扫码二维码。
   */
  @Post('scan/qrcode/refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '刷新 QQBot 扫码二维码' })
  async refreshScanQrcode(@Query() query: QqbotNapcatScanStatusDto) {
    return vbenSuccess(
      await this.napcatLoginService.refreshQrcode(query.sessionId),
    );
  }

  /**
   * 根据`body`处理QQBot 登录安全验证码。
   * @param body - 用于QQBot 登录安全验证码的结构化输入，包含 `sessionId` 字段。
   * @returns QQBot 登录安全验证码。
   */
  @Post('scan/captcha/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '提交 QQBot 登录安全验证码' })
  async submitScanCaptcha(@Body() body: QqbotNapcatScanCaptchaDto) {
    return vbenSuccess(
      await this.napcatLoginService.submitCaptcha(body.sessionId, body),
    );
  }

  /**
   * 根据参数 `query`，取消 QQBot 扫码登录会话。
   * @param query - 限定根据参数 `query`，取消 QQBot 扫码登录会话筛选、排序与分页范围的查询条件，包含 `sessionId` 字段。
   * @returns 满足根据参数 `query`，取消 QQBot 扫码登录会话约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  @Post('scan/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '取消 QQBot 扫码登录会话' })
  async cancelScan(@Query() query: QqbotNapcatScanStatusDto) {
    return vbenSuccess(await this.napcatLoginService.cancel(query.sessionId));
  }
}
