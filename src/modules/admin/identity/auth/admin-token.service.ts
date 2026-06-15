import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import type { AdminTokenPayload } from '../../contract/admin.types';

@Injectable()
export class AdminTokenService {
  constructor(private readonly configService: ConfigService) {}

  signAccessToken(user: { id: string; username: string }) {
    return this.sign(user, 'access', 7 * 24 * 60 * 60);
  }

  signRefreshToken(user: { id: string; username: string }) {
    return this.sign(user, 'refresh', 30 * 24 * 60 * 60);
  }

  verifyAccessToken(token: string): AdminTokenPayload | null {
    return this.verify(token, 'access');
  }

  verifyRefreshToken(token: string): AdminTokenPayload | null {
    return this.verify(token, 'refresh');
  }

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

  private signPayload(payload: string) {
    const secret =
      this.configService.get<string>('ADMIN_TOKEN_SECRET') ||
      'kt-template-online-admin-token-secret';
    return createHmac('sha256', secret).update(payload).digest('base64url');
  }

  private safeEqual(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return (
      leftBuffer.length === rightBuffer.length &&
      timingSafeEqual(leftBuffer, rightBuffer)
    );
  }
}
