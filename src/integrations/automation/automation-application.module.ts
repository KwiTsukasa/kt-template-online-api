import { Module } from '@nestjs/common';
import { TaskExecutionModule } from '@/modules/task-execution/task-execution.module';
import { TriggerEngineModule } from '@/modules/trigger-engine/trigger-engine.module';
import { RuleEngineModule } from '@/modules/rule-engine/rule-engine.module';
import { FormDefinitionModule } from '@/modules/form-definition/form-definition.module';
import { WorkflowEngineModule } from '@/modules/workflow-engine/workflow-engine.module';
import { SchedulePlanModule } from '@/modules/task-scheduling/schedule-plan.module';
import { AutomationMonitorModule } from '@/modules/automation-monitor/automation-monitor.module';
import { PluginPlatformModule } from '@/modules/plugin-platform/plugin-platform.module';
import { MessageManagementModule } from '@/modules/message-management/message-management.module';
import { AdminMediaGovernanceModule } from '@/modules/admin/media-governance/admin-media-governance.module';
import { AdminPlatformConfigModule } from '@/modules/admin/platform-config/admin-platform-config.module';
import { NapcatModule } from '@/modules/bot-adapter/napcat/napcat.module';
import { PluginAutomationModule } from './plugin-automation.module';
import { BusinessAutomationModule } from './business-automation.module';
import { BotAdapterCoreModule } from '@/modules/bot-adapter/core/bot-adapter-core.module';
import { BotReminderAutomationModule } from './bot-reminder-automation.module';

const workflows = WorkflowEngineModule.register([
  TaskExecutionModule,
  RuleEngineModule,
  FormDefinitionModule,
]);
const schedules = SchedulePlanModule.register([
  TriggerEngineModule,
  RuleEngineModule,
  TaskExecutionModule,
  workflows,
]);

@Module({
  imports: [
    BotReminderAutomationModule.register([
      BotAdapterCoreModule,
      TaskExecutionModule,
      TriggerEngineModule,
      schedules,
    ]),
    AutomationMonitorModule.register([
      TaskExecutionModule,
      workflows,
      schedules,
    ]),
    PluginAutomationModule.register([
      PluginPlatformModule,
      TaskExecutionModule,
      TriggerEngineModule,
      schedules,
    ]),
    BusinessAutomationModule.register([
      TaskExecutionModule,
      TriggerEngineModule,
      schedules,
      MessageManagementModule,
      AdminMediaGovernanceModule,
      AdminPlatformConfigModule,
      NapcatModule,
    ]),
  ],
})
export class AutomationApplicationModule {}
