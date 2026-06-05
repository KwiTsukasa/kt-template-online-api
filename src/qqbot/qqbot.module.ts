import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthGuardModule } from '@/admin/auth/admin-auth-guard.module';
import { DictModule } from '@/admin/dict/dict.module';
import { QqbotAccountController } from './account/qqbot-account.controller';
import { QqbotAccountAbility } from './account/qqbot-account-ability.entity';
import { QqbotAccount } from './account/qqbot-account.entity';
import { QqbotAccountService } from './account/qqbot-account.service';
import { QqbotNapcatLoginService } from './account/qqbot-napcat-login.service';
import { QqbotCommandController } from './command/qqbot-command.controller';
import { QqbotCommand } from './command/qqbot-command.entity';
import { QqbotCommandEngineService } from './command/qqbot-command-engine.service';
import { QqbotCommandLog } from './command/qqbot-command-log.entity';
import { QqbotCommandParserService } from './command/qqbot-command-parser.service';
import { QqbotCommandService } from './command/qqbot-command.service';
import { QqbotReplyTemplateService } from './command/qqbot-reply-template.service';
import { QqbotReverseWsService } from './connection/qqbot-reverse-ws.service';
import { QqbotConfig } from './config/qqbot-config.entity';
import { QqbotConfigService } from './config/qqbot-config.service';
import { QqbotDashboardController } from './dashboard/qqbot-dashboard.controller';
import { QqbotDashboardService } from './dashboard/qqbot-dashboard.service';
import { QqbotDedupe } from './dedupe/qqbot-dedupe.entity';
import { QqbotDedupeService } from './dedupe/qqbot-dedupe.service';
import { QqbotEventService } from './event/qqbot-event.service';
import { QqbotConversation } from './message/qqbot-conversation.entity';
import { QqbotMessageController } from './message/qqbot-message.controller';
import { QqbotMessage } from './message/qqbot-message.entity';
import { QqbotMessageService } from './message/qqbot-message.service';
import { QqbotBusService } from './mqtt/qqbot-bus.service';
import { QqbotAccountNapcat } from './napcat/qqbot-account-napcat.entity';
import { QqbotNapcatContainer } from './napcat/qqbot-napcat-container.entity';
import { QqbotNapcatContainerService } from './napcat/qqbot-napcat-container.service';
import { QqbotAllowlist } from './permission/qqbot-allowlist.entity';
import { QqbotBlocklist } from './permission/qqbot-blocklist.entity';
import { QqbotPermissionController } from './permission/qqbot-permission.controller';
import { QqbotPermissionService } from './permission/qqbot-permission.service';
import { QqbotEventPluginRegistryService } from './plugin/qqbot-event-plugin-registry.service';
import { QqbotPluginController } from './plugin/qqbot-plugin.controller';
import { QqbotPluginRegistryService } from './plugin/qqbot-plugin-registry.service';
import { QqbotBangDreamClientService } from './plugins/bangDream/qqbot-bangdream-client.service';
import { QqbotBangDreamPluginService } from './plugins/bangDream/qqbot-bangdream.plugin';
import { QqbotBangDreamRendererService } from './plugins/bangDream/renderer/qqbot-bangdream-renderer.service';
import { QqbotFf14ClientService } from './plugins/ff14Market/qqbot-ff14-client.service';
import { QqbotFf14MarketPluginService } from './plugins/ff14Market/qqbot-ff14-market.plugin';
import { QqbotFflogsClientService } from './plugins/fflogs/qqbot-fflogs-client.service';
import { QqbotFflogsPluginService } from './plugins/fflogs/qqbot-fflogs.plugin';
import { QqbotRepeaterPluginService } from './plugins/repeater/qqbot-repeater.plugin';
import { QqbotRuleController } from './rule/qqbot-rule.controller';
import { QqbotRule } from './rule/qqbot-rule.entity';
import { QqbotRuleEngineService } from './rule/qqbot-rule-engine.service';
import { QqbotRuleService } from './rule/qqbot-rule.service';
import { QqbotRateLimitService } from './send/qqbot-rate-limit.service';
import { QqbotSendController } from './send/qqbot-send.controller';
import { QqbotSendLog } from './send/qqbot-send-log.entity';
import { QqbotSendService } from './send/qqbot-send.service';

@Module({
  imports: [
    ConfigModule,
    AdminAuthGuardModule,
    DictModule,
    TypeOrmModule.forFeature([
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
      QqbotAccountNapcat,
      QqbotNapcatContainer,
      QqbotRule,
      QqbotSendLog,
    ]),
  ],
  controllers: [
    QqbotAccountController,
    QqbotCommandController,
    QqbotDashboardController,
    QqbotMessageController,
    QqbotPermissionController,
    QqbotPluginController,
    QqbotRuleController,
    QqbotSendController,
  ],
  providers: [
    QqbotAccountService,
    QqbotBusService,
    QqbotCommandEngineService,
    QqbotCommandParserService,
    QqbotCommandService,
    QqbotConfigService,
    QqbotDashboardService,
    QqbotDedupeService,
    QqbotEventService,
    QqbotBangDreamClientService,
    QqbotBangDreamPluginService,
    QqbotBangDreamRendererService,
    QqbotFf14ClientService,
    QqbotFf14MarketPluginService,
    QqbotFflogsClientService,
    QqbotFflogsPluginService,
    QqbotMessageService,
    QqbotNapcatLoginService,
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
  ],
  exports: [
    QqbotAccountService,
    QqbotNapcatLoginService,
    QqbotNapcatContainerService,
    QqbotReverseWsService,
  ],
})
export class QqbotModule {}
