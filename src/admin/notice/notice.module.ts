import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminNoticeController } from './admin-notice.controller';
import { AdminNotice } from './admin-notice.entity';
import { AdminNoticeService } from './admin-notice.service';
import { AdminAuthGuardModule } from '../auth/admin-auth-guard.module';

@Module({
  imports: [AdminAuthGuardModule, TypeOrmModule.forFeature([AdminNotice])],
  controllers: [AdminNoticeController],
  providers: [AdminNoticeService],
})
export class NoticeModule {}
