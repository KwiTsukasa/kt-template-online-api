import { HttpException, HttpStatus, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import {
  ClientIpService,
  PublicRateLimitService,
  ToolsService,
  TrustedCredentialTransportService,
} from '../../../src/common';
import { AdminMenuService } from '../../../src/modules/admin/identity/menu/admin-menu.service';
import { AdminAuthController } from '../../../src/modules/admin/identity/auth/admin-auth.controller';
import { AdminRefreshTokenStateStore } from '../../../src/modules/admin/identity/auth/admin-refresh-token-state.store';
import { AdminAuthService } from '../../../src/modules/admin/identity/auth/admin-auth.service';
import { AdminPasswordHashService } from '../../../src/modules/admin/identity/auth/admin-password-hash.service';
import { AdminTokenService } from '../../../src/modules/admin/identity/auth/admin-token.service';
import { JwtAuthGuard } from '../../../src/modules/admin/identity/auth/jwt-auth.guard';
import { AdminUser } from '../../../src/modules/admin/identity/user/admin-user.entity';
import { AdminUserService } from '../../../src/modules/admin/identity/user/admin-user.service';

describe('Admin verified subject rate-limit HTTP boundary (e2e)', () => {
  let app: INestApplication;
  const consumeVerifiedTokenSubject = jest.fn(
    async (_operation, _subject, response) => {
      response.setHeader('Retry-After', '43');
      throw new HttpException(
        '请求过于频繁，请稍后重试',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    },
  );

  beforeAll(async () => {
    const configService = new ConfigService({
      ADMIN_AUTH_ALLOW_INSECURE_LOCAL: 'true',
      NODE_ENV: 'test',
      PUBLIC_SECURITY_TRUSTED_PROXY_IPS: '127.0.0.1,::1',
    });
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminAuthController],
      providers: [
        AdminAuthService,
        {
          provide: getRepositoryToken(AdminUser),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: AdminTokenService,
          useValue: {
            verifyRefreshToken: jest.fn(() => ({
              exp: Math.floor(Date.now() / 1000) + 3600,
              jti: 'b'.repeat(32),
              sid: 'a'.repeat(32),
              sub: 'user-42',
              username: 'admin',
            })),
          },
        },
        {
          provide: AdminRefreshTokenStateStore,
          useValue: {
            revokeSession: jest.fn(),
            rotateSession: jest.fn(),
          },
        },
        {
          provide: ToolsService,
          useValue: {
            readCookie: jest.fn(() => 'valid-refresh-token'),
          },
        },
        {
          provide: AdminPasswordHashService,
          useValue: {},
        },
        {
          provide: PublicRateLimitService,
          useValue: {
            consumeVerifiedTokenSubject,
          },
        },
        {
          provide: ConfigService,
          useValue: configService,
        },
        ClientIpService,
        TrustedCredentialTransportService,
        {
          provide: AdminMenuService,
          useValue: {},
        },
        {
          provide: AdminUserService,
          useValue: {},
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: () => true,
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['refresh', '/auth/refresh'],
    ['logout', '/auth/logout'],
  ])(
    'returns the same coarse 429 contract for verified %s subject overflow',
    async (operation, path) => {
      const response = await request(app.getHttpServer())
        .post(path)
        .expect(HttpStatus.TOO_MANY_REQUESTS);

      expect(response.headers['retry-after']).toBe('43');
      expect(response.body).toEqual({
        message: '请求过于频繁，请稍后重试',
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
      });
      expect(consumeVerifiedTokenSubject).toHaveBeenCalledWith(
        operation,
        'user-42',
        expect.objectContaining({
          setHeader: expect.any(Function),
        }),
      );
    },
  );
});
