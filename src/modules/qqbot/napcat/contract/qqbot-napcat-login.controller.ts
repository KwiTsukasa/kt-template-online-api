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
  /**
   * 初始化 QqbotNapcatLoginController 实例。
   * @param napcatLoginService - napcatLoginService 服务依赖；影响 constructor 的返回值。
   */
  constructor(private readonly napcatLoginService: QqbotNapcatLoginService) {}

  /**
   * 扫码新增 QQBot 账号。
   */
  @Post('scan/create')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '扫码新增 QQBot 账号' })
  async scanCreate() {
    return vbenSuccess(await this.napcatLoginService.startCreate());
  }

  /**
   * 扫码刷新 QQBot 账号登录态。
   * @param id - NapCat记录 ID；定位本次读取、更新、删除或关联的NapCat记录。
   */
  @Post('scan/refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '扫码刷新 QQBot 账号登录态' })
  @ApiQuery({ name: 'id', type: String })
  async scanRefresh(@Query('id') id: string) {
    return vbenSuccess(await this.napcatLoginService.startRefresh(id));
  }

  /**
   * 查询 QQBot 扫码登录状态。
   * @param query - 查询参数 DTO；限定 NapCat分页、搜索或详情查询条件。
   */
  @Get('scan/status')
  @ApiOperation({ summary: '查询 QQBot 扫码登录状态' })
  async scanStatus(@Query() query: QqbotNapcatScanStatusDto) {
    return vbenSuccess(await this.napcatLoginService.status(query.sessionId));
  }

  /**
   * 订阅 QQBot 扫码登录进度。
   * @param query - 查询参数 DTO；限定 NapCat分页、搜索或详情查询条件。
   */
  @Sse('scan/events')
  @ApiOperation({ summary: '订阅 QQBot 扫码登录进度' })
  scanEvents(@Query() query: QqbotNapcatScanStatusDto) {
    return this.napcatLoginService.events(query.sessionId);
  }

  /**
   * 刷新 QQBot 扫码二维码。
   * @param query - 查询参数 DTO；限定 NapCat分页、搜索或详情查询条件。
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
   * 提交 QQBot 登录安全验证码。
   * @param body - 请求体 DTO；承载 NapCat新增、更新、导入或执行字段。
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
   * 取消 QQBot 扫码登录会话。
   * @param query - 查询参数 DTO；限定 NapCat分页、搜索或详情查询条件。
   */
  @Post('scan/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '取消 QQBot 扫码登录会话' })
  async cancelScan(@Query() query: QqbotNapcatScanStatusDto) {
    return vbenSuccess(await this.napcatLoginService.cancel(query.sessionId));
  }
}
