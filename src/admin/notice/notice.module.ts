import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SYSTEM_NOTICE_PUBLISHER } from '@/common';
import { AdminNoticeController } from './admin-notice.controller';
import { AdminNotice } from './admin-notice.entity';
import { AdminNoticeService } from './admin-notice.service';
import { AdminAuthGuardModule } from '../auth/admin-auth-guard.module';

@Global()
@Module({
  imports: [AdminAuthGuardModule, TypeOrmModule.forFeature([AdminNotice])],
  controllers: [AdminNoticeController],
  providers: [
    AdminNoticeService,
    {
      provide: SYSTEM_NOTICE_PUBLISHER,
      useExisting: AdminNoticeService,
    },
  ],
  exports: [AdminNoticeService, SYSTEM_NOTICE_PUBLISHER],
})
export class NoticeModule {}
