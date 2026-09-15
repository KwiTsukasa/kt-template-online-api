import {
  Module,
  type DynamicModule,
  type ModuleMetadata,
} from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthGuardModule } from '@/modules/admin/identity/auth/admin-auth-guard.module';
import { AutomationPermissionGuard } from '@/common/automation/automation-permission.guard';
import { ScheduleDefinitionService } from './application/schedule-definition.service';
import { ScheduleControlService } from './application/schedule-control.service';
import { ScheduleDispatchService } from './application/schedule-dispatch.service';
import { SCHEDULE_PLANS } from './contract/schedule.types';
import { SCHEDULE_DEFINITIONS } from './contract/schedule-provision.port';
import { ScheduleController } from './contract/schedule.controller';
import {
  ScheduleDraft,
  ScheduleRevision,
  ScheduleState,
  ScheduleRegistration,
  ScheduleDispatch,
} from './infrastructure/persistence/schedule-plan.entities';
import { ScheduleLock } from './infrastructure/schedule-lock';
import { ScheduleRecoveryWorker } from './infrastructure/schedule-recovery.worker';
import { ScheduleRunFeedService } from './application/schedule-run-feed.service';
import { SCHEDULE_RUN_FEED } from './contract/schedule-run-feed.port';

@Module({})
export class SchedulePlanModule {
  /**
   * 在应用装配处连接独立触发、规则和执行端口，计划模块不导入其他领域的实现。
   * @param imports - 当前应用选择的公开端口提供模块。
   * @returns 只拥有计划定义、启停状态及派发记录的模块。
   */
  static register(imports: ModuleMetadata['imports']): DynamicModule {
    return {
      module: SchedulePlanModule,
      imports: [
        AdminAuthGuardModule,
        TypeOrmModule.forFeature([
          ScheduleDraft,
          ScheduleRevision,
          ScheduleState,
          ScheduleRegistration,
          ScheduleDispatch,
        ]),
        ...(imports || []),
      ],
      controllers: [ScheduleController],
      providers: [
        ScheduleDefinitionService,
        { provide: SCHEDULE_DEFINITIONS, useExisting: ScheduleDefinitionService },
        ScheduleControlService,
        ScheduleDispatchService,
        ScheduleLock,
        ScheduleRecoveryWorker,
        ScheduleRunFeedService,
        { provide: SCHEDULE_RUN_FEED, useExisting: ScheduleRunFeedService },
        AutomationPermissionGuard,
        { provide: SCHEDULE_PLANS, useExisting: ScheduleControlService },
      ],
      exports: [SCHEDULE_PLANS, SCHEDULE_RUN_FEED, SCHEDULE_DEFINITIONS],
    };
  }
}
