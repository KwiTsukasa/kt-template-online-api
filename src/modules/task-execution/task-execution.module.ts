import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AutomationPermissionGuard } from '@/common/automation/automation-permission.guard';
import { AdminAuthGuardModule } from '@/modules/admin/identity/auth/admin-auth-guard.module';
import { TaskDefinitionService } from './application/task-definition.service';
import { TaskExecutionService } from './application/task-execution.service';
import { TaskHandlerRegistry } from './application/task-handler.registry';
import { TaskExecutionController } from './contract/task-execution.controller';
import { TASK_EXECUTION } from './contract/task-execution.port';
import { TASK_HANDLERS } from './contract/task-handler.port';
import {
  AtomicTaskAttempt,
  AtomicTaskDraft,
  AtomicTaskRevision,
  AtomicTaskRun,
  AtomicTaskRunReview,
} from './infrastructure/persistence/task-execution.entities';
import { TaskRunFeedService } from './application/task-run-feed.service';
import { TASK_RUN_FEED } from './contract/task-run-feed.port';
import { TASK_DEFINITIONS } from './contract/task-provision.port';

@Module({
  imports: [
    ConfigModule,
    AdminAuthGuardModule,
    TypeOrmModule.forFeature([
      AtomicTaskDraft,
      AtomicTaskRevision,
      AtomicTaskRun,
      AtomicTaskAttempt,
      AtomicTaskRunReview,
    ]),
  ],
  controllers: [TaskExecutionController],
  providers: [
    TaskDefinitionService,
    { provide: TASK_DEFINITIONS, useExisting: TaskDefinitionService },
    TaskExecutionService,
    TaskHandlerRegistry,
    TaskRunFeedService,
    { provide: TASK_RUN_FEED, useExisting: TaskRunFeedService },
    AutomationPermissionGuard,
    { provide: TASK_EXECUTION, useExisting: TaskExecutionService },
    { provide: TASK_HANDLERS, useExisting: TaskHandlerRegistry },
  ],
  exports: [TASK_EXECUTION, TASK_HANDLERS, TASK_RUN_FEED, TASK_DEFINITIONS],
})
export class TaskExecutionModule {}
