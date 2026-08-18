import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SYSTEM_NOTICE_PUBLISHER } from '@/common';
import { MessageManagementModule } from '@/modules/message-management/message-management.module';
import { AdminNoticeController } from './admin-notice.controller';
import { AdminNotice } from './admin-notice.entity';
import { AdminNoticeEventStreamService } from './admin-notice-event-stream.service';
import { AdminNoticeService } from './admin-notice.service';
import { AdminAuthGuardModule } from '@/modules/admin/identity/auth/admin-auth-guard.module';
import { StationNoticeMessageBindingController } from './station-notice-message-binding.controller';
import { StationNoticeMessageBinding } from './station-notice-message-binding.entity';
import { StationNoticeMessageBindingService } from './station-notice-message-binding.service';
import { StationNoticeMessageSubscriberAdapter } from './station-notice-message-subscriber.adapter';

@Global()
@Module({
  imports: [
    AdminAuthGuardModule,
    MessageManagementModule,
    TypeOrmModule.forFeature([AdminNotice, StationNoticeMessageBinding]),
  ],
  controllers: [AdminNoticeController, StationNoticeMessageBindingController],
  providers: [
    AdminNoticeEventStreamService,
    AdminNoticeService,
    StationNoticeMessageBindingService,
    StationNoticeMessageSubscriberAdapter,
    {
      provide: SYSTEM_NOTICE_PUBLISHER,
      useExisting: AdminNoticeService,
    },
  ],
  exports: [
    AdminNoticeEventStreamService,
    AdminNoticeService,
    StationNoticeMessageBindingService,
    StationNoticeMessageSubscriberAdapter,
    SYSTEM_NOTICE_PUBLISHER,
  ],
})
export class NoticeModule {}
