import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { throwVbenError } from '@/common';
import type { AdminRequest } from '@/modules/admin/contract/admin.types';

@Injectable()
export class AdminSuperGuard implements CanActivate {
  /**
   * 根据`context`与当前约束判定Activate；从 `getRequest` 读取Activate。
   * @param context - 用于Activate的领域对象，包含 `switchToHttp` 字段。
   * @returns 满足Activate约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const roles = request.adminUser?.roles || [];
    const isSuper = roles.some(
      (role) =>
        !role.isDeleted && role.status === 1 && role.roleCode === 'super',
    );

    if (!isSuper) {
      throwVbenError('Forbidden Exception', HttpStatus.FORBIDDEN);
    }

    return true;
  }
}
