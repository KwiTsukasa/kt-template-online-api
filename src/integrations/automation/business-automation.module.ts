import {
  Module,
  type DynamicModule,
  type ModuleMetadata,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BusinessTaskRegistration } from './business-task.registration';
import { BusinessPlanBootstrap } from './business-plan.bootstrap';
import { DefaultPlanProvisioner } from './default-plan.provisioner';

@Module({})
export class BusinessAutomationModule {
  /**
   * 连接业务公开操作和独立自动化端口，处理器先注册，默认计划在应用启动阶段建立。
   * @param imports - 提供业务能力、任务、触发和计划端口的模块。
   * @returns 不拥有领域执行状态的应用集成模块。
   */
  static register(imports: ModuleMetadata['imports']): DynamicModule {
    return {
      module: BusinessAutomationModule,
      imports: [ConfigModule, ...(imports || [])],
      providers: [
        BusinessTaskRegistration,
        DefaultPlanProvisioner,
        BusinessPlanBootstrap,
      ],
    };
  }
}
