import {
  Body,
  Controller,
  Get,
  INestApplication,
  Module,
  Post,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { ClientIpService } from '../../../src/common/security/client-ip.service';
import { PublicRateLimitGuard } from '../../../src/common/security/public-rate-limit.guard';
import { PublicRateLimitService } from '../../../src/common/security/public-rate-limit.service';
import { RedisRateLimitStore } from '../../../src/common/security/redis-rate-limit.store';
import { TrustedCredentialTransportService } from '../../../src/common/security/trusted-credential-transport.service';

@Controller('blog/article/public')
class PublicReadTestController {
  @Get('list')
  list() {
    return { ok: true };
  }
}

@Controller('api')
class ManagementTestController {
  @Get()
  getDocumentIndex() {
    return { ok: true };
  }
}

@Controller('auth')
class LoginTestController {
  @Post('login')
  login(@Body() body: { username?: string }) {
    return { usernamePresent: !!body.username };
  }
}

class InMemoryRateLimitStore {
  private readonly counts = new Map<string, number>();
  readonly calls: string[] = [];

  async increment(namespace: string, identity: string, ttlMs: number) {
    const key = `${namespace}:${identity}`;
    this.calls.push(key);
    const count = (this.counts.get(key) || 0) + 1;
    this.counts.set(key, count);
    return { count, ttlMs };
  }

  async incrementMany(
    buckets: Array<{
      identity: string;
      namespace: string;
      ttlMs: number;
    }>,
  ) {
    return Promise.all(
      buckets.map((bucket) =>
        this.increment(bucket.namespace, bucket.identity, bucket.ttlMs),
      ),
    );
  }

  reset() {
    this.calls.length = 0;
    this.counts.clear();
  }

  getCounts(namespace: string) {
    return [...this.counts.entries()]
      .filter(([key]) => key.startsWith(`${namespace}:`))
      .map(([, count]) => count)
      .sort((left, right) => left - right);
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({
      ignoreEnvFile: true,
      isGlobal: true,
      load: [
        () => ({
          NODE_ENV: 'test',
          PUBLIC_RATE_LIMIT_BASELINE_LIMIT: 100,
          PUBLIC_RATE_LIMIT_LOGIN_GLOBAL_LIMIT: 100,
          PUBLIC_RATE_LIMIT_LOGIN_GLOBAL_WINDOW_MS: 60000,
          PUBLIC_RATE_LIMIT_LOGIN_IP_LIMIT: 5,
          PUBLIC_RATE_LIMIT_LOGIN_IP_WINDOW_MS: 60000,
          PUBLIC_RATE_LIMIT_LOGIN_USERNAME_LIMIT: 10,
          PUBLIC_RATE_LIMIT_LOGIN_USERNAME_WINDOW_MS: 900000,
          PUBLIC_RATE_LIMIT_LIVE2D_CONCURRENT_LEASE_MS: 120000,
          PUBLIC_RATE_LIMIT_LIVE2D_CONCURRENT_LIMIT: 8,
          PUBLIC_RATE_LIMIT_LOGOUT_SUBJECT_LIMIT: 10,
          PUBLIC_RATE_LIMIT_LOGOUT_SUBJECT_WINDOW_MS: 60000,
          PUBLIC_RATE_LIMIT_PUBLIC_READ_LIMIT: 2,
          PUBLIC_RATE_LIMIT_REFRESH_SUBJECT_LIMIT: 30,
          PUBLIC_RATE_LIMIT_REFRESH_SUBJECT_WINDOW_MS: 60000,
          PUBLIC_RATE_LIMIT_REDIS_KEY_PREFIX: 'kt:test:public-rate-limit',
          PUBLIC_RATE_LIMIT_WARNING_INTERVAL_MS: 30000,
          PUBLIC_RATE_LIMIT_WINDOW_MS: 60000,
          PUBLIC_SECURITY_SWAGGER_ALLOWLIST: '192.0.2.10',
          PUBLIC_SECURITY_TRUSTED_PROXY_IPS: '10.66.66.1',
        }),
      ],
    }),
  ],
  controllers: [ManagementTestController, PublicReadTestController],
  providers: [
    ClientIpService,
    TrustedCredentialTransportService,
    PublicRateLimitService,
    PublicRateLimitGuard,
    Reflector,
    {
      provide: RedisRateLimitStore,
      useClass: InMemoryRateLimitStore,
    },
    {
      provide: APP_GUARD,
      useExisting: PublicRateLimitGuard,
    },
  ],
})
class RateLimitTestModule {}

@Module({
  imports: [
    ConfigModule.forRoot({
      ignoreEnvFile: true,
      isGlobal: true,
      load: [
        () => ({
          NODE_ENV: 'test',
          PUBLIC_RATE_LIMIT_BASELINE_LIMIT: 100,
          PUBLIC_RATE_LIMIT_LOGIN_GLOBAL_LIMIT: 4,
          PUBLIC_RATE_LIMIT_LOGIN_GLOBAL_WINDOW_MS: 60000,
          PUBLIC_RATE_LIMIT_LOGIN_IP_LIMIT: 3,
          PUBLIC_RATE_LIMIT_LOGIN_IP_WINDOW_MS: 60000,
          PUBLIC_RATE_LIMIT_LOGIN_USERNAME_LIMIT: 2,
          PUBLIC_RATE_LIMIT_LOGIN_USERNAME_WINDOW_MS: 900000,
          PUBLIC_RATE_LIMIT_LIVE2D_CONCURRENT_LEASE_MS: 120000,
          PUBLIC_RATE_LIMIT_LIVE2D_CONCURRENT_LIMIT: 8,
          PUBLIC_RATE_LIMIT_LOGOUT_SUBJECT_LIMIT: 10,
          PUBLIC_RATE_LIMIT_LOGOUT_SUBJECT_WINDOW_MS: 60000,
          PUBLIC_RATE_LIMIT_PUBLIC_READ_LIMIT: 60,
          PUBLIC_RATE_LIMIT_REFRESH_SUBJECT_LIMIT: 30,
          PUBLIC_RATE_LIMIT_REFRESH_SUBJECT_WINDOW_MS: 60000,
          PUBLIC_RATE_LIMIT_REDIS_KEY_PREFIX: 'kt:test:login-rate-limit',
          PUBLIC_RATE_LIMIT_WARNING_INTERVAL_MS: 30000,
          PUBLIC_RATE_LIMIT_WINDOW_MS: 60000,
          PUBLIC_SECURITY_SWAGGER_ALLOWLIST: '192.0.2.10',
          PUBLIC_SECURITY_TRUSTED_PROXY_IPS: '127.0.0.1',
        }),
      ],
    }),
  ],
  controllers: [LoginTestController],
  providers: [
    ClientIpService,
    TrustedCredentialTransportService,
    PublicRateLimitService,
    PublicRateLimitGuard,
    Reflector,
    {
      provide: RedisRateLimitStore,
      useClass: InMemoryRateLimitStore,
    },
    {
      provide: APP_GUARD,
      useExisting: PublicRateLimitGuard,
    },
  ],
})
class LoginRateLimitTestModule {}

describe('Public rate-limit HTTP boundary (e2e)', () => {
  let app: INestApplication;
  let loginApp: INestApplication;
  let loginStore: InMemoryRateLimitStore;
  let store: InMemoryRateLimitStore;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [RateLimitTestModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    const clientIpService = app.get(ClientIpService);
    const rateLimitService = app.get(PublicRateLimitService);
    const rateLimitGuard = app.get(PublicRateLimitGuard);
    store = app.get(RedisRateLimitStore) as unknown as InMemoryRateLimitStore;
    app
      .getHttpAdapter()
      .getInstance()
      .set('trust proxy', (address: string) =>
        clientIpService.isTrustedProxy(address),
      );
    app.use((incomingRequest, response, next) => {
      if (!rateLimitService.isManagementSurface(incomingRequest)) {
        next();
        return;
      }

      void rateLimitService
        .consume(incomingRequest)
        .then((outcome) => {
          try {
            rateLimitGuard.assertAllowed(response, outcome);
            next();
          } catch (error) {
            next(error);
          }
        })
        .catch(next);
    });
    await app.listen(0, '127.0.0.1');

    const loginModuleFixture = await Test.createTestingModule({
      imports: [LoginRateLimitTestModule],
    }).compile();
    loginApp = loginModuleFixture.createNestApplication();
    const loginClientIpService = loginApp.get(ClientIpService);
    loginStore = loginApp.get(
      RedisRateLimitStore,
    ) as unknown as InMemoryRateLimitStore;
    loginApp
      .getHttpAdapter()
      .getInstance()
      .set('trust proxy', (address: string) =>
        loginClientIpService.isTrustedProxy(address),
      );
    await loginApp.listen(0, '127.0.0.1');
  });

  it('counts a management route once across middleware and the Nest guard', async () => {
    await request(app.getHttpServer()).get('/api').expect(200);

    expect(
      store.calls.filter((key) => key.startsWith('management:read:')),
    ).toHaveLength(1);
  });

  afterAll(async () => {
    await app.close();
    await loginApp.close();
  });

  it('keeps spoofed XFF in the socket-peer bucket and rejects request N+1', async () => {
    const server = app.getHttpServer();

    await request(server)
      .get('/blog/article/public/list')
      .set('X-Forwarded-For', '198.51.100.11')
      .expect(200);
    await request(server)
      .get('/blog/article/public/list')
      .set('X-Forwarded-For', '198.51.100.12')
      .expect(200);
    const rejected = await request(server)
      .get('/blog/article/public/list')
      .set('X-Forwarded-For', '198.51.100.13')
      .expect(429);

    expect(rejected.headers['retry-after']).toBe('60');
  });

  it('rejects the fourth login from one trusted client IP', async () => {
    loginStore.reset();
    const server = loginApp.getHttpServer();

    for (let index = 1; index <= 3; index += 1) {
      await request(server)
        .post('/auth/login')
        .set('X-Forwarded-For', '198.51.100.21')
        .set('X-Forwarded-Proto', 'https')
        .send({ username: `ip-user-${index}` })
        .expect(201);
    }
    const rejected = await request(server)
      .post('/auth/login')
      .set('X-Forwarded-For', '198.51.100.21')
      .set('X-Forwarded-Proto', 'https')
      .send({ username: 'ip-user-4' })
      .expect(429);

    expect(rejected.headers['retry-after']).toBe('60');
    expect(loginStore.getCounts('login:ip')).toEqual([4]);
    expect(loginStore.getCounts('login:username')).toEqual([1, 1, 1, 1]);
    expect(loginStore.getCounts('login:global')).toEqual([4]);
  });

  it('rejects the third login for one normalized username across IPs', async () => {
    loginStore.reset();
    const server = loginApp.getHttpServer();

    await request(server)
      .post('/auth/login')
      .set('X-Forwarded-For', '198.51.100.31')
      .set('X-Forwarded-Proto', 'https')
      .send({ username: '  Ａdmin  ' })
      .expect(201);
    await request(server)
      .post('/auth/login')
      .set('X-Forwarded-For', '198.51.100.32')
      .set('X-Forwarded-Proto', 'https')
      .send({ username: 'admin' })
      .expect(201);
    const rejected = await request(server)
      .post('/auth/login')
      .set('X-Forwarded-For', '198.51.100.33')
      .set('X-Forwarded-Proto', 'https')
      .send({ username: 'ADMIN' })
      .expect(429);

    expect(rejected.headers['retry-after']).toBe('900');
    expect(loginStore.getCounts('login:ip')).toEqual([1, 1, 1]);
    expect(loginStore.getCounts('login:username')).toEqual([3]);
    expect(loginStore.getCounts('login:global')).toEqual([3]);
  });

  it('rejects the fifth global login across distinct IPs and usernames', async () => {
    loginStore.reset();
    const server = loginApp.getHttpServer();

    for (let index = 1; index <= 4; index += 1) {
      await request(server)
        .post('/auth/login')
        .set('X-Forwarded-For', `198.51.100.${40 + index}`)
        .set('X-Forwarded-Proto', 'https')
        .send({ username: `global-user-${index}` })
        .expect(201);
    }
    const rejected = await request(server)
      .post('/auth/login')
      .set('X-Forwarded-For', '198.51.100.45')
      .set('X-Forwarded-Proto', 'https')
      .send({ username: 'global-user-5' })
      .expect(429);

    expect(rejected.headers['retry-after']).toBe('60');
    expect(loginStore.getCounts('login:ip')).toEqual([1, 1, 1, 1, 1]);
    expect(loginStore.getCounts('login:username')).toEqual([1, 1, 1, 1, 1]);
    expect(loginStore.getCounts('login:global')).toEqual([5]);
  });
});
