import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminAuthService } from '@/modules/admin/identity/auth/application/admin-auth.service';
import { IS_PUBLIC_KEY } from '@/common';
import type { AdminRequest } from '@/modules/admin/contract/admin.types';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly authService: AdminAuthService,
    private readonly reflector: Reflector,
  ) {}

  /**
   * 根据`context`与当前约束判定Activate；从 `reflector.getAllAndOverride` 读取Activate。
   * @param context - 用于Activate的领域对象，包含 `getHandler`、`getClass`、`switchToHttp` 字段。
   * @returns 满足Activate约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AdminRequest>();
    const authorization = request.headers.authorization;
    request.adminUser = await this.authService.currentUser(
      (() => {
        if (Array.isArray(authorization)) {
          return authorization[0];
        }
        return authorization;
      })(),
      request,
    );
    return true;
  }
}
