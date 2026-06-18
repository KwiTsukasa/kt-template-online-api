import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { of } from 'rxjs';
import { JwtAuthGuard } from '../../../../src/modules/admin/identity/auth/jwt-auth.guard';
import { EnvironmentDashboardService } from '../../../../src/modules/admin/platform-config/environment-dashboard/application/environment-dashboard.service';
import { EnvironmentDashboardSelfCheckService } from '../../../../src/modules/admin/platform-config/environment-dashboard/application/environment-dashboard-self-check.service';
import { EnvironmentEventMaterializer } from '../../../../src/modules/admin/platform-config/environment-dashboard/application/environment-event.materializer';
import { EnvironmentEventStreamService } from '../../../../src/modules/admin/platform-config/environment-dashboard/application/environment-event-stream.service';
import { EnvironmentEventBusService } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/event/environment-event-bus.service';
import { EnvironmentDashboardController } from '../../../../src/modules/admin/platform-config/environment-dashboard/presentation/environment-dashboard.controller';

const dashboard = {
  actions: [],
  events: [],
  generatedAt: '2026-06-18T08:00:00.000Z',
  refreshedAt: '2026-06-18T08:00:00.000Z',
  sites: [],
  summary: { byStatus: {}, totalSignals: 0 },
  topology: { edges: [], nodes: [] },
};

describe('EnvironmentDashboardController', () => {
  let app: INestApplication;
  const dashboardService = {
    getDashboard: jest.fn(async () => dashboard),
  };
  const selfCheckService = {
    runSelfCheck: jest.fn(async () => dashboard),
  };
  const streamService = {
    stream: jest.fn(() =>
      of({
        data: { message: 'alive', observedAt: '2026-06-18T08:00:00.000Z' },
        id: 'heartbeat-1',
        type: 'heartbeat',
      }),
    ),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [EnvironmentDashboardController],
      providers: [
        { provide: EnvironmentDashboardService, useValue: dashboardService },
        {
          provide: EnvironmentDashboardSelfCheckService,
          useValue: selfCheckService,
        },
        { provide: EnvironmentEventStreamService, useValue: streamService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns the dashboard snapshot through Vben response shape', async () => {
    const response = await request(app.getHttpServer())
      .get('/system/environment/dashboard')
      .expect(200);

    expect(response.body).toMatchObject({
      code: 200,
      data: dashboard,
    });
  });

  it('runs readonly self-check through POST', async () => {
    const response = await request(app.getHttpServer())
      .post('/system/environment/self-check')
      .expect(200);

    expect(response.body).toMatchObject({
      code: 200,
      data: dashboard,
    });
    expect(selfCheckService.runSelfCheck).toHaveBeenCalled();
  });

  it('passes Last-Event-ID to the SSE stream service', async () => {
    await request(app.getHttpServer())
      .get('/system/environment/events/stream?lastEventId=evt-1')
      .set('Last-Event-ID', 'evt-header')
      .buffer(true)
      .parse((res, callback) => {
        res.once('data', () => callback(null, 'ok'));
      })
      .expect(200);

    expect(streamService.stream).toHaveBeenCalledWith('evt-header');
  });
});

describe('EnvironmentDashboardController readonly HTTP smoke', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [EnvironmentDashboardController],
      providers: [
        EnvironmentDashboardService,
        EnvironmentDashboardSelfCheckService,
        EnvironmentEventBusService,
        EnvironmentEventMaterializer,
        EnvironmentEventStreamService,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('serves the real aggregate snapshot and readonly self-check over HTTP', async () => {
    const snapshotResponse = await request(app.getHttpServer())
      .get('/system/environment/dashboard')
      .expect(200);

    expect(
      snapshotResponse.body.data.sites.map((site: { id: string }) => site.id),
    ).toEqual(['local-dev', 'nas-prod', 'tencent-cloud', 'r4se']);
    expect(JSON.stringify(snapshotResponse.body.data)).toContain('unwired');

    const selfCheckResponse = await request(app.getHttpServer())
      .post('/system/environment/self-check')
      .expect(200);

    expect(selfCheckResponse.body.data.sites).toHaveLength(4);
  });
});
