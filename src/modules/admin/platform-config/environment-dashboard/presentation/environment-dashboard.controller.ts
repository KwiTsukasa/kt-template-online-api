import {
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { vbenSuccess } from '@/common';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { EnvironmentDashboardSelfCheckService } from '../application/environment-dashboard-self-check.service';
import { EnvironmentDashboardService } from '../application/environment-dashboard.service';
import { EnvironmentEventStreamService } from '../application/environment-event-stream.service';
import {
  EnvironmentDashboardResponseDto,
  EnvironmentStreamEventDto,
} from './dto/environment-dashboard.dto';

@ApiTags('Admin - 环境总览')
@Controller('system/environment')
@UseGuards(JwtAuthGuard)
export class EnvironmentDashboardController {
  constructor(
    private readonly dashboardService: EnvironmentDashboardService,
    private readonly selfCheckService: EnvironmentDashboardSelfCheckService,
    private readonly streamService: EnvironmentEventStreamService,
  ) {}

  /**
   * 查询领域服务并组装管理端仪表盘。
   * @returns 仪表盘。
   */
  @Get('dashboard')
  @ApiOperation({ summary: '查询环境总览快照' })
  @ApiOkResponse({ type: EnvironmentDashboardResponseDto })
  async dashboard() {
    return vbenSuccess(await this.dashboardService.getDashboard());
  }

  /**
   * 查询领域服务并组装管理端自身检查。
   * @returns 自身检查。
   */
  @Post('self-check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '运行环境总览只读自检' })
  @ApiOkResponse({ type: EnvironmentDashboardResponseDto })
  async selfCheck() {
    return vbenSuccess(await this.selfCheckService.runSelfCheck());
  }

  /**
   * 通过建立包含可重放事件、实时提交事件与定时心跳的服务端事件流。
   * @param lastEventIdHeader - 决定通过建立包含可重放事件、实时提交事件与定时心跳的服务端事件流内容、边界或目标的 `lastEventIdHeader` 值；为空时采用 `lastEventIdQuery` 作为兜底。
   * @param lastEventIdQuery - 决定通过建立包含可重放事件、实时提交事件与定时心跳的服务端事件流内容、边界或目标的 `lastEventIdQuery` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 返回合并历史重放、实时事件与定时心跳的只读 Observable。
   */
  @Sse('events/stream')
  @ApiOperation({ summary: '订阅环境总览实时事件' })
  @ApiOkResponse({ type: EnvironmentStreamEventDto })
  stream(
    @Headers('last-event-id') lastEventIdHeader?: string,
    @Query('lastEventId') lastEventIdQuery?: string,
  ) {
    return this.streamService.stream(lastEventIdHeader || lastEventIdQuery);
  }
}
