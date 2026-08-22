import {
  Controller,
  Get,
  INestApplication,
  Module,
  Post,
  Put,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { PublicRateLimitGuard } from '../../../src/common/security/public-rate-limit.guard';
import { PublicRateLimitService } from '../../../src/common/security/public-rate-limit.service';
import { ClientIpService } from '../../../src/common/security/client-ip.service';
import { TrustedCredentialTransportService } from '../../../src/common/security/trusted-credential-transport.service';

@Controller('auth')
class CredentialRouteTestController {
  @Post('login')
  login() {
    return { ok: true };
  }

  @Post('refresh')
  refresh() {
    return { ok: true };
  }

  @Post('logout')
  logout() {
    return { ok: true };
  }

  @Get('login')
  readLogin() {
    return { ok: true };
  }

  @Post('profile')
  updateProfile() {
    return { ok: true };
  }
}

@Controller('bot-adapter')
class BotCredentialRouteTestController {
  @Post('napcat/account/save')
  save() {
    return { ok: true };
  }

  @Post('napcat/account/update')
  update() {
    return { ok: true };
  }

  @Post('napcat/account/delete')
  delete() {
    return { ok: true };
  }

  /**
   * 模拟 Tencent 连接凭据创建接口，供全局传输保护测试命中真实新路由。
   * @returns 固定成功载荷。
   */
  @Post('tencent/save')
  saveTencent() {
    return { ok: true };
  }

  /**
   * 模拟 Tencent 连接凭据更新接口，供全局传输保护测试命中真实新路由。
   * @returns 固定成功载荷。
   */
  @Post('tencent/update')
  updateTencent() {
    return { ok: true };
  }
}

@Controller('system/user')
class AdminUserCredentialRouteTestController {
  @Post()
  create() {
    return { ok: true };
  }

  @Put(':id')
  update() {
    return { ok: true };
  }

  @Put(':id/password')
  resetPassword() {
    return { ok: true };
  }

  @Get(':id')
  read() {
    return { ok: true };
  }
}

@Controller('llm/configs')
class LlmCredentialRouteTestController {
  @Post()
  create() {
    return { ok: true };
  }

  @Put(':id')
  update() {
    return { ok: true };
  }
}

const consume = jest.fn().mockResolvedValue({
  allowed: true,
  policy: 'login',
  redisAvailable: true,
});

@Module({
  controllers: [
    CredentialRouteTestController,
    BotCredentialRouteTestController,
    AdminUserCredentialRouteTestController,
    LlmCredentialRouteTestController,
  ],
  providers: [
    {
      provide: ConfigService,
      useValue: new ConfigService({
        ADMIN_AUTH_ALLOW_INSECURE_LOCAL: 'true',
        NODE_ENV: 'production',
        PUBLIC_SECURITY_TRUSTED_PROXY_IPS: '127.0.0.1,::1',
      }),
    },
    ClientIpService,
    Reflector,
    PublicRateLimitGuard,
    TrustedCredentialTransportService,
    {
      provide: PublicRateLimitService,
      useValue: {
        consume,
      },
    },
    {
      provide: APP_GUARD,
      useExisting: PublicRateLimitGuard,
    },
  ],
})
class CredentialRouteTestModule {}

describe('PublicRateLimitGuard credential transport boundary', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CredentialRouteTestModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    consume.mockClear();
  });

  it.each([
    '/auth/login',
    '/auth/refresh/',
    '/auth/logout',
    '/bot-adapter/napcat/account/save',
    '/bot-adapter/napcat/account/update/',
    '/bot-adapter/tencent/save',
    '/bot-adapter/tencent/update/',
    '/llm/configs',
    '/system/user',
  ])('rejects direct HTTP %s before rate-limit consumption', async (path) => {
    await request(app.getHttpServer()).post(path).expect(403);

    expect(consume).not.toHaveBeenCalled();
  });

  it.each([
    '/llm/configs/2041700000000100001',
    '/system/user/admin-1',
    '/system/user/admin-1/password/',
  ])(
    'rejects direct HTTP PUT %s before rate-limit consumption',
    async (path) => {
      await request(app.getHttpServer()).put(path).expect(403);

      expect(consume).not.toHaveBeenCalled();
    },
  );

  it.each(['/auth/login', '/bot-adapter/napcat/account/save'])(
    'keeps trusted proxy HTTPS %s on the existing rate-limit path',
    async (path) => {
      await request(app.getHttpServer())
        .post(path)
        .set('X-Forwarded-Proto', 'https')
        .expect(201);

      expect(consume).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['GET', '/auth/login'],
    ['POST', '/auth/profile'],
    ['POST', '/bot-adapter/napcat/account/delete'],
    ['GET', '/system/user/admin-1'],
  ] as const)(
    'keeps unrelated %s %s on the existing rate-limit path',
    async (method, path) => {
      await request(app.getHttpServer())
        [method.toLowerCase() as 'get' | 'post'](path)
        .expect(method === 'GET' ? 200 : 201);

      expect(consume).toHaveBeenCalledTimes(1);
    },
  );
});
