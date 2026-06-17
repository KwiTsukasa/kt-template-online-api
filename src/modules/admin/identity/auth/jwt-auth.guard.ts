import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminAuthService } from './admin-auth.service';
import { IS_PUBLIC_KEY } from '@/common';
import type { AdminRequest } from '../../contract/admin.types';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  /**
   * 初始化 JwtAuthGuard 实例。
   * @param authService - authService 服务依赖；影响 constructor 的返回值。
   * @param reflector - Nest Reflector 实例；影响 constructor 的返回值。
   */
  constructor(
    private readonly authService: AdminAuthService,
    private readonly reflector: Reflector,
  ) {}

  /**
   * 判断 Admin 身份权限条件。
   * @param context - context 输入；执行 `context.getHandler()`、`context.getClass()`、`context.switchToHttp()` 对应的 Admin步骤。
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
      Array.isArray(authorization) ? authorization[0] : authorization,
      request,
    );
    return true;
  }
}
