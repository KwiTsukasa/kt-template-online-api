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
import { QqbotPluginPlatformController } from './contract/plugin-platform.controller';
import { QqbotPluginController } from './contract/qqbot-plugin.controller';
import { QQBOT_PLUGIN_PLATFORM_ENTITIES } from './infrastructure/persistence';
import { QqbotBuiltinPluginPackageLoaderService } from './infrastructure/integration/package/builtin-plugin-package-loader.service';
import { QqbotPluginPackageReaderService } from './infrastructure/integration/package/plugin-package-reader.service';
import { QqbotPluginHttpClientService } from './infrastructure/integration/sdk';
import {
  QqbotBuiltinPluginWorkerRuntimeFactoryService,
  resolveQqbotPluginQueueConnection,
  resolveQqbotPluginQueuePrefix,
} from './infrastructure/integration/runtime';
import { QQBOT_PLUGIN_RUNTIME_FACTORY } from './application/plugin-platform.service';

@Module({
  controllers: [QqbotPluginController, QqbotPluginPlatformController],
  exports: [
    QQBOT_PLUGIN_EXECUTION_PORT,
    QqbotPluginHttpClientService,
    QqbotPluginPlatformService,
  ],
  imports: [
    ConfigModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
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
    QqbotBuiltinPluginPackageLoaderService,
    QqbotBuiltinPluginWorkerRuntimeFactoryService,
    QqbotPluginPackageReaderService,
    {
      provide: QQBOT_PLUGIN_EXECUTION_PORT,
      useExisting: QqbotPluginExecutionAdapter,
    },
    {
      provide: QQBOT_PLUGIN_RUNTIME_FACTORY,
      useExisting: QqbotBuiltinPluginWorkerRuntimeFactoryService,
    },
    QqbotPluginHttpClientService,
    QqbotPluginPlatformService,
    QqbotPluginRegistryService,
  ],
})
export class QqbotPluginPlatformModule {}
