import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { throwVbenError } from '../response/vben-response';
import { ClientIpService } from './client-ip.service';

const PROTECTED_POST_CREDENTIAL_PATHS = new Set([
  '/auth/login',
  '/auth/logout',
  '/auth/refresh',
  '/qqbot/account/save',
  '/qqbot/account/update',
  '/system/user',
]);
const PROTECTED_ADMIN_USER_PUT_PATH = /^\/system\/user\/[^/]+(?:\/password)?$/;
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', '[::1]', 'localhost']);
const LOOPBACK_PEERS = new Set(['127.0.0.1', '::1']);

@Injectable()
export class TrustedCredentialTransportService {
  constructor(
    private readonly clientIpService: ClientIpService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 通过在全局安全边界校验受保护凭据路由的传输协议。
   * @param request - 当前 HTTP 请求；提供路由和可信代理后的公开 Origin。
   */
  assertProtectedRequest(request: Request): void {
    if (!this.isProtectedRequest(request)) return;
    this.assertTrusted(request);
  }

  /**
   * 校验当前凭据操作是否使用可信 HTTPS 或显式本地开发例外。
   * @param request - 当前 HTTP 请求；提供可信代理后的公开 Origin 和真实 socket peer。
   */
  assertTrusted(request: Request): void {
    const publicOrigin = new URL(this.clientIpService.getPublicOrigin(request));
    if (publicOrigin.protocol === 'https:') return;
    if (this.isAllowedInsecureLocal(request, publicOrigin.hostname)) return;

    throwVbenError('凭据操作必须使用 HTTPS', HttpStatus.FORBIDDEN);
  }

  /**
   * 根据参数 `request`，判断请求是否命中固定的凭据写入路由。
   * @param request - 用于根据参数 `request`，判断请求是否命中固定的凭据写入路由的当前 HTTP 请求，包含 `method` 字段。
   * @returns 满足根据参数 `request`，判断请求是否命中固定的凭据写入路由约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isProtectedRequest(request: Request): boolean {
    const method = `${request.method || ''}`.toUpperCase();
    const path = this.getPath(request);
    if (method === 'POST') return PROTECTED_POST_CREDENTIAL_PATHS.has(path);
    return method === 'PUT' && PROTECTED_ADMIN_USER_PUT_PATH.test(path);
  }

  /**
   * 仅把非生产环境中的环回 HTTP 请求识别为受保护凭据路由的传输例外。
   * @param request - 用于仅把非生产环境中的环回 HTTP 请求识别为受保护凭据路由的传输例外的当前 HTTP 请求，包含 `socket` 字段。
   * @param hostname - 决定仅把非生产环境中的环回 HTTP 请求识别为受保护凭据路由的传输例外内容、边界或目标的 `hostname` 值。
   * @returns 满足仅把非生产环境中的环回 HTTP 请求识别为受保护凭据路由的传输例外约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isAllowedInsecureLocal(request: Request, hostname: string): boolean {
    return (
      this.configService.get<string>('NODE_ENV') !== 'production' &&
      `${this.configService.get('ADMIN_AUTH_ALLOW_INSECURE_LOCAL') || ''}`
        .trim()
        .toLowerCase() === 'true' &&
      LOOPBACK_HOSTNAMES.has(hostname) &&
      LOOPBACK_PEERS.has(
        this.clientIpService.normalizeIp(request.socket?.remoteAddress) || '',
      )
    );
  }

  /**
   * 提取实际 HTTP 路径并统一移除查询串和尾斜杠。
   * @param request - 用于提取实际 HTTP 路径并统一移除查询串和尾斜杠的当前 HTTP 请求，包含 `path`、`originalUrl`、`url` 字段。
   * @returns 提取实际 HTTP 路径并统一移除查询串和尾斜杠。
   */
  private getPath(request: Request): string {
    const raw = request.path || request.originalUrl || request.url || '/';
    const path = raw.split('?')[0] || '/';
    if (path.length > 1) {
      return path.replace(/\/+$/, '');
    }
    return path;
  }
}
