jest.mock('../../src/modules/admin/identity/auth/presentation/jwt-auth.guard', () => ({
  JwtAuthGuard: class {
    /**
     * 判断测试请求是否允许进入控制器。
     */
    canActivate() {
      return true;
    }
  },
}));

import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { ClientIpService } from '../../src/common/security/client-ip.service';
import { TrustedCredentialTransportService } from '../../src/common/security/trusted-credential-transport.service';
import { AdminUserManageController } from '../../src/modules/admin/identity/user/admin-user-manage.controller';
import { AdminUserService } from '../../src/modules/admin/identity/user/admin-user.service';

describe('AdminUserManageController credential transport gate', () => {
  let app: INestApplication;
  const hashPassword = jest.fn();
  const repositoryWrite = jest.fn();
  const userService = {
    createUser: jest.fn().mockImplementation(async () => {
      hashPassword();
      repositoryWrite();
      return 'admin-1';
    }),
    resetUserPassword: jest.fn().mockImplementation(async () => {
      hashPassword();
      repositoryWrite();
      return true;
    }),
    updateUser: jest.fn().mockImplementation(async () => {
      hashPassword();
      repositoryWrite();
      return true;
    }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminUserManageController],
      providers: [
        {
          provide: AdminUserService,
          useValue: userService,
        },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            ADMIN_AUTH_ALLOW_INSECURE_LOCAL: 'false',
            NODE_ENV: 'test',
            PUBLIC_SECURITY_TRUSTED_PROXY_IPS: '127.0.0.1,::1',
          }),
        },
        ClientIpService,
        TrustedCredentialTransportService,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    hashPassword.mockClear();
    repositoryWrite.mockClear();
    userService.createUser.mockClear();
    userService.resetUserPassword.mockClear();
    userService.updateUser.mockClear();
  });

  it.each([
    ['post', '/system/user'],
    ['put', '/system/user/admin-1'],
    ['put', '/system/user/admin-1/password/'],
  ] as const)(
    'rejects direct HTTP %s %s before user, hash, and repository effects',
    async (method, path) => {
      await request(app.getHttpServer())
        [method](path)
        .send({ password: 'plain-password' })
        .expect(403);

      expect(userService.createUser).not.toHaveBeenCalled();
      expect(userService.updateUser).not.toHaveBeenCalled();
      expect(userService.resetUserPassword).not.toHaveBeenCalled();
      expect(hashPassword).not.toHaveBeenCalled();
      expect(repositoryWrite).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['post', '/system/user', 201],
    ['put', '/system/user/admin-1', 200],
    ['put', '/system/user/admin-1/password', 200],
  ] as const)(
    'accepts trusted proxy HTTPS %s %s',
    async (method, path, status) => {
      await request(app.getHttpServer())
        [method](path)
        .set('X-Forwarded-Proto', 'https')
        .send({ password: 'plain-password' })
        .expect(status);

      expect(
        userService.createUser.mock.calls.length +
          userService.updateUser.mock.calls.length +
          userService.resetUserPassword.mock.calls.length,
      ).toBe(1);
      expect(hashPassword).toHaveBeenCalledTimes(1);
      expect(repositoryWrite).toHaveBeenCalledTimes(1);
    },
  );
});
