import { Controller, Get, Query, Sse, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { vbenSuccess } from '@/common';
import {
  AutomationAction,
  AutomationPermissionGuard,
  AutomationResource,
} from '@/common/automation/automation-permission.guard';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { AutomationMonitorService } from '../application/automation-monitor.service';

@ApiTags('执行中心')
@Controller('automation/executions')
@UseGuards(JwtAuthGuard, AutomationPermissionGuard)
@AutomationResource('Monitor')
export class AutomationMonitorController {
  constructor(private readonly monitor: AutomationMonitorService) {}

  /**
   * 复用列表权限订阅快照，断线重连总是重新获取当前摘要，不接受客户端控制执行状态。
   * @param query - 与列表一致的有界筛选条件。
   * @returns 带内容游标的快照流和无业务游标的心跳。
   */
  @Sse('events/stream')
  @AutomationAction('List')
  stream(@Query() query: Record<string, unknown>) {
    return this.monitor.stream(query);
  }

  /**
   * 提供执行摘要的独立授权入口，详情及操作由所属模块再次检查权限。
   * @param query - 运行类型、阶段和有界分页条件。
   * @returns 跨领域只读运行摘要。
   */
  @Get('page')
  @AutomationAction('List')
  async page(@Query() query: Record<string, unknown>) {
    return vbenSuccess(await this.monitor.page(query));
  }
}
