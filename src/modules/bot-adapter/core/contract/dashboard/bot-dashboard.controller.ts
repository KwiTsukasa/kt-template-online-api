import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { vbenSuccess } from '@/common';
import { BotDashboardService } from '../../application/dashboard/bot-dashboard.service';

@ApiTags('Bot - 工作台')
@Controller('bot/dashboard')
@UseGuards(JwtAuthGuard)
export class BotDashboardController {
  constructor(private readonly dashboardService: BotDashboardService) {}

  /**
   * 根据当前运行态处理Bot 工作台汇总。
   * @returns Bot 工作台汇总。
   */
  @Get('summary')
  @ApiOperation({ summary: 'Bot 工作台汇总' })
  async summary() {
    return vbenSuccess(await this.dashboardService.summary());
  }
}
