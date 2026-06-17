import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiArrayResponse,
  ApiModelResponse,
  ApiPageResponse,
  vbenPage,
  vbenSuccess,
} from '@/common';
import { JwtAuthGuard } from '../../identity/auth/jwt-auth.guard';
import {
  SystemLogDto,
  SystemLogQueryDto,
  SystemLogStatusDto,
  SystemLogSummaryDto,
} from './system-log.dto';
import { SystemLogService } from './system-log.service';

@ApiTags('Admin - 系统日志')
@Controller('system/logs')
@UseGuards(JwtAuthGuard)
export class SystemLogController {
  /**
   * 初始化 SystemLogController 实例。
   * @param systemLogService - systemLogService 服务依赖；影响 constructor 的返回值。
   */
  constructor(private readonly systemLogService: SystemLogService) {}

  /**
   * 查询系统日志。
   * @param query - 查询参数 DTO；限定 Admin分页、搜索或详情查询条件。
   */
  @Get()
  @ApiOperation({ summary: '查询系统日志' })
  @ApiPageResponse(SystemLogDto, [
    {
      id: '1760000000000000000-0-0',
      timestamp: '2026-06-04 08:00:00',
      timestampNs: '1760000000000000000',
      level: 'info',
      context: 'RouterExplorer',
      message: 'Mapped route',
      method: 'GET',
      path: '/system/logs',
      statusCode: 200,
      durationMs: 12,
      requestId: 'd9ac19e3-9e0d-4e19-b48e-6a6b4a31a2d2',
      hostname: 'kt-template-online-api',
      raw: '{"level":30,"msg":"Mapped route"}',
    },
  ])
  async list(@Query() query: SystemLogQueryDto) {
    const page = await this.systemLogService.page(query);
    return vbenPage(page.items, page.total);
  }

  /**
   * 查询系统日志级别统计。
   * @param query - 查询参数 DTO；限定 Admin分页、搜索或详情查询条件。
   */
  @Get('summary')
  @ApiOperation({ summary: '查询系统日志级别统计' })
  @ApiArrayResponse(SystemLogSummaryDto, [{ level: 'error', count: 2 }])
  async summary(@Query() query: SystemLogQueryDto) {
    return vbenSuccess(await this.systemLogService.summary(query));
  }

  /**
   * 查询系统日志级别选项。
   */
  @Get('levels')
  @ApiOperation({ summary: '查询系统日志级别选项' })
  async levels() {
    return vbenSuccess(this.systemLogService.levels());
  }

  /**
   * 查询系统日志配置状态。
   */
  @Get('status')
  @ApiOperation({ summary: '查询系统日志配置状态' })
  @ApiModelResponse(SystemLogStatusDto, {
    app: 'kt-template-online-api',
    configured: true,
    env: 'production',
    host: 'http://loki:3100',
    selector: '{app="kt-template-online-api",env="production"}',
  })
  async status() {
    return vbenSuccess(this.systemLogService.status());
  }
}
