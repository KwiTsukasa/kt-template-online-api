import { Body, Controller, Get, Post, Res, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { transformKtDateTimeFields, vbenSuccess } from '@/common';
import { AdminSuperGuard } from '@/modules/admin/identity/auth/presentation/admin-super.guard';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { MobileHomeService } from '../application/mobile-home.service';
import type { MobileHomeBootstrapResponse } from '../domain/mobile-home.types';
import {
  MobileGamePinRequestDto,
  MobileGamePinResponseDto,
  MobileGameSnapshotResponseDto,
  MobileHomeAssistRequestDto,
  MobileHomeAssistResponseDto,
  MobileHomeBootstrapResponseDto,
  MobileHomeHomeSnapshotResponseDto,
  MobileHomeNoticeItemDto,
  MobileHomeServiceCallRequestDto,
  MobileHomeServiceCallResponseDto,
} from './dto/mobile-home.dto';

@ApiTags('Admin - KwiCore Mobile Home')
@Controller('system/mobile-home')
@UseGuards(JwtAuthGuard, AdminSuperGuard)
export class MobileHomeController {
  constructor(private readonly mobileHome: MobileHomeService) {}

  /**
   * 返回禁止缓存的移动端共享启动快照，并仅格式化 DTO 声明的两个站内信时间字段。
   * @param response - 用于禁止缓存环境与未读状态聚合结果的 HTTP 响应。
   * @returns 包含环境快照和站内信摘要的 Vben 成功响应。
   */
  @Get('bootstrap')
  @ApiOperation({ summary: '获取 KwiCore 主页面共享启动快照' })
  @ApiOkResponse({ type: MobileHomeBootstrapResponseDto })
  async bootstrap(@Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    const snapshot = await this.mobileHome.getBootstrap();
    return vbenSuccess(this.serializeBootstrap(snapshot));
  }

  /**
   * 返回禁止缓存的 Home Assistant 区域、实体、场景、活动和能源快照。
   * @param response - 用于设置 no-store 的 HTTP 响应。
   * @returns KwiCore 智能家居完整首批快照。
   */
  @Get('home')
  @ApiOperation({ summary: '获取 KwiCore Home Assistant 首批能力快照' })
  @ApiOkResponse({ type: MobileHomeHomeSnapshotResponseDto })
  async home(@Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return vbenSuccess(await this.mobileHome.getHomeSnapshot());
  }

  /**
   * 执行已通过实体、domain、service、data 与 requestId 白名单校验的 Home Assistant 写操作。
   * @param body - 移动端幂等服务调用。
   * @returns requestId 与可选最新实体状态。
   */
  @Post('home/service')
  @ApiOperation({ summary: '执行 KwiCore Home Assistant 白名单服务' })
  @ApiOkResponse({ type: MobileHomeServiceCallResponseDto })
  async homeService(@Body() body: MobileHomeServiceCallRequestDto) {
    return vbenSuccess(await this.mobileHome.callHomeService(body));
  }

  /**
   * 把用户文本交给 Home Assistant Conversation API，并仅返回脱敏纯文本结果。
   * @param body - Assist 文本、语言与可选 conversationId。
   * @returns Assist 纯文本、会话标识与响应类型。
   */
  @Post('home/assist')
  @ApiOperation({ summary: '执行 KwiCore Home Assistant Assist 对话' })
  @ApiOkResponse({ type: MobileHomeAssistResponseDto })
  async homeAssist(@Body() body: MobileHomeAssistRequestDto) {
    return vbenSuccess(await this.mobileHome.assist(body));
  }

  /**
   * 返回禁止缓存的 Sunshine 真实应用目录与脱敏 WireGuard 主机。
   * @param response - 用于设置 no-store 的 HTTP 响应。
   * @returns KwiCore 游戏管理目录快照。
   */
  @Get('game')
  @ApiOperation({ summary: '获取 KwiCore Sunshine 游戏目录' })
  @ApiOkResponse({ type: MobileGameSnapshotResponseDto })
  async game(@Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return vbenSuccess(await this.mobileHome.getGameSnapshot());
  }

  /**
   * 把 Moonlight 客户端生成的四位临时 PIN 经服务端私有凭据提交给 Sunshine。
   * @param body - 四位 PIN 与当前客户端友好名称。
   * @returns Sunshine 是否接受配对确认。
   */
  @Post('game/pin')
  @ApiOperation({ summary: '提交 KwiCore Sunshine 临时配对 PIN' })
  @ApiOkResponse({ type: MobileGamePinResponseDto })
  async gamePin(@Body() body: MobileGamePinRequestDto) {
    return vbenSuccess(
      await this.mobileHome.submitGamePin(body.pin, body.name),
    );
  }

  /**
   * 把聚合服务返回的通知逐条应用显式 DTO 时间规则，不递归改写环境快照或其他普通对象。
   * @param snapshot - 已从环境和站内信权威服务读取的移动端启动快照。
   * @returns 可直接进入 Vben 包装器且时间字段符合 KT 合同的响应 DTO。
   */
  private serializeBootstrap(
    snapshot: MobileHomeBootstrapResponse,
  ): MobileHomeBootstrapResponseDto {
    const items = snapshot.notices.items.map((item) => {
      const dto = Object.assign(new MobileHomeNoticeItemDto(), item);
      return transformKtDateTimeFields(dto);
    });
    return {
      environment: snapshot.environment,
      notices: {
        items,
        total: snapshot.notices.total,
        unreadCount: snapshot.notices.unreadCount,
      },
    };
  }
}
