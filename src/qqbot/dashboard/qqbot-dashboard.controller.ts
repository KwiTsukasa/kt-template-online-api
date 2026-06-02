import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/admin/auth/jwt-auth.guard';
import { vbenSuccess } from '@/common';
import { QqbotDashboardService } from './qqbot-dashboard.service';

@ApiTags('QQBot - 工作台')
@Controller('qqbot/dashboard')
@UseGuards(JwtAuthGuard)
export class QqbotDashboardController {
  constructor(private readonly dashboardService: QqbotDashboardService) {}

  @Get('summary')
  @ApiOperation({ summary: 'QQBot 工作台汇总' })
  async summary() {
    return vbenSuccess(await this.dashboardService.summary());
  }
}
