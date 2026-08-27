import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthGuardModule } from '@/modules/admin/identity/auth/admin-auth-guard.module';
import { DictModule } from '@/modules/admin/platform-config/dict/dict.module';
import { NetworkPortForward } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-management.entity';
import { BOT_PLUGIN_PROTOCOL } from '@/modules/plugin-platform/contract/plugin-protocol';
import { PluginArgumentParserService } from './application/argument/plugin-argument-parser.service';
import { PluginEventRegistryService } from './application/registry/plugin-event-registry.service';
import { PluginRegistryService } from './application/registry/plugin-registry.service';
import { PluginExecutionAdapter } from './application/plugin-execution.adapter';
import { PluginPlatformService } from './application/plugin-platform.service';
import {
  PluginTaskManifestSynchronizer,
  PluginTaskSchedulerService,
  PluginTaskService,
  PluginTaskWorkerProcessor,
} from './application/task';
import { PluginPlatformTaskController } from './contract/plugin-platform-task.controller';
import { PluginPlatformController } from './contract/plugin-platform.controller';
import { PluginController } from './contract/plugin-catalog.controller';
import { PluginPlatformPermissionGuard } from './contract/plugin-platform-permission.guard';
import { PLUGIN_PLATFORM_ENTITIES } from './infrastructure/persistence';
import { PluginPackagePathPolicyService } from './infrastructure/integration/package/plugin-package-path-policy.service';
import { PluginPackageReaderService } from './infrastructure/integration/package/plugin-package-reader.service';
import { PluginPackageSourceService } from './infrastructure/integration/package/plugin-package-source.service';
import { PluginHttpClientService } from './infrastructure/integration/sdk';
import {
  PluginHostBridgeService,
  PluginWorkerRuntimeFactoryService,
  resolvePluginQueueConnection,
  resolvePluginQueuePrefix,
} from './infrastructure/integration/runtime';
import { PLUGIN_RUNTIME_FACTORY } from './application/plugin-platform.service';

@Module({
  controllers: [
    PluginController,
    PluginPlatformController,
    PluginPlatformTaskController,
  ],
  exports: [
    BOT_PLUGIN_PROTOCOL,
    PluginHttpClientService,
    PluginPlatformPermissionGuard,
    PluginPlatformService,
    PluginTaskService,
  ],
  imports: [
    ConfigModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: resolvePluginQueueConnection(configService),
        prefix: resolvePluginQueuePrefix(configService),
      }),
    }),
    AdminAuthGuardModule,
    DictModule,
    TypeOrmModule.forFeature([...PLUGIN_PLATFORM_ENTITIES, NetworkPortForward]),
  ],
  providers: [
    PluginEventRegistryService,
    PluginArgumentParserService,
    PluginExecutionAdapter,
    PluginPackagePathPolicyService,
    PluginPackageSourceService,
    PluginHostBridgeService,
    PluginPlatformPermissionGuard,
    PluginWorkerRuntimeFactoryService,
    PluginPackageReaderService,
    PluginTaskManifestSynchronizer,
    PluginTaskSchedulerService,
    PluginTaskService,
    PluginTaskWorkerProcessor,
    {
      provide: BOT_PLUGIN_PROTOCOL,
      useExisting: PluginExecutionAdapter,
    },
    {
      provide: PLUGIN_RUNTIME_FACTORY,
      useExisting: PluginWorkerRuntimeFactoryService,
    },
    PluginHttpClientService,
    PluginPlatformService,
    PluginRegistryService,
  ],
})
export class PluginPlatformModule {}
