import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthGuardModule } from '@/modules/admin/identity/auth/admin-auth-guard.module';
import { DictModule } from '@/modules/admin/platform-config/dict/dict.module';
import { QQBOT_PLUGIN_EXECUTION_PORT } from '@/modules/qqbot/core/domain/plugin-execution.port';
import { QqbotCoreModule } from '@/modules/qqbot/core/qqbot-core.module';
import { QqbotBangDreamClientService } from '@/modules/qqbot/plugins/bangDream/application/bangdream-client.service';
import { TsuguApplicationService } from '@/modules/qqbot/plugins/bangDream/application/bangdream-application.service';
import { QqbotBangDreamRendererService } from '@/modules/qqbot/plugins/bangDream/application/bangdream-renderer.facade';
import { QqbotBangDreamPluginService } from '@/modules/qqbot/plugins/bangDream/qqbot-bangdream.plugin';
import { QqbotFf14ClientService } from '@/modules/qqbot/plugins/ff14Market/qqbot-ff14-client.service';
import { QqbotFf14MarketPluginService } from '@/modules/qqbot/plugins/ff14Market/qqbot-ff14-market.plugin';
import { QqbotFflogsClientService } from '@/modules/qqbot/plugins/fflogs/qqbot-fflogs-client.service';
import { QqbotFflogsPluginService } from '@/modules/qqbot/plugins/fflogs/qqbot-fflogs.plugin';
import { QqbotRepeaterPluginService } from '@/modules/qqbot/plugins/repeater/qqbot-repeater.plugin';
import { QqbotPluginArgumentParserService } from './application/argument/qqbot-plugin-argument-parser.service';
import { QqbotEventPluginRegistryService } from './application/registry/qqbot-event-plugin-registry.service';
import { QqbotPluginRegistryService } from './application/registry/qqbot-plugin-registry.service';
import { QqbotPluginExecutionAdapter } from './application/plugin-execution.adapter';
import { QqbotPluginPlatformService } from './application/plugin-platform.service';
import { QqbotPluginPlatformController } from './contract/plugin-platform.controller';
import { QqbotPluginController } from './contract/qqbot-plugin.controller';
import { QQBOT_PLUGIN_PLATFORM_ENTITIES } from './infrastructure/persistence';
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
    QqbotBangDreamClientService,
    QqbotBangDreamPluginService,
    QqbotBangDreamRendererService,
    QqbotEventPluginRegistryService,
    QqbotFf14ClientService,
    QqbotFf14MarketPluginService,
    QqbotFflogsClientService,
    QqbotFflogsPluginService,
    QqbotPluginArgumentParserService,
    QqbotPluginExecutionAdapter,
    {
      provide: QQBOT_PLUGIN_EXECUTION_PORT,
      useExisting: QqbotPluginExecutionAdapter,
    },
    QqbotPluginHttpClientService,
    QqbotPluginPlatformService,
    QqbotPluginRegistryService,
    QqbotRepeaterPluginService,
    TsuguApplicationService,
  ],
})
export class QqbotPluginPlatformModule {}
