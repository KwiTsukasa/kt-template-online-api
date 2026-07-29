import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { ClientIpService } from '../../../src/common/security/client-ip.service';
import { TrustedCredentialTransportService } from '../../../src/common/security/trusted-credential-transport.service';
import { AdminAuthController } from '../../../src/modules/admin/identity/auth/admin-auth.controller';
import { AdminAuthService } from '../../../src/modules/admin/identity/auth/admin-auth.service';
import { JwtAuthGuard } from '../../../src/modules/admin/identity/auth/jwt-auth.guard';
import { AdminMenuService } from '../../../src/modules/admin/identity/menu/admin-menu.service';
import { AdminUserService } from '../../../src/modules/admin/identity/user/admin-user.service';
import { WordpressService } from '../../../src/modules/wordpress/application/wordpress.service';

describe('retired Admin password public key route (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const configService = new ConfigService({
      ADMIN_AUTH_ALLOW_INSECURE_LOCAL: 'true',
      NODE_ENV: 'test',
      PUBLIC_SECURITY_TRUSTED_PROXY_IPS: '127.0.0.1,::1',
    });
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminAuthController],
      providers: [
        { provide: AdminAuthService, useValue: {} },
        { provide: AdminMenuService, useValue: {} },
        { provide: AdminUserService, useValue: {} },
        { provide: WordpressService, useValue: {} },
        { provide: ConfigService, useValue: configService },
        ClientIpService,
        TrustedCredentialTransportService,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 404 from a real local Nest HTTP application', async () => {
    await request(app.getHttpServer())
      .get('/auth/password-public-key')
      .expect(404);
  });
});
