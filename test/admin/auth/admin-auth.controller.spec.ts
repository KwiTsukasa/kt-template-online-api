import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { ClientIpService } from '../../../src/common/security/client-ip.service';
import { TrustedCredentialTransportService } from '../../../src/common/security/trusted-credential-transport.service';
import { AdminAuthController } from '../../../src/modules/admin/identity/auth/presentation/admin-auth.controller';

type AuthEndpoint = 'login' | 'logout' | 'refresh';

function createRequest(input: {
  forwardedProto?: string;
  host?: string;
  remoteAddress: string;
}) {
  return {
    headers: {
      host: input.host || 'nas4.kwitsukasa.top:45231',
      'x-forwarded-port': input.host?.split(':').at(-1) || '45231',
      'x-forwarded-proto': input.forwardedProto,
    },
    socket: {
      encrypted: false,
      remoteAddress: input.remoteAddress,
    },
  } as unknown as Request;
}

function createHarness(input: {
  allowInsecureLocal?: boolean;
  nodeEnv?: string;
  trustedProxyIps?: string;
}) {
  const configService = new ConfigService({
    ADMIN_AUTH_ALLOW_INSECURE_LOCAL: String(!!input.allowInsecureLocal),
    NODE_ENV: input.nodeEnv || 'test',
    PUBLIC_SECURITY_TRUSTED_PROXY_IPS: input.trustedProxyIps || '10.66.66.1',
  });
  const clientIpService = new ClientIpService(configService);
  const getPublicOrigin = jest.spyOn(clientIpService, 'getPublicOrigin');
  const trustedCredentialTransportService =
    new TrustedCredentialTransportService(clientIpService, configService);
  const authService = {
    clearAccessTokenCookie: jest.fn(),
    clearRefreshTokenCookie: jest.fn(),
    getRefreshTokenFromRequest: jest.fn(() => 'refresh-token'),
    login: jest.fn().mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: { id: 'admin-1' },
    }),
    logout: jest.fn().mockResolvedValue(undefined),
    refresh: jest.fn().mockResolvedValue({
      accessToken: 'next-access-token',
      refreshToken: 'next-refresh-token',
    }),
    setAccessTokenCookie: jest.fn((response: Response, token: string) => {
      response.cookie('admin_access_token', token);
    }),
    setRefreshTokenCookie: jest.fn((response: Response, token: string) => {
      response.cookie('jwt', token);
    }),
  };
  const userService = {
    serializeUser: jest.fn((user) => user),
  };
  const controller = new AdminAuthController(
    authService as any,
    trustedCredentialTransportService,
    {} as any,
    userService as any,
  );
  const response = {
    clearCookie: jest.fn(),
    cookie: jest.fn(),
  } as unknown as Response;

  return {
    authService,
    controller,
    getPublicOrigin,
    response,
    sideEffects: [
      authService.clearAccessTokenCookie,
      authService.clearRefreshTokenCookie,
      authService.getRefreshTokenFromRequest,
      authService.login,
      authService.logout,
      authService.refresh,
      authService.setAccessTokenCookie,
      authService.setRefreshTokenCookie,
    ],
  };
}

async function invokeEndpoint(
  endpoint: AuthEndpoint,
  harness: ReturnType<typeof createHarness>,
  request: Request,
) {
  if (endpoint === 'login') {
    return harness.controller.login(
      { password: 'plain-login-password', username: 'admin' },
      request,
      harness.response,
    );
  }
  if (endpoint === 'refresh') {
    return harness.controller.refresh(request, harness.response);
  }
  return harness.controller.logout(request, harness.response);
}

describe('AdminAuthController TLS transport gate', () => {
  it('returns only the Admin identity and token without WordPress side effects', async () => {
    const harness = createHarness({ trustedProxyIps: '127.0.0.1' });
    const request = createRequest({
      forwardedProto: 'https',
      remoteAddress: '127.0.0.1',
    });

    await expect(
      harness.controller.login(
        { password: 'plain-login-password', username: 'admin' },
        request,
        harness.response,
      ),
    ).resolves.toEqual({
      code: 200,
      data: {
        accessToken: 'access-token',
        id: 'admin-1',
      },
      msg: '操作成功',
    });
    expect(harness.authService.setAccessTokenCookie).toHaveBeenCalledWith(
      harness.response,
      'access-token',
    );
    expect(harness.authService.setRefreshTokenCookie).toHaveBeenCalledWith(
      harness.response,
      'refresh-token',
    );
    expect((harness.response.cookie as jest.Mock).mock.calls).toEqual([
      ['admin_access_token', 'access-token'],
      ['jwt', 'refresh-token'],
    ]);
  });

  it.each<AuthEndpoint>(['login', 'refresh', 'logout'])(
    'rejects untrusted direct HTTP before %s side effects even with forged X-Forwarded-Proto',
    async (endpoint) => {
      const harness = createHarness({});
      const request = createRequest({
        forwardedProto: 'https',
        remoteAddress: '203.0.113.9',
      });

      await expect(
        invokeEndpoint(endpoint, harness, request),
      ).rejects.toMatchObject({ status: 403 });
      expect(harness.getPublicOrigin).toHaveBeenCalledWith(request);
      harness.sideEffects.forEach((sideEffect) =>
        expect(sideEffect).not.toHaveBeenCalled(),
      );
    },
  );

  it.each<AuthEndpoint>(['login', 'refresh', 'logout'])(
    'accepts trusted proxy HTTPS for %s',
    async (endpoint) => {
      const harness = createHarness({ trustedProxyIps: '127.0.0.1' });
      const request = createRequest({
        forwardedProto: 'https',
        remoteAddress: '127.0.0.1',
      });

      await expect(
        invokeEndpoint(endpoint, harness, request),
      ).resolves.toBeDefined();
      expect(harness.getPublicOrigin).toHaveBeenCalledWith(request);
      if (endpoint === 'login') {
        expect(harness.authService.login).toHaveBeenCalledWith(
          'admin',
          'plain-login-password',
        );
      }
    },
  );

  it.each<AuthEndpoint>(['login', 'refresh', 'logout'])(
    'allows explicit local non-production HTTP for %s',
    async (endpoint) => {
      const harness = createHarness({ allowInsecureLocal: true });
      const request = createRequest({
        host: '127.0.0.1:48085',
        remoteAddress: '127.0.0.1',
      });

      await expect(
        invokeEndpoint(endpoint, harness, request),
      ).resolves.toBeDefined();
      expect(harness.getPublicOrigin).toHaveBeenCalledWith(request);
    },
  );

  it.each<AuthEndpoint>(['login', 'refresh', 'logout'])(
    'rejects remote HTTP for %s when Host spoofs localhost',
    async (endpoint) => {
      const harness = createHarness({ allowInsecureLocal: true });
      const request = createRequest({
        host: 'localhost:48085',
        remoteAddress: '203.0.113.9',
      });

      await expect(
        invokeEndpoint(endpoint, harness, request),
      ).rejects.toMatchObject({ status: 403 });
      expect(harness.getPublicOrigin).toHaveBeenCalledWith(request);
      harness.sideEffects.forEach((sideEffect) =>
        expect(sideEffect).not.toHaveBeenCalled(),
      );
    },
  );

  it.each<AuthEndpoint>(['login', 'refresh', 'logout'])(
    'rejects production HTTP for %s even when the local exception is true',
    async (endpoint) => {
      const harness = createHarness({
        allowInsecureLocal: true,
        nodeEnv: 'production',
      });
      const request = createRequest({
        host: '127.0.0.1:48085',
        remoteAddress: '127.0.0.1',
      });

      await expect(
        invokeEndpoint(endpoint, harness, request),
      ).rejects.toMatchObject({ status: 403 });
      harness.sideEffects.forEach((sideEffect) =>
        expect(sideEffect).not.toHaveBeenCalled(),
      );
    },
  );
});
