import {
  Module,
  type DynamicModule,
  type ModuleMetadata,
} from '@nestjs/common';
import { PluginTaskRegistration } from './plugin-task.registration';
import { PluginPlanBootstrap } from './plugin-plan.bootstrap';
import { DefaultPlanProvisioner } from './default-plan.provisioner';

@Module({})
export class PluginAutomationModule {
  /**
   * 在应用组合层连接插件能力与独立任务、触发器、计划端口，领域模块不反向导入适配器。
   * @param imports - 提供插件能力、任务注册及默认资源装配端口的模块。
   * @returns 承担能力翻译、默认计划初始化和注册释放的集成模块。
   */
  static register(imports: ModuleMetadata['imports']): DynamicModule {
    return {
      module: PluginAutomationModule,
      imports: imports || [],
      providers: [
        PluginTaskRegistration,
        DefaultPlanProvisioner,
        PluginPlanBootstrap,
      ],
    };
  }
}
