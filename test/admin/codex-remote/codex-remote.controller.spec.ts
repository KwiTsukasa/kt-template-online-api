import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { CodexRemoteService } from '../../../src/modules/admin/codex-remote/application/codex-remote.service';
import { CodexRemoteController } from '../../../src/modules/admin/codex-remote/presentation/codex-remote.controller';
import { AdminSuperGuard } from '../../../src/modules/admin/identity/auth/presentation/admin-super.guard';
import { JwtAuthGuard } from '../../../src/modules/admin/identity/auth/presentation/jwt-auth.guard';

describe('CodexRemoteController', () => {
  let app: INestApplication;
  let apiUrl: string;
  const sharedSecret = Buffer.alloc(32, 7).toString('hex');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CodexRemoteController],
      providers: [
        CodexRemoteService,
        {
          provide: ConfigService,
          useValue: new ConfigService({
            CODEX_REMOTE_NAS_PROJECTS_JSON: JSON.stringify([
              { cwd: '/srv/kt', id: 'kt', label: 'KT Workspace' },
            ]),
            CODEX_REMOTE_NAS_WS_SHARED_SECRET: sharedSecret,
            CODEX_REMOTE_NAS_WS_URL: 'ws://10.66.66.2:48093',
          }),
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest().adminUser = {
            id: '2041700000000000002',
            username: 'kwitsukasa',
          };
          return true;
        },
      })
      .overrideGuard(AdminSuperGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    apiUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns no-store node catalog and session token responses', async () => {
    const nodes = await request(apiUrl)
      .get('/codex-remote/nodes')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(nodes.body.data).toEqual([
      expect.objectContaining({ id: 'nas', wsUrl: 'ws://10.66.66.2:48093' }),
    ]);
    const response = await request(apiUrl)
      .post('/codex-remote/nodes/nas/session')
      .send({ projectId: 'kt' })
      .expect(201)
      .expect('Cache-Control', 'no-store');

    expect(response.body.data).toEqual(
      expect.objectContaining({
        project: { cwd: '/srv/kt', id: 'kt', label: 'KT Workspace' },
        wsUrl: 'ws://10.66.66.2:48093',
      }),
    );
    const token = response.body.data.token as string;
    const payload = token.split('.')[1];
    expect(payload).toBeTruthy();
    expect(
      JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
    ).toEqual(
      expect.objectContaining({
        aud: 'kt-codex-remote-nas',
        projectCwd: '/srv/kt',
        projectId: 'kt',
        sub: '2041700000000000002',
      }),
    );
  });

  it('rejects unknown session fields before token issuance', async () => {
    await request(apiUrl)
      .post('/codex-remote/nodes/nas/session')
      .send({ projectId: 'kt', unknownField: 'must-not-pass' })
      .expect(400);
  });
});
