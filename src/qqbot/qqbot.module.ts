import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthGuardModule } from '@/admin/auth/admin-auth-guard.module';
import { QqbotAccountController } from './account/qqbot-account.controller';
import { QqbotAccount } from './account/qqbot-account.entity';
import { QqbotAccountService } from './account/qqbot-account.service';
import { QqbotReverseWsService } from './connection/qqbot-reverse-ws.service';
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
import { QqbotAllowlist } from './permission/qqbot-allowlist.entity';
import { QqbotBlocklist } from './permission/qqbot-blocklist.entity';
import { QqbotPermissionController } from './permission/qqbot-permission.controller';
import { QqbotPermissionService } from './permission/qqbot-permission.service';
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
    TypeOrmModule.forFeature([
      QqbotAccount,
      QqbotAllowlist,
      QqbotBlocklist,
      QqbotConversation,
      QqbotDedupe,
      QqbotMessage,
      QqbotRule,
      QqbotSendLog,
    ]),
  ],
  controllers: [
    QqbotAccountController,
    QqbotDashboardController,
    QqbotMessageController,
    QqbotPermissionController,
    QqbotRuleController,
    QqbotSendController,
  ],
  providers: [
    QqbotAccountService,
    QqbotBusService,
    QqbotDashboardService,
    QqbotDedupeService,
    QqbotEventService,
    QqbotMessageService,
    QqbotPermissionService,
    QqbotRateLimitService,
    QqbotReverseWsService,
    QqbotRuleEngineService,
    QqbotRuleService,
    QqbotSendService,
  ],
  exports: [QqbotAccountService, QqbotReverseWsService],
})
export class QqbotModule {}
