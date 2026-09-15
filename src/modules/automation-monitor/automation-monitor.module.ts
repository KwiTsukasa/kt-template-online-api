import {
  Module,
  type DynamicModule,
  type ModuleMetadata,
} from '@nestjs/common';
import { AdminAuthGuardModule } from '@/modules/admin/identity/auth/admin-auth-guard.module';
import { AutomationPermissionGuard } from '@/common/automation/automation-permission.guard';
import { AutomationMonitorController } from './contract/automation-monitor.controller';
import { AutomationMonitorService } from './application/automation-monitor.service';

@Module({})
export class AutomationMonitorModule {
  /**
   * 由应用装配公开运行摘要端口，监控模块不注册执行器、调度器或持久化表。
   * @param imports - 提供任务、工作流和计划只读摘要端口的模块。
   * @returns 无写接口和执行依赖反向引用的监控模块。
   */
  static register(imports: ModuleMetadata['imports']): DynamicModule {
    return {
      module: AutomationMonitorModule,
      imports: [AdminAuthGuardModule, ...(imports || [])],
      controllers: [AutomationMonitorController],
      providers: [AutomationMonitorService, AutomationPermissionGuard],
    };
  }
}
