import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { throwVbenError } from '@/common';
import type { AdminRequest } from '../../contract/admin.types';

@Injectable()
export class AdminSuperGuard implements CanActivate {
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
