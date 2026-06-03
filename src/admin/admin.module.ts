import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthGuardModule } from './auth/admin-auth-guard.module';
import { AdminAuthController } from './auth/admin-auth.controller';
import { ComponentController } from './component/component.controller';
import { Component } from './component/component.entity';
import { ComponentService } from './component/component.service';
import { AdminDeptController } from './dept/admin-dept.controller';
import { AdminDept } from './dept/admin-dept.entity';
import { AdminDeptService } from './dept/admin-dept.service';
import { DictModule } from './dict/dict.module';
import { AdminExampleController } from './example/admin-example.controller';
import { AdminMenuController } from './menu/admin-menu.controller';
import { AdminMenu } from './menu/admin-menu.entity';
import { AdminMenuService } from './menu/admin-menu.service';
import { AdminRoleController } from './role/admin-role.controller';
import { AdminRole } from './role/admin-role.entity';
import { AdminRoleService } from './role/admin-role.service';
import { AdminTimezoneController } from './timezone/admin-timezone.controller';
import { AdminTimezoneService } from './timezone/admin-timezone.service';
import { AdminUserManageController } from './user/admin-user-manage.controller';
import { AdminUserController } from './user/admin-user.controller';
import { AdminUser } from './user/admin-user.entity';
import { AdminUserService } from './user/admin-user.service';
import { ToolsService } from '@/common';
import { MinioClientModule } from '@/minio/minio.module';
import { WordpressModule } from '@/wordpress/wordpress.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AdminUser,
      AdminRole,
      AdminMenu,
      AdminDept,
      Component,
    ]),
    AdminAuthGuardModule,
    DictModule,
    MinioClientModule,
    WordpressModule,
  ],
  controllers: [
    AdminAuthController,
    AdminUserController,
    AdminUserManageController,
    AdminMenuController,
    AdminRoleController,
    AdminDeptController,
    ComponentController,
    AdminTimezoneController,
    AdminExampleController,
  ],
  providers: [
    ComponentService,
    AdminDeptService,
    AdminMenuService,
    AdminRoleService,
    AdminTimezoneService,
    AdminUserService,
    ToolsService,
  ],
})
export class AdminModule {}
