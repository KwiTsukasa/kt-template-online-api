import { forwardRef, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthGuardModule } from '@/modules/admin/identity/auth/admin-auth-guard.module';
import { DictModule } from '@/modules/admin/platform-config/dict/dict.module';
import { QQBOT_PLUGIN_EXECUTION_PORT } from '@/modules/qqbot/core/domain/plugin-execution.port';
import { QqbotCoreModule } from '@/modules/qqbot/core/qqbot-core.module';
import { QqbotPluginArgumentParserService } from './application/argument/qqbot-plugin-argument-parser.service';
import { QqbotEventPluginRegistryService } from './application/registry/qqbot-event-plugin-registry.service';
import { QqbotPluginRegistryService } from './application/registry/qqbot-plugin-registry.service';
import { QqbotPluginExecutionAdapter } from './application/plugin-execution.adapter';
import { QqbotPluginPlatformService } from './application/plugin-platform.service';
import {
  QqbotPluginTaskManifestSynchronizer,
  QqbotPluginTaskSchedulerService,
  QqbotPluginTaskService,
  QqbotPluginTaskWorkerProcessor,
} from './application/task';
import { QqbotPluginPlatformTaskController } from './contract/plugin-platform-task.controller';
import { QqbotPluginPlatformController } from './contract/plugin-platform.controller';
import { QqbotPluginController } from './contract/qqbot-plugin.controller';
import { QQBOT_PLUGIN_PLATFORM_ENTITIES } from './infrastructure/persistence';
import { QqbotPluginPackagePathPolicyService } from './infrastructure/integration/package/plugin-package-path-policy.service';
import { QqbotPluginPackageReaderService } from './infrastructure/integration/package/plugin-package-reader.service';
import { QqbotPluginPackageSourceService } from './infrastructure/integration/package/plugin-package-source.service';
import { QqbotPluginHttpClientService } from './infrastructure/integration/sdk';
import {
  QqbotPluginHostBridgeService,
  QqbotPluginWorkerRuntimeFactoryService,
  resolveQqbotPluginQueueConnection,
  resolveQqbotPluginQueuePrefix,
} from './infrastructure/integration/runtime';
import { QQBOT_PLUGIN_RUNTIME_FACTORY } from './application/plugin-platform.service';

@Module({
  controllers: [
    QqbotPluginController,
    QqbotPluginPlatformController,
    QqbotPluginPlatformTaskController,
  ],
  exports: [
    QQBOT_PLUGIN_EXECUTION_PORT,
    QqbotPluginHttpClientService,
    QqbotPluginPlatformService,
    QqbotPluginTaskService,
  ],
  imports: [
    ConfigModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      /**
       * 创建 插件平台依赖注入工厂产物。
       * @param configService - Nest ConfigService 依赖；驱动 `resolveQqbotPluginQueueConnection()` 的 插件平台步骤。
       */
      useFactory: (configService: ConfigService) => ({
        connection: resolveQqbotPluginQueueConnection(configService),
        prefix: resolveQqbotPluginQueuePrefix(configService),
      }),
    }),
    AdminAuthGuardModule,
    DictModule,
    forwardRef(() => QqbotCoreModule),
    TypeOrmModule.forFeature([...QQBOT_PLUGIN_PLATFORM_ENTITIES]),
  ],
  providers: [
    QqbotEventPluginRegistryService,
    QqbotPluginArgumentParserService,
    QqbotPluginExecutionAdapter,
    QqbotPluginPackagePathPolicyService,
    QqbotPluginPackageSourceService,
    QqbotPluginHostBridgeService,
    QqbotPluginWorkerRuntimeFactoryService,
    QqbotPluginPackageReaderService,
    QqbotPluginTaskManifestSynchronizer,
    QqbotPluginTaskSchedulerService,
    QqbotPluginTaskService,
    QqbotPluginTaskWorkerProcessor,
    {
      provide: QQBOT_PLUGIN_EXECUTION_PORT,
      useExisting: QqbotPluginExecutionAdapter,
    },
    {
      provide: QQBOT_PLUGIN_RUNTIME_FACTORY,
      useExisting: QqbotPluginWorkerRuntimeFactoryService,
    },
    QqbotPluginHttpClientService,
    QqbotPluginPlatformService,
    QqbotPluginRegistryService,
  ],
})
export class QqbotPluginPlatformModule {}
