import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { transformKtDateTimeFields, vbenSuccess } from '@/common';
import { AdminSuperGuard } from '@/modules/admin/identity/auth/presentation/admin-super.guard';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { MobileHomeService } from '../application/mobile-home.service';
import type { MobileHomeBootstrapResponse } from '../domain/mobile-home.types';
import {
  MobileHomeBootstrapResponseDto,
  MobileHomeNoticeItemDto,
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
