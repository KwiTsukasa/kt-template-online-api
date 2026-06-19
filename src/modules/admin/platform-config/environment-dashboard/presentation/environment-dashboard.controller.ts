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
import { JwtAuthGuard } from '@/modules/admin/identity/auth/jwt-auth.guard';
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
  /**
   * Initializes the environment dashboard controller.
   * @param dashboardService - Snapshot service used by Admin route load and manual refresh.
   * @param selfCheckService - Readonly self-check service used by the Admin action button.
   * @param streamService - SSE stream service used for realtime updates without polling.
   */
  constructor(
    private readonly dashboardService: EnvironmentDashboardService,
    private readonly selfCheckService: EnvironmentDashboardSelfCheckService,
    private readonly streamService: EnvironmentEventStreamService,
  ) {}

  /**
   * Loads the aggregate environment dashboard snapshot for Admin.
   * @returns Vben response containing the current dashboard snapshot.
   */
  @Get('dashboard')
  @ApiOperation({ summary: '查询环境总览快照' })
  @ApiOkResponse({ type: EnvironmentDashboardResponseDto })
  async dashboard() {
    return vbenSuccess(await this.dashboardService.getDashboard());
  }

  /**
   * Runs readonly probes and returns a fresh dashboard snapshot.
   * @returns Vben response containing the self-check snapshot.
   */
  @Post('self-check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '运行环境总览只读自检' })
  @ApiOkResponse({ type: EnvironmentDashboardResponseDto })
  async selfCheck() {
    return vbenSuccess(await this.selfCheckService.runSelfCheck());
  }

  /**
   * Subscribes Admin to realtime environment events without exposing MQTT.
   * @param lastEventIdHeader Browser `Last-Event-ID` header used after reconnect.
   * @param lastEventIdQuery Query fallback used by local tests or proxy-limited clients.
   * @returns SSE observable with replay, live events, and heartbeats.
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
