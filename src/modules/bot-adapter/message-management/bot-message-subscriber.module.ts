import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthGuardModule } from '@/modules/admin/identity/auth/admin-auth-guard.module';
import { MessageManagementModule } from '@/modules/message-management/message-management.module';
import { BotAdapterCoreModule } from '@/modules/bot-adapter/core/bot-adapter-core.module';
import { BotAccountMessagePushController } from './bot-account-message-push.controller';
import { BotAccountMessagePushService } from './bot-account-message-push.service';
import { BotMessageSubscriberAdapter } from './bot-message-subscriber.adapter';
import { BotMessageDelivery } from './bot-message-delivery.entity';
import { SystemMessageDeliveryRunnerService } from './bot-message-delivery-runner.service';
import { BotMessagePublishBinding } from './bot-message-publish-binding.entity';
import { BotMessagePublishTarget } from './bot-message-publish-target.entity';
import { BotMessageTargetOptionsService } from './bot-message-target-options.service';

export const BOT_MESSAGE_SUBSCRIBER_ENTITIES = [
  BotMessageDelivery,
  BotMessagePublishBinding,
  BotMessagePublishTarget,
];

@Module({
  imports: [
    AdminAuthGuardModule,
    MessageManagementModule,
    BotAdapterCoreModule,
    TypeOrmModule.forFeature(BOT_MESSAGE_SUBSCRIBER_ENTITIES),
  ],
  controllers: [BotAccountMessagePushController],
  providers: [
    BotAccountMessagePushService,
    BotMessageSubscriberAdapter,
    BotMessageTargetOptionsService,
    SystemMessageDeliveryRunnerService,
  ],
  exports: [BotAccountMessagePushService, BotMessageSubscriberAdapter],
})
export class BotMessageSubscriberModule {}
