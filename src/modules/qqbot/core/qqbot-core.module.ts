import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthGuardModule } from '@/admin/auth/admin-auth-guard.module';
import { DictModule } from '@/admin/dict/dict.module';
import { QqbotAccountAbility } from '@/qqbot/account/qqbot-account-ability.entity';
import { QqbotAccountController } from '@/qqbot/account/qqbot-account.controller';
import { QqbotAccount } from '@/qqbot/account/qqbot-account.entity';
import { QqbotAccountService } from '@/qqbot/account/qqbot-account.service';
import { QqbotNapcatLoginService } from '@/qqbot/account/qqbot-napcat-login.service';
import { QqbotNapcatWatchdogService } from '@/qqbot/account/qqbot-napcat-watchdog.service';
import { QqbotCommandController } from '@/qqbot/command/qqbot-command.controller';
import { QqbotCommand } from '@/qqbot/command/qqbot-command.entity';
import { QqbotCommandEngineService } from '@/qqbot/command/qqbot-command-engine.service';
import { QqbotCommandLog } from '@/qqbot/command/qqbot-command-log.entity';
import { QqbotCommandParserService } from '@/qqbot/command/qqbot-command-parser.service';
import { QqbotCommandService } from '@/qqbot/command/qqbot-command.service';
import { QqbotReplyTemplateService } from '@/qqbot/command/qqbot-reply-template.service';
import { QqbotReverseWsService } from '@/qqbot/connection/qqbot-reverse-ws.service';
import { QqbotConfig } from '@/qqbot/config/qqbot-config.entity';
import { QqbotConfigService } from '@/qqbot/config/qqbot-config.service';
import { QqbotDashboardController } from '@/qqbot/dashboard/qqbot-dashboard.controller';
import { QqbotDashboardService } from '@/qqbot/dashboard/qqbot-dashboard.service';
import { QqbotDedupe } from '@/qqbot/dedupe/qqbot-dedupe.entity';
import { QqbotDedupeService } from '@/qqbot/dedupe/qqbot-dedupe.service';
import { QqbotEventService } from '@/qqbot/event/qqbot-event.service';
import { QqbotPluginHttpClientService } from '@/modules/qqbot/plugin-platform/sdk';
import {
  NapcatDeviceIdentity,
  NapcatDeviceIdentityService,
} from '@/modules/qqbot/napcat';
import { QqbotConversation } from '@/qqbot/message/qqbot-conversation.entity';
import { QqbotMessageController } from '@/qqbot/message/qqbot-message.controller';
import { QqbotMessage } from '@/qqbot/message/qqbot-message.entity';
import { QqbotMessageService } from '@/qqbot/message/qqbot-message.service';
import { QqbotBusService } from '@/qqbot/mqtt/qqbot-bus.service';
import { QqbotAccountNapcat } from '@/qqbot/napcat/qqbot-account-napcat.entity';
import { QqbotNapcatContainer } from '@/qqbot/napcat/qqbot-napcat-container.entity';
import { QqbotNapcatContainerService } from '@/qqbot/napcat/qqbot-napcat-container.service';
import { QqbotAllowlist } from '@/qqbot/permission/qqbot-allowlist.entity';
import { QqbotBlocklist } from '@/qqbot/permission/qqbot-blocklist.entity';
import { QqbotPermissionController } from '@/qqbot/permission/qqbot-permission.controller';
import { QqbotPermissionService } from '@/qqbot/permission/qqbot-permission.service';
import { QqbotEventPluginRegistryService } from '@/qqbot/plugin/qqbot-event-plugin-registry.service';
import { QqbotPluginController } from '@/qqbot/plugin/qqbot-plugin.controller';
import { QqbotPluginRegistryService } from '@/qqbot/plugin/qqbot-plugin-registry.service';
import { QqbotBangDreamClientService } from '@/modules/qqbot/plugins/bangDream/application/bangdream-client.service';
import { TsuguApplicationService } from '@/modules/qqbot/plugins/bangDream/application/bangdream-application.service';
import { QqbotBangDreamRendererService } from '@/modules/qqbot/plugins/bangDream/application/bangdream-renderer.facade';
import { QqbotBangDreamPluginService } from '@/modules/qqbot/plugins/bangDream/qqbot-bangdream.plugin';
import { QqbotFf14ClientService } from '@/modules/qqbot/plugins/ff14Market/qqbot-ff14-client.service';
import { QqbotFf14MarketPluginService } from '@/modules/qqbot/plugins/ff14Market/qqbot-ff14-market.plugin';
import { QqbotFflogsClientService } from '@/modules/qqbot/plugins/fflogs/qqbot-fflogs-client.service';
import { QqbotFflogsPluginService } from '@/modules/qqbot/plugins/fflogs/qqbot-fflogs.plugin';
import { QqbotRepeaterPluginService } from '@/modules/qqbot/plugins/repeater/qqbot-repeater.plugin';
import { QqbotRuleController } from '@/qqbot/rule/qqbot-rule.controller';
import { QqbotRule } from '@/qqbot/rule/qqbot-rule.entity';
import { QqbotRuleEngineService } from '@/qqbot/rule/qqbot-rule-engine.service';
import { QqbotRuleService } from '@/qqbot/rule/qqbot-rule.service';
import { QqbotRateLimitService } from '@/qqbot/send/qqbot-rate-limit.service';
import { QqbotSendController } from '@/qqbot/send/qqbot-send.controller';
import { QqbotSendLog } from '@/qqbot/send/qqbot-send-log.entity';
import { QqbotSendService } from '@/qqbot/send/qqbot-send.service';

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
