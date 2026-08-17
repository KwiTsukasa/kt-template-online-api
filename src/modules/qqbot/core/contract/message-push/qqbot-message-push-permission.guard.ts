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
  constructor(private readonly reflector: Reflector) {}

  /**
   * 根据`context`与当前约束判定是否允许激活；从 `reflector.getAllAndOverride` 读取是否允许激活。
   * @param context - 用于是否允许激活的领域对象，包含 `getHandler`、`getClass`、`switchToHttp` 字段。
   * @returns 满足是否允许激活约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
   * 根据当前运行态处理输入约束并返回禁止的。
   * @returns 输入约束并返回禁止的。
   */
  private forbidden(): never {
    return throwVbenError('Forbidden Exception', HttpStatus.FORBIDDEN);
  }
}
