jest.mock('@/modules/admin/identity/auth/jwt-auth.guard', () => ({
  JwtAuthGuard: class {
    canActivate() {
      return true;
    }
  },
}));
jest.mock('@/modules/qqbot/core/account/qqbot-account.service', () => ({
  QqbotAccountService: class {},
}));
jest.mock('@/modules/qqbot/napcat/login/qqbot-napcat-login.service', () => ({
  QqbotNapcatLoginService: class {},
}));
jest.mock('@/modules/qqbot/core/connection/qqbot-reverse-ws.service', () => ({
  QqbotReverseWsService: class {},
}));

import * as request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { QqbotAccountController } from '@/modules/qqbot/core/account/qqbot-account.controller';
import { QqbotAccountService } from '@/modules/qqbot/core/account/qqbot-account.service';
import { QqbotNapcatLoginService } from '@/modules/qqbot/napcat/login/qqbot-napcat-login.service';
import { QqbotReverseWsService } from '@/modules/qqbot/core/connection/qqbot-reverse-ws.service';

describe('QqbotAccountController', () => {
  let app: INestApplication;
  const accountService = {
    save: jest.fn().mockResolvedValue('account-1'),
  };
  const napcatLoginService = {
    submitCaptcha: jest.fn().mockResolvedValue({
      message: '验证码登录成功',
      status: 'success',
    }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [QqbotAccountController],
      providers: [
        { provide: QqbotAccountService, useValue: accountService },
        { provide: QqbotNapcatLoginService, useValue: napcatLoginService },
        { provide: QqbotReverseWsService, useValue: {} },
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
    napcatLoginService.submitCaptcha.mockClear();
  });

  it('accepts encrypted NapCat login password through account save API', async () => {
    await request(app.getHttpServer())
      .post('/qqbot/account/save')
      .send({
        encryptedLoginPassword: 'encrypted-login-password',
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
        encryptedLoginPassword: 'encrypted-login-password',
        selfId: '1914728559',
      }),
    );
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
