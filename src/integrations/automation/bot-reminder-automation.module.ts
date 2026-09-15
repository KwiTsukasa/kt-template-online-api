import {
  Module,
  type DynamicModule,
  type ModuleMetadata,
} from '@nestjs/common';
import { BotReminderRegistration } from './bot-reminder.registration';
import { DefaultPlanProvisioner } from './default-plan.provisioner';

@Module({})
export class BotReminderAutomationModule {
  /**
   * 在应用层装配 Bot 提醒与任务、触发器、计划端口，领域之间没有反向导入。
   * @param imports - 提供 Bot 公开提醒操作和独立自动化端口的模块。
   * @returns 提醒调度集成模块。
   */
  static register(imports: ModuleMetadata['imports']): DynamicModule {
    return {
      module: BotReminderAutomationModule,
      imports: imports || [],
      providers: [DefaultPlanProvisioner, BotReminderRegistration],
    };
  }
}
