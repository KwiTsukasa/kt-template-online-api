import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthGuardModule } from '@/modules/admin/identity/auth/admin-auth-guard.module';
import { MessageManagementModule } from '@/modules/message-management/message-management.module';
import { QqbotCoreModule } from '@/modules/qqbot/core/qqbot-core.module';
import { QqbotAccountMessagePushController } from './qqbot-account-message-push.controller';
import { QqbotAccountMessagePushService } from './qqbot-account-message-push.service';
import { QqbotMessageSubscriberAdapter } from './qqbot-message-subscriber.adapter';
import { QqbotMessageDelivery } from './qqbot-message-delivery.entity';
import { SystemMessageDeliveryRunnerService } from './qqbot-message-delivery-runner.service';
import { QqbotMessagePublishBinding } from './qqbot-message-publish-binding.entity';
import { QqbotMessagePublishTarget } from './qqbot-message-publish-target.entity';
import { QqbotMessageTargetOptionsService } from './qqbot-message-target-options.service';

export const QQBOT_MESSAGE_SUBSCRIBER_ENTITIES = [
  QqbotMessageDelivery,
  QqbotMessagePublishBinding,
  QqbotMessagePublishTarget,
];

@Module({
  imports: [
    AdminAuthGuardModule,
    MessageManagementModule,
    QqbotCoreModule,
    TypeOrmModule.forFeature(QQBOT_MESSAGE_SUBSCRIBER_ENTITIES),
  ],
  controllers: [QqbotAccountMessagePushController],
  providers: [
    QqbotAccountMessagePushService,
    QqbotMessageSubscriberAdapter,
    QqbotMessageTargetOptionsService,
    SystemMessageDeliveryRunnerService,
  ],
  exports: [QqbotAccountMessagePushService, QqbotMessageSubscriberAdapter],
})
export class QqbotMessageSubscriberModule {}
