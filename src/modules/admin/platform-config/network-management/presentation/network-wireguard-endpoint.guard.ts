import { timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

@Injectable()
export class NetworkWireGuardEndpointGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  /**
   * 复用 PC Relay 共享密钥校验窄端点读取请求，不赋予 Admin 或其他管理权限。
   * @param context - 当前 Nest HTTP 执行上下文。
   * @returns 密钥逐字节匹配时返回 true。
   * @throws 密钥缺失、长度不足或不匹配时抛出 401。
   */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const expected = String(
      this.config.get('CODEX_REMOTE_PC_WS_SHARED_SECRET') || '',
    );
    const actual = String(request.header('x-kt-relay-secret') || '');
    const expectedBytes = Buffer.from(expected, 'utf8');
    const actualBytes = Buffer.from(actual, 'utf8');
    if (
      expectedBytes.length < 32 ||
      actualBytes.length !== expectedBytes.length ||
      !timingSafeEqual(actualBytes, expectedBytes)
    ) {
      throw new UnauthorizedException('Relay 身份校验失败');
    }
    return true;
  }
}
