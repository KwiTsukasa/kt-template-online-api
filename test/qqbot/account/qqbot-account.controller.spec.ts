jest.mock('@/modules/admin/identity/auth/presentation/jwt-auth.guard', () => ({
  JwtAuthGuard: class {
    /**
     * 判断 测试断言条件。
     */
    canActivate() {
      return true;
    }
  },
}));
jest.mock(
  '@/modules/qqbot/core/application/account/qqbot-account.service',
  () => ({
    QqbotAccountService: class {},
  }),
);
jest.mock(
  '@/modules/qqbot/core/infrastructure/integration/connection/qqbot-official.service',
  () => ({
    QqbotOfficialService: class {},
  }),
);
jest.mock(
  '@/modules/qqbot/napcat/application/login/qqbot-napcat-login.service',
  () => ({
    QqbotNapcatLoginService: class {},
  }),
);
jest.mock(
  '@/modules/qqbot/core/infrastructure/integration/connection/qqbot-reverse-ws.service',
  () => ({
    QqbotReverseWsService: class {},
  }),
);
jest.mock(
  '@/modules/qqbot/core/application/command/qqbot-command.service',
  () => ({
    QqbotCommandService: class {},
  }),
);
const MockQqbotCommandService = jest.requireMock(
  '@/modules/qqbot/core/application/command/qqbot-command.service',
).QqbotCommandService;

import * as request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientIpService } from '@/common/security/client-ip.service';
import { TrustedCredentialTransportService } from '@/common/security/trusted-credential-transport.service';
import { QqbotAccountController } from '@/modules/qqbot/core/contract/account/qqbot-account.controller';
import { QqbotAccountBodyDto } from '@/modules/qqbot/core/contract/account/qqbot-account.dto';
import { QqbotAccountService } from '@/modules/qqbot/core/application/account/qqbot-account.service';
import { QqbotNapcatLoginService } from '@/modules/qqbot/napcat/application/login/qqbot-napcat-login.service';
import { QqbotNapcatLoginController } from '@/modules/qqbot/napcat/contract/qqbot-napcat-login.controller';
import { QqbotReverseWsService } from '@/modules/qqbot/core/infrastructure/integration/connection/qqbot-reverse-ws.service';
import { QqbotOfficialService } from '@/modules/qqbot/core/infrastructure/integration/connection/qqbot-official.service';

describe('QqbotAccountController', () => {
  let app: INestApplication;
  const eventPublisher = jest.fn();
  const repositoryWrite = jest.fn();
  const secretWrapper = jest.fn();
  const accountService = {
    findById: jest.fn().mockResolvedValue({
      connectionMode: 'reverse-ws',
      id: 'account-1',
      selfId: '1914728559',
    }),
    save: jest.fn().mockImplementation(async () => {
      secretWrapper();
      repositoryWrite();
      eventPublisher();
      return 'account-1';
    }),
    update: jest.fn().mockImplementation(async () => {
      secretWrapper();
      repositoryWrite();
      eventPublisher();
      return true;
    }),
  };
  const napcatLoginService = {
    submitCaptcha: jest.fn().mockResolvedValue({
      message: '验证码登录成功',
      status: 'success',
    }),
  };
  const officialService = {
    reconcileAccount: jest.fn().mockResolvedValue({ started: false }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [QqbotAccountController, QqbotNapcatLoginController],
      providers: [
        { provide: QqbotAccountService, useValue: accountService },
        { provide: QqbotNapcatLoginService, useValue: napcatLoginService },
        { provide: QqbotOfficialService, useValue: officialService },
        { provide: QqbotReverseWsService, useValue: {} },
        { provide: MockQqbotCommandService, useValue: {} },
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
    accountService.save.mockClear();
    accountService.update.mockClear();
    eventPublisher.mockClear();
    napcatLoginService.submitCaptcha.mockClear();
    repositoryWrite.mockClear();
    secretWrapper.mockClear();
  });

  it('accepts request-scoped NapCat login password through account save API', async () => {
    await request(app.getHttpServer())
      .post('/qqbot/account/save')
      .set('X-Forwarded-Proto', 'https')
      .send({
        loginPassword: 'plain-login-password',
        name: 'Mirror',
        selfId: '1914728559',
      })
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual(
          expect.objectContaining({
            code: 200,
            data: 'account-1',
          }),
        );
      });

    expect(accountService.save).toHaveBeenCalledWith(
      expect.objectContaining({
        loginPassword: 'plain-login-password',
        selfId: '1914728559',
      }),
    );
  });

  it.each([
    [
      '/qqbot/account/save',
      {
        loginPassword: 'plain-login-password',
        name: 'Mirror',
        selfId: '1914728559',
      },
    ],
    [
      '/qqbot/account/update/',
      {
        id: 'account-1',
        loginPassword: 'plain-login-password',
        name: 'Mirror',
        selfId: '1914728559',
      },
    ],
  ])(
    'rejects direct HTTP %s before account and secret side effects',
    async (path, body) => {
      await request(app.getHttpServer()).post(path).send(body).expect(403);

      expect(accountService.save).not.toHaveBeenCalled();
      expect(accountService.update).not.toHaveBeenCalled();
      expect(secretWrapper).not.toHaveBeenCalled();
      expect(repositoryWrite).not.toHaveBeenCalled();
      expect(eventPublisher).not.toHaveBeenCalled();
    },
  );

  it('accepts trusted proxy HTTPS through account update API', async () => {
    await request(app.getHttpServer())
      .post('/qqbot/account/update')
      .set('X-Forwarded-Proto', 'https')
      .send({
        id: 'account-1',
        loginPassword: 'plain-login-password',
        name: 'Mirror',
        selfId: '1914728559',
      })
      .expect(200);

    expect(accountService.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'account-1',
        loginPassword: 'plain-login-password',
      }),
    );
  });

  it('publishes only the request-scoped login password DTO field', () => {
    const properties =
      Reflect.getMetadata(
        'swagger/apiModelPropertiesArray',
        QqbotAccountBodyDto.prototype,
      ) || [];

    expect(properties).toContain(':loginPassword');
    expect(properties).not.toContain(':encryptedLoginPassword');
  });

  it('submits NapCat captcha result through scan captcha API', async () => {
    await request(app.getHttpServer())
      .post('/qqbot/account/scan/captcha/submit')
      .send({
        randstr: '@captcha-randstr',
        sessionId: 'session-1',
        sid: 'captcha-sid',
        ticket: 'captcha-ticket',
      })
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual(
          expect.objectContaining({
            code: 200,
            data: expect.objectContaining({
              message: '验证码登录成功',
              status: 'success',
            }),
          }),
        );
      });

    expect(napcatLoginService.submitCaptcha).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        randstr: '@captcha-randstr',
        sessionId: 'session-1',
        sid: 'captcha-sid',
        ticket: 'captcha-ticket',
      }),
    );
  });
});
