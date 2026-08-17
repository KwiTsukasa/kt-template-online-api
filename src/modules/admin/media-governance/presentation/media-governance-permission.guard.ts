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

export const MEDIA_GOVERNANCE_PERMISSION = 'media_governance_permission';

export const MediaGovernancePermission = (...authCodes: string[]) =>
  SetMetadata(MEDIA_GOVERNANCE_PERMISSION, authCodes);

@Injectable()
export class MediaGovernancePermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  /** 校验当前管理员是否具有任一媒体治理权限或超级角色。 */
  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      MEDIA_GOVERNANCE_PERMISSION,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) this.forbidden();

    const request = context.switchToHttp().getRequest<AdminRequest>();
    const activeRoles = (request.adminUser?.roles ?? []).filter(
      (role) => !role.isDeleted && role.status === 1,
    );
    if (activeRoles.some((role) => role.roleCode === 'super')) return true;

    const authCodes = new Set(
      activeRoles.flatMap((role) =>
        (role.menus ?? [])
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

  /** 以统一 Vben 错误格式拒绝未授权请求。 */
  private forbidden(): never {
    return throwVbenError('Forbidden Exception', HttpStatus.FORBIDDEN);
  }
}
