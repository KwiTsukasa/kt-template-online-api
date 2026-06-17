import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/jwt-auth.guard';
import { vbenSuccess } from '@/common';
import { QqbotDashboardService } from '../../application/dashboard/qqbot-dashboard.service';

@ApiTags('QQBot - 工作台')
@Controller('qqbot/dashboard')
@UseGuards(JwtAuthGuard)
export class QqbotDashboardController {
  /**
   * 初始化 QqbotDashboardController 实例。
   * @param dashboardService - dashboardService 服务依赖；影响 constructor 的返回值。
   */
  constructor(private readonly dashboardService: QqbotDashboardService) {}

  /**
   * QQBot 工作台汇总。
   */
  @Get('summary')
  @ApiOperation({ summary: 'QQBot 工作台汇总' })
  async summary() {
    return vbenSuccess(await this.dashboardService.summary());
  }
}
