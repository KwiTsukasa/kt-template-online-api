import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { CodexRemoteService } from '../../../src/modules/admin/codex-remote/application/codex-remote.service';
import { CodexCoordinationService } from '../../../src/modules/admin/codex-remote/application/codex-coordination.service';
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
        CodexCoordinationService,
        {
          provide: ConfigService,
          useValue: new ConfigService({
            CODEX_REMOTE_PC_PROJECTS_JSON: JSON.stringify([
              {
                cwd: 'D:\\MyFiles\\KT',
                id: 'kt',
                label: 'KT Workspace',
                readOnlyCwdAliases: ['/home/yemu2/KT'],
              },
            ]),
            CODEX_REMOTE_PC_WS_SHARED_SECRET: sharedSecret,
            CODEX_REMOTE_PC_WS_URL: 'ws://10.66.66.4:48095',
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

  afterEach(() => jest.restoreAllMocks());

  it('serves coordination snapshots through a real local HTTP route with a bound upstream token', async () => {
    const snapshot = {
      schemaVersion: 1,
      snapshotId: 'fixture-snapshot',
      tasks: [],
      claims: [],
      events: [],
    };
    const upstream = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify(snapshot), { status: 200 }),
      );
    const response = await request(apiUrl)
      .get('/codex-remote/coordination')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(response.body.data).toEqual(snapshot);
    expect(upstream).toHaveBeenCalledWith(
      'http://10.66.66.4:48094/workflow-coordination',
      expect.objectContaining({
        redirect: 'error',
        signal: expect.any(AbortSignal),
      }),
    );
    const headers = upstream.mock.calls[0][1]?.headers as Record<
      string,
      string
    >;
    const payload = JSON.parse(
      Buffer.from(headers.Authorization.split('.')[1], 'base64url').toString(),
    );
    expect(payload).toMatchObject({
      projectId: 'kt',
      projectCwd: 'D:\\MyFiles\\KT',
      sub: '2041700000000000002',
    });
    expect(JSON.stringify(response.body)).not.toContain(headers.Authorization);
  });

  it('forwards separate large SSE frames through backpressure and reports unavailable snapshots', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start: (controller) => {
            const encoder = new TextEncoder();
            controller.enqueue(
              encoder.encode(
                `event: coordination-snapshot\ndata: ${JSON.stringify({ revision: 1, padding: 'x'.repeat(128 * 1024) })}\n\n`,
              ),
            );
            controller.enqueue(
              encoder.encode(
                'event: coordination-snapshot\ndata: {"revision":2}\n\n',
              ),
            );
            controller.close();
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
    );
    const streamed = await request(apiUrl)
      .get('/codex-remote/coordination/events')
      .expect(200)
      .expect('Content-Type', /text\/event-stream/);
    expect(streamed.text).toContain('"revision":2');
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('upstream connection failed'));
    const failed = await request(apiUrl)
      .get('/codex-remote/coordination')
      .expect(503);
    expect(failed.body.message).toBe('PC 协调中心暂不可用');
  });

  it('returns no-store node catalog and session token responses', async () => {
    const nodes = await request(apiUrl)
      .get('/codex-remote/nodes')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(nodes.body.data).toEqual([
      expect.objectContaining({ id: 'pc', wsUrl: 'ws://10.66.66.4:48095' }),
    ]);
    const response = await request(apiUrl)
      .post('/codex-remote/nodes/pc/session')
      .send({ projectId: 'kt' })
      .expect(201)
      .expect('Cache-Control', 'no-store');

    expect(response.body.data).toEqual(
      expect.objectContaining({
        project: {
          cwd: 'D:\\MyFiles\\KT',
          id: 'kt',
          label: 'KT Workspace',
          readOnlyCwdAliases: ['/home/yemu2/KT'],
        },
        wsUrl: 'ws://10.66.66.4:48095',
      }),
    );
    const token = response.body.data.token as string;
    const payload = token.split('.')[1];
    expect(payload).toBeTruthy();
    expect(
      JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
    ).toEqual(
      expect.objectContaining({
        aud: 'kt-codex-remote-pc',
        projectCwd: 'D:\\MyFiles\\KT',
        projectId: 'kt',
        sub: '2041700000000000002',
      }),
    );
  });

  it('rejects unknown session fields before token issuance', async () => {
    await request(apiUrl)
      .post('/codex-remote/nodes/pc/session')
      .send({ projectId: 'kt', unknownField: 'must-not-pass' })
      .expect(400);
  });
});
