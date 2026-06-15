import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthGuardModule } from '@/modules/admin/identity/auth/admin-auth-guard.module';
import { AdminAuthController } from '@/modules/admin/identity/auth/admin-auth.controller';
import { AdminDeptController } from '@/modules/admin/identity/dept/admin-dept.controller';
import { AdminDept } from '@/modules/admin/identity/dept/admin-dept.entity';
import { AdminDeptService } from '@/modules/admin/identity/dept/admin-dept.service';
import { AdminMenuController } from '@/modules/admin/identity/menu/admin-menu.controller';
import { AdminMenu } from '@/modules/admin/identity/menu/admin-menu.entity';
import { AdminMenuService } from '@/modules/admin/identity/menu/admin-menu.service';
import { AdminRoleController } from '@/modules/admin/identity/role/admin-role.controller';
import { AdminRole } from '@/modules/admin/identity/role/admin-role.entity';
import { AdminRoleService } from '@/modules/admin/identity/role/admin-role.service';
import { AdminUserManageController } from '@/modules/admin/identity/user/admin-user-manage.controller';
import { AdminUserController } from '@/modules/admin/identity/user/admin-user.controller';
import { AdminUser } from '@/modules/admin/identity/user/admin-user.entity';
import { AdminUserService } from '@/modules/admin/identity/user/admin-user.service';
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
