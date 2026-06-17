import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { throwVbenError } from '@/common';
import type { AdminRequest } from '../../contract/admin.types';

@Injectable()
export class AdminSuperGuard implements CanActivate {
  /**
   * 判断 Admin 身份权限条件。
   * @param context - context 输入；执行 `context.switchToHttp()` 对应的 Admin步骤。
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
