import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AdminUser } from '../user/admin-user.entity';
import { AdminAuthService } from './admin-auth.service';
import { IS_PUBLIC_KEY } from '@/common';

type AdminRequest = Request & {
  adminUser?: AdminUser;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly authService: AdminAuthService,
    private readonly reflector: Reflector,
  ) {}

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
