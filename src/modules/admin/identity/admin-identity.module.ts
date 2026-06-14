import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthGuardModule } from '@/admin/auth/admin-auth-guard.module';
import { AdminAuthController } from '@/admin/auth/admin-auth.controller';
import { AdminDeptController } from '@/admin/dept/admin-dept.controller';
import { AdminDept } from '@/admin/dept/admin-dept.entity';
import { AdminDeptService } from '@/admin/dept/admin-dept.service';
import { AdminMenuController } from '@/admin/menu/admin-menu.controller';
import { AdminMenu } from '@/admin/menu/admin-menu.entity';
import { AdminMenuService } from '@/admin/menu/admin-menu.service';
import { AdminRoleController } from '@/admin/role/admin-role.controller';
import { AdminRole } from '@/admin/role/admin-role.entity';
import { AdminRoleService } from '@/admin/role/admin-role.service';
import { AdminUserManageController } from '@/admin/user/admin-user-manage.controller';
import { AdminUserController } from '@/admin/user/admin-user.controller';
import { AdminUser } from '@/admin/user/admin-user.entity';
import { AdminUserService } from '@/admin/user/admin-user.service';
import { WordpressMirrorModule } from '@/modules/wordpress/wordpress-mirror.module';

export const ADMIN_IDENTITY_CONTROLLERS = [
  AdminAuthController,
  AdminUserController,
  AdminUserManageController,
  AdminMenuController,
  AdminRoleController,
  AdminDeptController,
];

export const ADMIN_IDENTITY_PROVIDERS = [
  AdminUserService,
  AdminMenuService,
  AdminRoleService,
  AdminDeptService,
];

@Module({
  imports: [
    TypeOrmModule.forFeature([AdminUser, AdminRole, AdminMenu, AdminDept]),
    AdminAuthGuardModule,
    WordpressMirrorModule,
  ],
  controllers: ADMIN_IDENTITY_CONTROLLERS,
  providers: ADMIN_IDENTITY_PROVIDERS,
})
export class AdminIdentityModule {}
