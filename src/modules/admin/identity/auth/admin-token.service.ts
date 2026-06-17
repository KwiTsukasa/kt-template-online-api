import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import type { AdminTokenPayload } from '../../contract/admin.types';

@Injectable()
export class AdminTokenService {
  /**
   * 初始化 AdminTokenService 实例。
   * @param configService - Nest ConfigService 依赖；影响 constructor 的返回值。
   */
  constructor(private readonly configService: ConfigService) {}

  /**
   * 执行 Admin 身份权限流程。
   * @param user - user 输入；驱动 `this.sign()` 的 Admin步骤。
   */
  signAccessToken(user: { id: string; username: string }) {
    return this.sign(user, 'access', 7 * 24 * 60 * 60);
  }

  /**
   * 执行 Admin 身份权限流程。
   * @param user - user 输入；驱动 `this.sign()` 的 Admin步骤。
   */
  signRefreshToken(user: { id: string; username: string }) {
    return this.sign(user, 'refresh', 30 * 24 * 60 * 60);
  }

  /**
   * 执行 Admin 身份权限流程。
   * @param token - 协议 token；驱动 `this.verify()` 的 Admin步骤。
   * @returns Admin 身份权限产出的 AdminTokenPayload | null。
   */
  verifyAccessToken(token: string): AdminTokenPayload | null {
    return this.verify(token, 'access');
  }

  /**
   * 执行 Admin 身份权限流程。
   * @param token - 协议 token；驱动 `this.verify()` 的 Admin步骤。
   * @returns Admin 身份权限产出的 AdminTokenPayload | null。
   */
  verifyRefreshToken(token: string): AdminTokenPayload | null {
    return this.verify(token, 'refresh');
  }

  /**
   * 执行 Admin 身份权限流程。
   * @param user - user 输入；使用 `id`、`username` 字段生成结果。
   * @param type - type 输入；影响 sign 的返回值。
   * @param ttlSeconds - Admin列表；影响 sign 的返回值。
   */
  private sign(
    user: { id: string; username: string },
    type: AdminTokenPayload['type'],
    ttlSeconds: number,
  ) {
    const now = Math.floor(Date.now() / 1000);
    const payload: AdminTokenPayload = {
      exp: now + ttlSeconds,
      iat: now,
      sub: user.id,
      type,
      username: user.username,
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
      'base64url',
    );
    const signature = this.signPayload(encodedPayload);
    return `${encodedPayload}.${signature}`;
  }

  /**
   * 执行 Admin 身份权限流程。
   * @param token - 协议 token；生成规范化文本。
   * @param type - type 输入；决定 Admin条件分支。
   * @returns Admin 身份权限产出的 AdminTokenPayload | null。
   */
  private verify(
    token: string,
    type: AdminTokenPayload['type'],
  ): AdminTokenPayload | null {
    const [encodedPayload, signature] = token.split('.');
    if (!encodedPayload || !signature) return null;

    const expected = this.signPayload(encodedPayload);
    if (!this.safeEqual(signature, expected)) return null;

    try {
      const payload = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      ) as AdminTokenPayload;
      const now = Math.floor(Date.now() / 1000);
      if (payload.type !== type || payload.exp <= now) return null;
      return payload;
    } catch {
      return null;
    }
  }

  /**
   * 执行 Admin 身份权限流程。
   * @param payload - payload 输入；驱动 `createHmac()` 的 Admin步骤。
   */
  private signPayload(payload: string) {
    const secret =
      this.configService.get<string>('ADMIN_TOKEN_SECRET') ||
      'kt-template-online-admin-token-secret';
    return createHmac('sha256', secret).update(payload).digest('base64url');
  }

  /**
   * 执行 Admin 身份权限流程。
   * @param left - left 输入；驱动 `Buffer.from()` 的 Admin步骤。
   * @param right - right 输入；驱动 `Buffer.from()` 的 Admin步骤。
   */
  private safeEqual(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return (
      leftBuffer.length === rightBuffer.length &&
      timingSafeEqual(leftBuffer, rightBuffer)
    );
  }
}
