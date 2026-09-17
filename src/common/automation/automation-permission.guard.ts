import { requireAuthorized } from '@/common/automation/validation';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AdminRequest } from '@/modules/admin/contract/admin.types';

export const AutomationResource = (resource: string) =>
  SetMetadata('automation-resource', resource);
export const AutomationAction = (action: string) =>
  SetMetadata('automation-action', action);

@Injectable()
export class AutomationPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  /**
   * 以当前资源和操作组成显式权限码，只接受活动角色和活动菜单赋予的权限。
   * @param context - 已由 JWT 守卫绑定管理员身份的请求上下文。
   * @returns 当前管理员具有本资源操作权限时放行。
   * @throws 缺少身份、路由权限声明或活动授权时返回 HTTP 403。
   */
  canActivate(context: ExecutionContext): boolean {
    const resource = this.reflector.get<string>(
      'automation-resource',
      context.getClass(),
    );
    const action = this.reflector.getAllAndOverride<string>(
      'automation-action',
      [context.getHandler(), context.getClass()],
    );
    requireAuthorized(resource && action, '自动化接口缺少权限声明');
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const roles = (request.adminUser?.roles || []).filter(
      (role) => !role.isDeleted && role.status === 1,
    );
    if (roles.some((role) => role.roleCode === 'super')) return true;
    const required = `Automation:${resource}:${action}`;
    if (
      roles.some((role) =>
        (role.menus || []).some(
          (menu) =>
            !menu.isDeleted && menu.status === 1 && menu.authCode === required,
        ),
      )
    )
      return true;
    throw new ForbiddenException('没有此自动化资源的操作权限');
  }
}
