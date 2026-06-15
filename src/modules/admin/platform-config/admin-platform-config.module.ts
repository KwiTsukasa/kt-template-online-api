import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthGuardModule } from '@/modules/admin/identity/auth/admin-auth-guard.module';
import { ComponentController } from '@/modules/admin/platform-config/component/component.controller';
import { Component } from '@/modules/admin/platform-config/component/component.entity';
import { ComponentService } from '@/modules/admin/platform-config/component/component.service';
import { DictController } from '@/modules/admin/platform-config/dict/dict.controller';
import { DictModule } from '@/modules/admin/platform-config/dict/dict.module';
import { AdminNoticeController } from '@/modules/admin/platform-config/notice/admin-notice.controller';
import { NoticeModule } from '@/modules/admin/platform-config/notice/notice.module';
import { SystemLogController } from '@/modules/admin/platform-config/system-log/system-log.controller';
import { SystemLogService } from '@/modules/admin/platform-config/system-log/system-log.service';
import { AdminTimezoneController } from '@/modules/admin/platform-config/timezone/admin-timezone.controller';
import { AdminTimezoneService } from '@/modules/admin/platform-config/timezone/admin-timezone.service';
import { AdminUser } from '@/modules/admin/identity/user/admin-user.entity';
import { AssetModule } from '@/modules/asset/asset.module';

export const ADMIN_PLATFORM_CONFIG_DIRECT_CONTROLLERS = [
  ComponentController,
  SystemLogController,
  AdminTimezoneController,
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
