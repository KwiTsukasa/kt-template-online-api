import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthGuardModule } from '@/modules/admin/identity/auth/admin-auth-guard.module';
import { MessageSubscriberRegistry } from './application/subscriber/message-subscriber.registry';
import { MessageBindingProtocolService } from './application/message-binding-protocol.service';
import { MessageSubscriptionService } from './application/message-subscription.service';
import { MessageTemplateService } from './application/message-template.service';
import { SystemMessageDeliveryCoordinatorService } from './application/system-message-delivery-coordinator.service';
import { SystemMessageEventStagerService } from './application/system-message-event-stager.service';
import { SystemMessageFanoutService } from './application/system-message-fanout.service';
import { SystemMessageSourceRegistry } from './application/system-message-source.registry';
import { SystemMessageTemplateRendererService } from './application/system-message-template-renderer.service';
import { MessageManagementContractErrorInterceptor } from './contract/message-management-contract-error.interceptor';
import { MessageManagementPermissionGuard } from './contract/message-management-permission.guard';
import { MessageManagementController } from './contract/message-management.controller';
import {
  SYSTEM_MESSAGE_DELIVERY_COORDINATOR,
  SYSTEM_MESSAGE_EVENT_STAGER,
} from './contract/message-management.types';
import { MessageEvent } from './infrastructure/persistence/message-event.entity';
import { MessageSubscription } from './infrastructure/persistence/message-subscription.entity';
import { MessageSubscriptionTemplate } from './infrastructure/persistence/message-subscription-template.entity';
import { MessageTemplate } from './infrastructure/persistence/message-template.entity';

export const MESSAGE_MANAGEMENT_ENTITIES = [
  MessageEvent,
  MessageSubscription,
  MessageSubscriptionTemplate,
  MessageTemplate,
];

export const MESSAGE_MANAGEMENT_CONTROLLERS = [MessageManagementController];

export const MESSAGE_MANAGEMENT_PROVIDERS = [
  SystemMessageSourceRegistry,
  MessageSubscriberRegistry,
  SystemMessageEventStagerService,
  SystemMessageFanoutService,
  SystemMessageDeliveryCoordinatorService,
  {
    provide: SYSTEM_MESSAGE_EVENT_STAGER,
    useExisting: SystemMessageEventStagerService,
  },
  {
    provide: SYSTEM_MESSAGE_DELIVERY_COORDINATOR,
    useExisting: SystemMessageDeliveryCoordinatorService,
  },
  SystemMessageTemplateRendererService,
  MessageBindingProtocolService,
  MessageSubscriptionService,
  MessageTemplateService,
  MessageManagementPermissionGuard,
  MessageManagementContractErrorInterceptor,
];

export const MESSAGE_MANAGEMENT_EXPORTS = [
  SYSTEM_MESSAGE_EVENT_STAGER,
  SYSTEM_MESSAGE_DELIVERY_COORDINATOR,
  SystemMessageSourceRegistry,
  SystemMessageTemplateRendererService,
  MessageBindingProtocolService,
  MessageSubscriptionService,
  MessageTemplateService,
  MessageSubscriberRegistry,
  MessageManagementPermissionGuard,
  MessageManagementContractErrorInterceptor,
];

@Module({
  imports: [
    AdminAuthGuardModule,
    TypeOrmModule.forFeature(MESSAGE_MANAGEMENT_ENTITIES),
  ],
  controllers: MESSAGE_MANAGEMENT_CONTROLLERS,
  providers: MESSAGE_MANAGEMENT_PROVIDERS,
  exports: MESSAGE_MANAGEMENT_EXPORTS,
})
export class MessageManagementModule {}
