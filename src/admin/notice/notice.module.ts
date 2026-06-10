import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminNoticeController } from './admin-notice.controller';
import { AdminNotice } from './admin-notice.entity';
import { AdminNoticeService } from './admin-notice.service';

@Module({
  imports: [TypeOrmModule.forFeature([AdminNotice])],
  controllers: [AdminNoticeController],
  providers: [AdminNoticeService],
})
export class NoticeModule {}

