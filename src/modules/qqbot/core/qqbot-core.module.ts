import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthGuardModule } from '@/modules/admin/identity/auth/admin-auth-guard.module';
import { DictModule } from '@/modules/admin/platform-config/dict/dict.module';
import { QqbotNapcatModule } from '@/modules/qqbot/napcat/qqbot-napcat.module';
import { QqbotPluginPlatformModule } from '@/modules/qqbot/plugin-platform/plugin-platform.module';
import { QqbotAccountAbility } from '@/modules/qqbot/core/infrastructure/persistence/account/qqbot-account-ability.entity';
import { QqbotAccountController } from '@/modules/qqbot/core/contract/account/qqbot-account.controller';
import { QqbotAccount } from '@/modules/qqbot/core/infrastructure/persistence/account/qqbot-account.entity';
import { QqbotAccountService } from '@/modules/qqbot/core/application/account/qqbot-account.service';
import { QqbotCommandController } from '@/modules/qqbot/core/contract/command/qqbot-command.controller';
import { QqbotCommand } from '@/modules/qqbot/core/infrastructure/persistence/command/qqbot-command.entity';
import { QqbotCommandEngineService } from '@/modules/qqbot/core/application/command/qqbot-command-engine.service';
import { QqbotCommandLog } from '@/modules/qqbot/core/infrastructure/persistence/command/qqbot-command-log.entity';
import { QqbotCommandParserService } from '@/modules/qqbot/core/application/command/qqbot-command-parser.service';
import { QqbotCommandService } from '@/modules/qqbot/core/application/command/qqbot-command.service';
import { QqbotReplyTemplateService } from '@/modules/qqbot/core/application/command/qqbot-reply-template.service';
import { QqbotReverseWsService } from '@/modules/qqbot/core/infrastructure/integration/connection/qqbot-reverse-ws.service';
import { QqbotConfig } from '@/modules/qqbot/core/infrastructure/persistence/config/qqbot-config.entity';
import { QqbotConfigService } from '@/modules/qqbot/core/application/config/qqbot-config.service';
import { QqbotDashboardController } from '@/modules/qqbot/core/contract/dashboard/qqbot-dashboard.controller';
import { QqbotDashboardService } from '@/modules/qqbot/core/application/dashboard/qqbot-dashboard.service';
import { QqbotDedupe } from '@/modules/qqbot/core/infrastructure/persistence/dedupe/qqbot-dedupe.entity';
import { QqbotDedupeService } from '@/modules/qqbot/core/application/dedupe/qqbot-dedupe.service';
import { QqbotEventService } from '@/modules/qqbot/core/application/event/qqbot-event.service';
import { QqbotConversation } from '@/modules/qqbot/core/infrastructure/persistence/message/qqbot-conversation.entity';
import { QqbotMessageController } from '@/modules/qqbot/core/contract/message/qqbot-message.controller';
import { QqbotMessage } from '@/modules/qqbot/core/infrastructure/persistence/message/qqbot-message.entity';
import { QqbotMessageService } from '@/modules/qqbot/core/application/message/qqbot-message.service';
import { QqbotBusService } from '@/modules/qqbot/core/infrastructure/integration/bus/qqbot-bus.service';
import { QqbotAllowlist } from '@/modules/qqbot/core/infrastructure/persistence/permission/qqbot-allowlist.entity';
import { QqbotBlocklist } from '@/modules/qqbot/core/infrastructure/persistence/permission/qqbot-blocklist.entity';
import { QqbotPermissionController } from '@/modules/qqbot/core/contract/permission/qqbot-permission.controller';
import { QqbotPermissionService } from '@/modules/qqbot/core/application/permission/qqbot-permission.service';
import { QqbotRuleController } from '@/modules/qqbot/core/contract/rule/qqbot-rule.controller';
import { QqbotRule } from '@/modules/qqbot/core/infrastructure/persistence/rule/qqbot-rule.entity';
import { QqbotRuleEngineService } from '@/modules/qqbot/core/application/rule/qqbot-rule-engine.service';
import { QqbotRuleService } from '@/modules/qqbot/core/application/rule/qqbot-rule.service';
import { QqbotRateLimitService } from '@/modules/qqbot/core/application/send/qqbot-rate-limit.service';
import { QqbotSendController } from '@/modules/qqbot/core/contract/send/qqbot-send.controller';
import { QqbotSendLog } from '@/modules/qqbot/core/infrastructure/persistence/send/qqbot-send-log.entity';
import { QqbotSendService } from '@/modules/qqbot/core/application/send/qqbot-send.service';
import { QqbotMessageDelivery } from '@/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-delivery.entity';
import { QqbotMessageEvent } from '@/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-event.entity';
import { QqbotMessagePublishBinding } from '@/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-publish-binding.entity';
import { QqbotMessagePublishTarget } from '@/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-publish-target.entity';
import { QqbotMessageSubscription } from '@/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-subscription.entity';
import { QqbotMessageTemplate } from '@/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-template.entity';
import { SystemMessageSourceRegistry } from './application/message-push/system-message-source.registry';
import { SystemMessageEventStagerService } from './application/message-push/system-message-event-stager.service';
import { SystemMessageTemplateRendererService } from './application/message-push/system-message-template-renderer.service';
import { QqbotMessageSubscriptionService } from './application/message-push/qqbot-message-subscription.service';
import { QqbotMessageTemplateService } from './application/message-push/qqbot-message-template.service';
import { QqbotAccountMessagePushService } from './application/message-push/qqbot-account-message-push.service';
import { QqbotMessageTargetOptionsService } from './application/message-push/qqbot-message-target-options.service';
import { SYSTEM_MESSAGE_EVENT_STAGER } from './contract/message-push/qqbot-message-push.types';

export { QQBOT_CORE_DOMAIN_CONTRACT } from './contract/qqbot-core.contract';

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
  QqbotMessageDelivery,
  QqbotMessageEvent,
  QqbotMessagePublishBinding,
  QqbotMessagePublishTarget,
  QqbotMessageSubscription,
  QqbotMessageTemplate,
  QqbotRule,
  QqbotSendLog,
];

export const QQBOT_CORE_CONTROLLERS = [
  QqbotAccountController,
  QqbotCommandController,
  QqbotDashboardController,
  QqbotMessageController,
  QqbotPermissionController,
  QqbotRuleController,
  QqbotSendController,
];

export const QQBOT_CORE_PROVIDERS = [
  SystemMessageSourceRegistry,
  SystemMessageEventStagerService,
  {
    provide: SYSTEM_MESSAGE_EVENT_STAGER,
    useExisting: SystemMessageEventStagerService,
  },
  SystemMessageTemplateRendererService,
  QqbotMessageSubscriptionService,
  QqbotMessageTemplateService,
  QqbotAccountMessagePushService,
  QqbotMessageTargetOptionsService,
  QqbotAccountService,
  QqbotBusService,
  QqbotCommandEngineService,
  QqbotCommandParserService,
  QqbotCommandService,
  QqbotConfigService,
  QqbotDashboardService,
  QqbotDedupeService,
  QqbotEventService,
  QqbotMessageService,
  QqbotPermissionService,
  QqbotRateLimitService,
  QqbotReplyTemplateService,
  QqbotReverseWsService,
  QqbotRuleEngineService,
  QqbotRuleService,
  QqbotSendService,
];

export const QQBOT_CORE_EXPORTS = [
  SYSTEM_MESSAGE_EVENT_STAGER,
  SystemMessageSourceRegistry,
  SystemMessageTemplateRendererService,
  QqbotMessageSubscriptionService,
  QqbotMessageTemplateService,
  QqbotAccountMessagePushService,
  QqbotMessageTargetOptionsService,
  QqbotAccountService,
  QqbotConfigService,
  QqbotDashboardService,
  QqbotSendService,
  QqbotReverseWsService,
];

@Module({
  imports: [
    ConfigModule,
    AdminAuthGuardModule,
    DictModule,
    forwardRef(() => QqbotNapcatModule),
    forwardRef(() => QqbotPluginPlatformModule),
    TypeOrmModule.forFeature(QQBOT_CORE_ENTITIES),
  ],
  controllers: QQBOT_CORE_CONTROLLERS,
  providers: QQBOT_CORE_PROVIDERS,
  exports: QQBOT_CORE_EXPORTS,
})
export class QqbotCoreModule {}
