import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthGuardModule } from '@/admin/auth/admin-auth-guard.module';
import { ComponentController } from '@/admin/component/component.controller';
import { Component } from '@/admin/component/component.entity';
import { ComponentService } from '@/admin/component/component.service';
import { DictController } from '@/admin/dict/dict.controller';
import { DictModule } from '@/admin/dict/dict.module';
import { AdminNoticeController } from '@/admin/notice/admin-notice.controller';
import { NoticeModule } from '@/admin/notice/notice.module';
import { SystemLogController } from '@/admin/system-log/system-log.controller';
import { SystemLogService } from '@/admin/system-log/system-log.service';
import { AdminTimezoneController } from '@/admin/timezone/admin-timezone.controller';
import { AdminTimezoneService } from '@/admin/timezone/admin-timezone.service';
import { AdminUser } from '@/admin/user/admin-user.entity';
import { AdminExampleController } from '@/admin/example/admin-example.controller';
import { AssetModule } from '@/modules/asset/asset.module';

export const ADMIN_PLATFORM_CONFIG_DIRECT_CONTROLLERS = [
  ComponentController,
  SystemLogController,
  AdminTimezoneController,
  AdminExampleController,
];

export const ADMIN_PLATFORM_CONFIG_IMPORTED_CONTROLLERS = [
  DictController,
  AdminNoticeController,
];

export const ADMIN_PLATFORM_CONFIG_CONTROLLERS = [
  ...ADMIN_PLATFORM_CONFIG_DIRECT_CONTROLLERS,
  ...ADMIN_PLATFORM_CONFIG_IMPORTED_CONTROLLERS,
];

export const ADMIN_PLATFORM_CONFIG_PROVIDERS = [
  ComponentService,
  SystemLogService,
  AdminTimezoneService,
];

@Module({
  imports: [
    TypeOrmModule.forFeature([Component, AdminUser]),
    AdminAuthGuardModule,
    DictModule,
    NoticeModule,
    AssetModule,
  ],
  controllers: ADMIN_PLATFORM_CONFIG_DIRECT_CONTROLLERS,
  providers: ADMIN_PLATFORM_CONFIG_PROVIDERS,
})
export class AdminPlatformConfigModule {}
