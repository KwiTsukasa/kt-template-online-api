import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthGuardModule } from '@/modules/admin/identity/auth/admin-auth-guard.module';
import { DictModule } from '@/modules/admin/platform-config/dict/dict.module';
import { QqbotAccountAbility } from '@/modules/qqbot/core/account/qqbot-account-ability.entity';
import { QqbotAccountController } from '@/modules/qqbot/core/account/qqbot-account.controller';
import { QqbotAccount } from '@/modules/qqbot/core/account/qqbot-account.entity';
import { QqbotAccountService } from '@/modules/qqbot/core/account/qqbot-account.service';
import { QqbotNapcatLoginService } from '@/modules/qqbot/napcat/login/qqbot-napcat-login.service';
import { QqbotNapcatWatchdogService } from '@/modules/qqbot/napcat/login/qqbot-napcat-watchdog.service';
import { QqbotCommandController } from '@/modules/qqbot/core/command/qqbot-command.controller';
import { QqbotCommand } from '@/modules/qqbot/core/command/qqbot-command.entity';
import { QqbotCommandEngineService } from '@/modules/qqbot/core/command/qqbot-command-engine.service';
import { QqbotCommandLog } from '@/modules/qqbot/core/command/qqbot-command-log.entity';
import { QqbotCommandParserService } from '@/modules/qqbot/core/command/qqbot-command-parser.service';
import { QqbotCommandService } from '@/modules/qqbot/core/command/qqbot-command.service';
import { QqbotReplyTemplateService } from '@/modules/qqbot/core/command/qqbot-reply-template.service';
import { QqbotReverseWsService } from '@/modules/qqbot/core/connection/qqbot-reverse-ws.service';
import { QqbotConfig } from '@/modules/qqbot/core/config/qqbot-config.entity';
import { QqbotConfigService } from '@/modules/qqbot/core/config/qqbot-config.service';
import { QqbotDashboardController } from '@/modules/qqbot/core/dashboard/qqbot-dashboard.controller';
import { QqbotDashboardService } from '@/modules/qqbot/core/dashboard/qqbot-dashboard.service';
import { QqbotDedupe } from '@/modules/qqbot/core/dedupe/qqbot-dedupe.entity';
import { QqbotDedupeService } from '@/modules/qqbot/core/dedupe/qqbot-dedupe.service';
import { QqbotEventService } from '@/modules/qqbot/core/event/qqbot-event.service';
import { QqbotPluginHttpClientService } from '@/modules/qqbot/plugin-platform/sdk';
import { NapcatDeviceIdentity } from '@/modules/qqbot/napcat/device/napcat-device-identity.entity';
import { NapcatDeviceIdentityService } from '@/modules/qqbot/napcat/device/napcat-device-identity.service';
import { QqbotConversation } from '@/modules/qqbot/core/message/qqbot-conversation.entity';
import { QqbotMessageController } from '@/modules/qqbot/core/message/qqbot-message.controller';
import { QqbotMessage } from '@/modules/qqbot/core/message/qqbot-message.entity';
import { QqbotMessageService } from '@/modules/qqbot/core/message/qqbot-message.service';
import { QqbotBusService } from '@/modules/qqbot/core/mqtt/qqbot-bus.service';
import { QqbotAccountNapcat } from '@/modules/qqbot/napcat/infrastructure/persistence/qqbot-account-napcat.entity';
import { QqbotNapcatContainer } from '@/modules/qqbot/napcat/infrastructure/persistence/qqbot-napcat-container.entity';
import { QqbotNapcatContainerService } from '@/modules/qqbot/napcat/qqbot-napcat-container.service';
import { QqbotAllowlist } from '@/modules/qqbot/core/permission/qqbot-allowlist.entity';
import { QqbotBlocklist } from '@/modules/qqbot/core/permission/qqbot-blocklist.entity';
import { QqbotPermissionController } from '@/modules/qqbot/core/permission/qqbot-permission.controller';
import { QqbotPermissionService } from '@/modules/qqbot/core/permission/qqbot-permission.service';
import { QqbotPluginController } from '@/modules/qqbot/plugin-platform/qqbot-plugin.controller';
import { QqbotEventPluginRegistryService } from '@/modules/qqbot/plugin-platform/registry/qqbot-event-plugin-registry.service';
import { QqbotPluginRegistryService } from '@/modules/qqbot/plugin-platform/registry/qqbot-plugin-registry.service';
import { QqbotBangDreamClientService } from '@/modules/qqbot/plugins/bangDream/application/bangdream-client.service';
import { TsuguApplicationService } from '@/modules/qqbot/plugins/bangDream/application/bangdream-application.service';
import { QqbotBangDreamRendererService } from '@/modules/qqbot/plugins/bangDream/application/bangdream-renderer.facade';
import { QqbotBangDreamPluginService } from '@/modules/qqbot/plugins/bangDream/qqbot-bangdream.plugin';
import { QqbotFf14ClientService } from '@/modules/qqbot/plugins/ff14Market/qqbot-ff14-client.service';
import { QqbotFf14MarketPluginService } from '@/modules/qqbot/plugins/ff14Market/qqbot-ff14-market.plugin';
import { QqbotFflogsClientService } from '@/modules/qqbot/plugins/fflogs/qqbot-fflogs-client.service';
import { QqbotFflogsPluginService } from '@/modules/qqbot/plugins/fflogs/qqbot-fflogs.plugin';
import { QqbotRepeaterPluginService } from '@/modules/qqbot/plugins/repeater/qqbot-repeater.plugin';
import { QqbotRuleController } from '@/modules/qqbot/core/rule/qqbot-rule.controller';
import { QqbotRule } from '@/modules/qqbot/core/rule/qqbot-rule.entity';
import { QqbotRuleEngineService } from '@/modules/qqbot/core/rule/qqbot-rule-engine.service';
import { QqbotRuleService } from '@/modules/qqbot/core/rule/qqbot-rule.service';
import { QqbotRateLimitService } from '@/modules/qqbot/core/send/qqbot-rate-limit.service';
import { QqbotSendController } from '@/modules/qqbot/core/send/qqbot-send.controller';
import { QqbotSendLog } from '@/modules/qqbot/core/send/qqbot-send-log.entity';
import { QqbotSendService } from '@/modules/qqbot/core/send/qqbot-send.service';

export { QQBOT_CORE_DOMAIN_CONTRACT } from './qqbot-core.contract';

export const QQBOT_CORE_ENTITIES = [
  QqbotAccount,
  QqbotAccountAbility,
  QqbotAllowlist,
  QqbotBlocklist,
  QqbotCommand,
  QqbotCommandLog,
  QqbotConfig,
  QqbotConversation,
  QqbotDedupe,
  QqbotMessage,
  NapcatDeviceIdentity,
  QqbotAccountNapcat,
  QqbotNapcatContainer,
  QqbotRule,
  QqbotSendLog,
];

export const QQBOT_CORE_CONTROLLERS = [
  QqbotAccountController,
  QqbotCommandController,
  QqbotDashboardController,
  QqbotMessageController,
  QqbotPermissionController,
  QqbotPluginController,
  QqbotRuleController,
  QqbotSendController,
];

export const QQBOT_CORE_PROVIDERS = [
  QqbotAccountService,
  QqbotBusService,
  QqbotCommandEngineService,
  QqbotCommandParserService,
  QqbotCommandService,
  QqbotConfigService,
  QqbotDashboardService,
  QqbotDedupeService,
  QqbotEventService,
  QqbotPluginHttpClientService,
  QqbotBangDreamClientService,
  QqbotBangDreamPluginService,
  QqbotBangDreamRendererService,
  TsuguApplicationService,
  QqbotFf14ClientService,
  QqbotFf14MarketPluginService,
  QqbotFflogsClientService,
  QqbotFflogsPluginService,
  QqbotMessageService,
  NapcatDeviceIdentityService,
  QqbotNapcatLoginService,
  QqbotNapcatWatchdogService,
  QqbotNapcatContainerService,
  QqbotPermissionService,
  QqbotEventPluginRegistryService,
  QqbotPluginRegistryService,
  QqbotRepeaterPluginService,
  QqbotRateLimitService,
  QqbotReplyTemplateService,
  QqbotReverseWsService,
  QqbotRuleEngineService,
  QqbotRuleService,
  QqbotSendService,
];

export const QQBOT_CORE_EXPORTS = [
  QqbotAccountService,
  NapcatDeviceIdentityService,
  QqbotNapcatLoginService,
  QqbotNapcatContainerService,
  QqbotReverseWsService,
];

@Module({
  imports: [
    ConfigModule,
    AdminAuthGuardModule,
    DictModule,
    TypeOrmModule.forFeature(QQBOT_CORE_ENTITIES),
  ],
  controllers: QQBOT_CORE_CONTROLLERS,
  providers: QQBOT_CORE_PROVIDERS,
  exports: QQBOT_CORE_EXPORTS,
})
export class QqbotCoreModule {}
