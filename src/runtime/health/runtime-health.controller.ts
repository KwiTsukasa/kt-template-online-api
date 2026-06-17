import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RuntimeHealthService } from './runtime-health.service';
import type { RuntimeHealthReport } from './runtime-health.types';

@ApiTags('Runtime Health')
@Controller('health')
export class RuntimeHealthController {
  /**
   * 初始化 RuntimeHealthController 实例。
   * @param runtimeHealthService - runtimeHealthService 服务依赖；影响 constructor 的返回值。
   */
  constructor(private readonly runtimeHealthService: RuntimeHealthService) {}

  /**
   * Get machine-readable API runtime health。
   * @returns 运行态健康检查查询结果。
   */
  @Get('runtime')
  @ApiOperation({ summary: 'Get machine-readable API runtime health' })
  getRuntimeHealth(): RuntimeHealthReport {
    return this.runtimeHealthService.getRuntimeHealth();
  }
}
