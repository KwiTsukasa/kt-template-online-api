import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthGuardModule } from '@/modules/admin/identity/auth/admin-auth-guard.module';
import { BotProtocolModule } from '@/modules/bot';
import { DictModule } from '@/modules/admin/platform-config/dict/dict.module';
import { NapcatModule } from '@/modules/bot-adapter/napcat/napcat.module';
import { PluginPlatformModule } from '@/modules/plugin-platform/plugin-platform.module';
import { BotAccountAbility } from '@/modules/bot-adapter/core/infrastructure/persistence/account/bot-account-ability.entity';
import { BotAccountController } from '@/modules/bot-adapter/core/contract/account/bot-account.controller';
import { BotAccount } from '@/modules/bot-adapter/core/infrastructure/persistence/account/bot-account.entity';
import { BotAccountService } from '@/modules/bot-adapter/core/application/account/bot-account.service';
import { BotAccountExtensionRegistry } from '@/modules/bot-adapter/core/application/account/bot-account-extension.registry';
import { BotCommandController } from '@/modules/bot-adapter/core/contract/command/bot-command.controller';
import { BotCommand } from '@/modules/bot-adapter/core/infrastructure/persistence/command/bot-command.entity';
import { BotCommandEngineService } from '@/modules/bot-adapter/core/application/command/bot-command-engine.service';
import { BotCommandLog } from '@/modules/bot-adapter/core/infrastructure/persistence/command/bot-command-log.entity';
import { BotCommandParserService } from '@/modules/bot-adapter/core/application/command/bot-command-parser.service';
import { BotCommandService } from '@/modules/bot-adapter/core/application/command/bot-command.service';
import { BotReplyTemplateService } from '@/modules/bot-adapter/core/application/command/bot-reply-template.service';
import { BotReverseWsService } from '@/modules/bot-adapter/core/infrastructure/integration/connection/bot-reverse-ws.service';
import { BotConfig } from '@/modules/bot-adapter/core/infrastructure/persistence/config/bot-config.entity';
import { BotConfigService } from '@/modules/bot-adapter/core/application/config/bot-config.service';
import { BotDashboardController } from '@/modules/bot-adapter/core/contract/dashboard/bot-dashboard.controller';
import { BotDashboardService } from '@/modules/bot-adapter/core/application/dashboard/bot-dashboard.service';
import { BotDedupe } from '@/modules/bot-adapter/core/infrastructure/persistence/dedupe/bot-dedupe.entity';
import { BotDedupeService } from '@/modules/bot-adapter/core/application/dedupe/bot-dedupe.service';
import { BotEventService } from '@/modules/bot-adapter/core/application/event/bot-event.service';
import { BotConversation } from '@/modules/bot-adapter/core/infrastructure/persistence/message/bot-conversation.entity';
import { BotMessageController } from '@/modules/bot-adapter/core/contract/message/bot-message.controller';
import { BotMessage } from '@/modules/bot-adapter/core/infrastructure/persistence/message/bot-message.entity';
import { BotMessageService } from '@/modules/bot-adapter/core/application/message/bot-message.service';
import { BotBusService } from '@/modules/bot-adapter/core/infrastructure/integration/bus/bot-bus.service';
import { BotAllowlist } from '@/modules/bot-adapter/core/infrastructure/persistence/permission/bot-allowlist.entity';
import { BotBlocklist } from '@/modules/bot-adapter/core/infrastructure/persistence/permission/bot-blocklist.entity';
import { BotPermissionController } from '@/modules/bot-adapter/core/contract/permission/bot-permission.controller';
import { BotPermissionService } from '@/modules/bot-adapter/core/application/permission/bot-permission.service';
import { BotRuleController } from '@/modules/bot-adapter/core/contract/rule/bot-rule.controller';
import { BotRule } from '@/modules/bot-adapter/core/infrastructure/persistence/rule/bot-rule.entity';
import { BotRuleEngineService } from '@/modules/bot-adapter/core/application/send/bot-rule-engine.service';
import { BotRuleService } from '@/modules/bot-adapter/core/application/rule/bot-rule.service';
import { BotRateLimitService } from '@/modules/bot-adapter/core/application/send/bot-rate-limit.service';
import { BotSendController } from '@/modules/bot-adapter/core/contract/send/bot-send.controller';
import { BotSendLog } from '@/modules/bot-adapter/core/infrastructure/persistence/send/bot-send-log.entity';
import { BotSendService } from '@/modules/bot-adapter/core/application/send/bot-send.service';

export { BOT_CORE_DOMAIN_CONTRACT } from './contract/bot-core.contract';

export const BOT_CORE_ENTITIES = [
  BotAccount,
  BotAccountAbility,
  BotAllowlist,
  BotBlocklist,
  BotCommand,
  BotCommandLog,
  BotConfig,
  BotConversation,
  BotDedupe,
  BotMessage,
  BotRule,
  BotSendLog,
];

export const BOT_CORE_CONTROLLERS = [
  BotAccountController,
  BotCommandController,
  BotDashboardController,
  BotMessageController,
  BotPermissionController,
  BotRuleController,
  BotSendController,
];

export const BOT_CORE_PROVIDERS = [
  BotAccountExtensionRegistry,
  BotAccountService,
  BotBusService,
  BotCommandEngineService,
  BotCommandParserService,
  BotCommandService,
  BotConfigService,
  BotDashboardService,
  BotDedupeService,
  BotEventService,
  BotMessageService,
  BotPermissionService,
  BotRateLimitService,
  BotReplyTemplateService,
  BotReverseWsService,
  BotRuleEngineService,
  BotRuleService,
  BotSendService,
];

export const BOT_CORE_EXPORTS = [
  BotAccountExtensionRegistry,
  BotAccountService,
  BotCommandService,
  BotConfigService,
  BotDashboardService,
  BotEventService,
  BotSendService,
  BotReverseWsService,
];

@Module({
  imports: [
    ConfigModule,
    AdminAuthGuardModule,
    BotProtocolModule,
    DictModule,
    forwardRef(() => NapcatModule),
    forwardRef(() => PluginPlatformModule),
    TypeOrmModule.forFeature(BOT_CORE_ENTITIES),
  ],
  controllers: BOT_CORE_CONTROLLERS,
  providers: BOT_CORE_PROVIDERS,
  exports: BOT_CORE_EXPORTS,
})
export class BotAdapterCoreModule {}
