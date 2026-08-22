import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { throwVbenError } from '@/common';
import type { AdminRequest } from '@/modules/admin/contract/admin.types';

export const PLUGIN_PLATFORM_PERMISSION = 'plugin_platform_permission';

export const PluginPlatformPermission = (...authCodes: string[]) =>
  SetMetadata(PLUGIN_PLATFORM_PERMISSION, authCodes);

@Injectable()
export class PluginPlatformPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  /**
   * 仅允许超级管理员或持有任一显式插件平台权限的活动角色访问当前入口。
   * @param context - 提供路由元数据与当前 Admin 用户的 Nest 执行上下文。
   * @returns 权限命中时返回 `true`；缺少元数据、用户或权限时抛出禁止访问错误。
   */
  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      PLUGIN_PLATFORM_PERMISSION,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) this.forbidden();

    const request = context.switchToHttp().getRequest<AdminRequest>();
    const activeRoles = (request.adminUser?.roles || []).filter(
      (role) => !role.isDeleted && role.status === 1,
    );
    if (activeRoles.some((role) => role.roleCode === 'super')) return true;

    const authCodes = new Set(
      activeRoles.flatMap((role) =>
        (role.menus || [])
          .filter(
            (menu) =>
              !menu.isDeleted &&
              menu.status === 1 &&
              typeof menu.authCode === 'string' &&
              menu.authCode.length > 0,
          )
          .map((menu) => menu.authCode),
      ),
    );
    if (required.some((authCode) => authCodes.has(authCode))) return true;
    this.forbidden();
  }

  /**
   * 把插件平台权限拒绝统一映射为 Vben 可解析的 HTTP 403 响应。
   * @returns 该入口总是抛出异常，不返回普通值。
   */
  private forbidden(): never {
    return throwVbenError('Forbidden Exception', HttpStatus.FORBIDDEN);
  }
}
