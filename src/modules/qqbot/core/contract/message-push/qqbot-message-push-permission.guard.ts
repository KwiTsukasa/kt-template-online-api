import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { throwVbenError } from '@/common';
import type { AdminRequest } from '@/modules/admin/contract/admin.types';
import { QQBOT_MESSAGE_PUSH_PERMISSION } from './qqbot-message-push-permission.decorator';

@Injectable()
export class QqbotMessagePushPermissionGuard implements CanActivate {
  /**
   * Initializes the fail-closed route permission guard.
   * @param reflector - Nest metadata reader used for handler and controller permissions.
   */
  constructor(private readonly reflector: Reflector) {}

  /**
   * Allows an active super role or any exact active menu code declared by the route.
   * @param context - Current authenticated HTTP request execution context.
   * @returns `true` when the request's database-backed Admin roles grant the route.
   * @throws {HttpException} Vben-safe HTTP 403 for missing metadata, user, or permission.
   */
  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      QQBOT_MESSAGE_PUSH_PERMISSION,
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
   * Throws the project-standard non-sensitive authorization response.
   * @throws {HttpException} Always throws HTTP 403.
   */
  private forbidden(): never {
    return throwVbenError('Forbidden Exception', HttpStatus.FORBIDDEN);
  }
}
