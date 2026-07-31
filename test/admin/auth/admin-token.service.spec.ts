import { createHmac } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { AdminTokenService } from '../../../src/modules/admin/identity/auth/admin-token.service';

describe('AdminTokenService refresh token identity', () => {
  const secret = 'unit-test-admin-token-secret';
  const service = new AdminTokenService(
    new ConfigService({ ADMIN_TOKEN_SECRET: secret }),
  );

  it('issues unique refresh token ids inside one independent session family', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const user = { id: 'user-42', username: 'admin' };
    const sessionId = service.createRefreshSessionId();

    const first = service.signRefreshToken(user, sessionId);
    const second = service.signRefreshToken(user, sessionId);

    expect(first).not.toBe(second);
    expect(sessionId).toMatch(/^[a-f0-9]{32}$/);
    expect(service.verifyRefreshToken(first)).toMatchObject({
      jti: expect.stringMatching(/^[a-f0-9]{32}$/),
      sid: sessionId,
      sub: 'user-42',
      type: 'refresh',
      username: 'admin',
    });
    expect(service.verifyRefreshToken(second)).toMatchObject({
      jti: expect.stringMatching(/^[a-f0-9]{32}$/),
      sid: sessionId,
    });
    expect(service.verifyRefreshToken(first)?.jti).not.toBe(
      service.verifyRefreshToken(second)?.jti,
    );
    now.mockRestore();
  });

  it('rejects a signed legacy refresh token without sid and jti', () => {
    const issuedAt = Math.floor(Date.now() / 1000);
    const encodedPayload = Buffer.from(
      JSON.stringify({
        exp: issuedAt + 3600,
        iat: issuedAt,
        sub: 'user-42',
        type: 'refresh',
        username: 'admin',
      }),
    ).toString('base64url');
    const signature = createHmac('sha256', secret)
      .update(encodedPayload)
      .digest('base64url');

    expect(
      service.verifyRefreshToken(`${encodedPayload}.${signature}`),
    ).toBeNull();
  });
});
