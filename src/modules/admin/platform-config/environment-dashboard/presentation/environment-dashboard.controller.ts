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

  /** 返回仪表盘。 */
  @Get('dashboard')
  @ApiOperation({ summary: '查询环境总览快照' })
  @ApiOkResponse({ type: EnvironmentDashboardResponseDto })
  async dashboard() {
    return vbenSuccess(await this.dashboardService.getDashboard());
  }

  /** 返回自身检查。 */
  @Post('self-check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '运行环境总览只读自检' })
  @ApiOkResponse({ type: EnvironmentDashboardResponseDto })
  async selfCheck() {
    return vbenSuccess(await this.selfCheckService.runSelfCheck());
  }

  /** 返回流。 */
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
