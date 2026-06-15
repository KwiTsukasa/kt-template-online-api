import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthGuardModule } from '@/modules/admin/identity/auth/admin-auth-guard.module';
import { DictModule } from '@/modules/admin/platform-config/dict/dict.module';
import { QQBOT_PLUGIN_EXECUTION_PORT } from '@/modules/qqbot/core/domain/plugin-execution.port';
import { QqbotCoreModule } from '@/modules/qqbot/core/qqbot-core.module';
import { QqbotPluginArgumentParserService } from './application/argument/qqbot-plugin-argument-parser.service';
import { QQBOT_PLUGIN_INPUT_NORMALIZER } from './application/argument/plugin-input-normalizer.port';
import { QqbotEventPluginRegistryService } from './application/registry/qqbot-event-plugin-registry.service';
import { QqbotPluginRegistryService } from './application/registry/qqbot-plugin-registry.service';
import { QqbotPluginExecutionAdapter } from './application/plugin-execution.adapter';
import { QqbotPluginPlatformService } from './application/plugin-platform.service';
import { QqbotPluginPlatformController } from './contract/plugin-platform.controller';
import { QqbotPluginController } from './contract/qqbot-plugin.controller';
import { QQBOT_PLUGIN_PLATFORM_ENTITIES } from './infrastructure/persistence';
import { QqbotPluginInputNormalizerService } from './infrastructure/integration/argument/plugin-input-normalizer.service';
import { QqbotBuiltinPluginPackageLoaderService } from './infrastructure/integration/package/builtin-plugin-package-loader.service';
import { QqbotPluginHttpClientService } from './infrastructure/integration/sdk';

@Module({
  controllers: [QqbotPluginController, QqbotPluginPlatformController],
  exports: [
    QQBOT_PLUGIN_EXECUTION_PORT,
    QqbotPluginHttpClientService,
    QqbotPluginPlatformService,
  ],
  imports: [
    ConfigModule,
    AdminAuthGuardModule,
    DictModule,
    forwardRef(() => QqbotCoreModule),
    TypeOrmModule.forFeature([...QQBOT_PLUGIN_PLATFORM_ENTITIES]),
  ],
  providers: [
    QqbotEventPluginRegistryService,
    QqbotPluginArgumentParserService,
    QqbotPluginExecutionAdapter,
    QqbotPluginInputNormalizerService,
    QqbotBuiltinPluginPackageLoaderService,
    {
      provide: QQBOT_PLUGIN_INPUT_NORMALIZER,
      useExisting: QqbotPluginInputNormalizerService,
    },
    {
      provide: QQBOT_PLUGIN_EXECUTION_PORT,
      useExisting: QqbotPluginExecutionAdapter,
    },
    QqbotPluginHttpClientService,
    QqbotPluginPlatformService,
    QqbotPluginRegistryService,
  ],
})
export class QqbotPluginPlatformModule {}
