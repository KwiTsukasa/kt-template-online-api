import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AdminAccessTokenPayload,
  AdminRefreshTokenPayload,
  AdminTokenPayload,
} from '@/modules/admin/contract/admin.types';
import { requireSecureAdminTokenSecret } from '@/runtime/config/admin-token-secret.policy';

const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const TOKEN_ID_PATTERN = /^[a-f0-9]{32}$/;

@Injectable()
export class AdminTokenService {
  private readonly tokenSecret: string;

  constructor(configService: ConfigService) {
    this.tokenSecret = requireSecureAdminTokenSecret(
      configService.get<string>('ADMIN_TOKEN_SECRET'),
    );
  }

  /**
   * 根据`user`处理sign访问权限令牌。
   * @param user - 决定是否启用“用户”分支的布尔选项。
   * @returns sign访问权限令牌。
   */
  signAccessToken(user: { id: string; username: string }) {
    return this.sign(
      {
        sub: user.id,
        type: 'access',
        username: user.username,
      },
      7 * 24 * 60 * 60,
    );
  }

  /**
   * 通过 `toString` 收敛领域表示。
   * @param user - 决定是否启用“用户”分支的布尔选项。
   * @param sessionId - 用于精确定位会话的标识。
   * @returns sign刷新结果令牌。
   */
  signRefreshToken(user: { id: string; username: string }, sessionId: string) {
    return this.sign(
      {
        jti: randomBytes(16).toString('hex'),
        sid: sessionId,
        sub: user.id,
        type: 'refresh',
        username: user.username,
      },
      REFRESH_TOKEN_TTL_SECONDS,
    );
  }

  /**
   * 根据当前运行态构造刷新会话标识。
   * @returns 刷新会话标识。
   */
  createRefreshSessionId() {
    return randomBytes(16).toString('hex');
  }

  /**
   * 按当前运行态读取刷新令牌有效期（毫秒）。
   * @returns 刷新令牌有效期（毫秒）。
   */
  getRefreshTokenTtlMs() {
    return REFRESH_TOKEN_TTL_SECONDS * 1000;
  }

  /**
   * 按访问令牌类型验证签名与载荷，校验失败时返回 `null`。
   * @param token - 决定按访问令牌类型验证签名与载荷，校验失败时返回 `null`内容、边界或目标的 `token` 值。
   * @returns 按访问令牌类型验证签名与载荷，校验失败时返回 `null`。
   */
  verifyAccessToken(token: string): AdminAccessTokenPayload | null {
    return this.verify(token, 'access');
  }

  /**
   * 按刷新令牌类型验证签名与载荷，校验失败时返回 `null`。
   * @param token - 决定按刷新令牌类型验证签名与载荷，校验失败时返回 `null`内容、边界或目标的 `token` 值。
   * @returns 按刷新令牌类型验证签名与载荷，校验失败时返回 `null`。
   */
  verifyRefreshToken(token: string): AdminRefreshTokenPayload | null {
    return this.verify(token, 'refresh');
  }

  /**
   * 通过 `Math.floor` 收敛数值表示。
   * @param claims - 决定sign内容、边界或目标的 `claims` 值。
   * @param ttlSeconds - 决定sign内容、边界或目标的 `ttlSeconds` 值。
   * @returns 按参数编码并拼接完成的sign。
   */
  private sign(
    claims:
      | Omit<AdminAccessTokenPayload, 'exp' | 'iat'>
      | Omit<AdminRefreshTokenPayload, 'exp' | 'iat'>,
    ttlSeconds: number,
  ) {
    const now = Math.floor(Date.now() / 1000);
    const payload: AdminTokenPayload = {
      ...claims,
      exp: now + ttlSeconds,
      iat: now,
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
      'base64url',
    );
    const signature = this.signPayload(encodedPayload);
    return `${encodedPayload}.${signature}`;
  }

  /**
   * 校验`token`、`type`是否满足verify约束，并拒绝不合法输入；当 `payload.type === 'refresh' && (!TOKEN_ID_PATTERN.test(payload…` 成立时返回 `null`。
   * @param token - 决定verify内容、边界或目标的 `token` 值。
   * @param type - 决定verify内容、边界或目标的 `type` 值。
   * @returns verify；无法解析或未命中时为 `null`。
   */
  private verify<T extends AdminTokenPayload['type']>(
    token: string,
    type: T,
  ): Extract<AdminTokenPayload, { type: T }> | null {
    const [encodedPayload, signature] = token.split('.');
    if (!encodedPayload || !signature) return null;

    const expected = this.signPayload(encodedPayload);
    if (!this.safeEqual(signature, expected)) return null;

    try {
      const payload = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      ) as AdminTokenPayload;
      const now = Math.floor(Date.now() / 1000);
      if (payload.type !== type) return null;
      if (!Number.isInteger(payload.exp) || payload.exp <= now) return null;
      if (!Number.isInteger(payload.iat)) return null;
      if (typeof payload.sub !== 'string' || !payload.sub) return null;
      if (typeof payload.username !== 'string' || !payload.username)
        return null;
      if (
        payload.type === 'refresh' &&
        (!TOKEN_ID_PATTERN.test(payload.sid) ||
          !TOKEN_ID_PATTERN.test(payload.jti))
      ) {
        return null;
      }
      return payload as Extract<AdminTokenPayload, { type: T }>;
    } catch {
      return null;
    }
  }

  /**
   * 根据`payload`处理sign载荷；从 `configService.get` 读取sign载荷。
   * @param payload - 待按当前协议校验并路由的事件载荷。
   * @returns sign载荷。
   */
  private signPayload(payload: string) {
    return createHmac('sha256', this.tokenSecret)
      .update(payload)
      .digest('base64url');
  }

  /**
   * 根据`left`、`right`处理安全边界Equal。
   * @param left - 决定安全边界Equal内容、边界或目标的 `left` 值。
   * @param right - 决定安全边界Equal内容、边界或目标的 `right` 值。
   * @returns 安全边界Equal。
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
