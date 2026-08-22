import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthGuardModule } from '@/modules/admin/identity/auth/admin-auth-guard.module';
import { BotProtocolModule } from '@/modules/bot';
import { BotAdapterCoreModule } from '@/modules/bot-adapter/core/bot-adapter-core.module';
import { BotCommand } from '@/modules/bot-adapter/core/infrastructure/persistence/command/bot-command.entity';
import { PluginPlatformModule } from '@/modules/plugin-platform/plugin-platform.module';
import { TencentBotMenuService } from './application/tencent-bot-menu.service';
import { TencentBotPluginBindingService } from './application/tencent-bot-plugin-binding.service';
import { TencentBotController } from './contract/tencent-bot.controller';
import { TencentBotWebhookController } from './contract/tencent-bot-webhook.controller';
import {
  loadTencentBotSdk,
  TENCENT_BOT_SDK_LOADER,
  TencentBotService,
} from './infrastructure/tencent-bot.service';
import { TencentBotPluginBinding } from './infrastructure/persistence/tencent-bot-plugin-binding.entity';
import { TencentBotProtocolAdapter } from './infrastructure/tencent-bot-protocol.adapter';

@Module({
  controllers: [TencentBotController, TencentBotWebhookController],
  exports: [TencentBotService, TencentBotPluginBindingService],
  imports: [
    ConfigModule,
    AdminAuthGuardModule,
    BotProtocolModule,
    BotAdapterCoreModule,
    PluginPlatformModule,
    TypeOrmModule.forFeature([BotCommand, TencentBotPluginBinding]),
  ],
  providers: [
    TencentBotMenuService,
    TencentBotPluginBindingService,
    TencentBotService,
    TencentBotProtocolAdapter,
    {
      provide: TENCENT_BOT_SDK_LOADER,
      useValue: loadTencentBotSdk,
    },
  ],
})
export class TencentBotAdapterModule {}
