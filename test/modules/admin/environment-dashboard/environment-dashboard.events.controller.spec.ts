import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { of } from 'rxjs';
import * as request from 'supertest';
import { JwtAuthGuard } from '../../../../src/modules/admin/identity/auth/jwt-auth.guard';
import { EnvironmentDashboardService } from '../../../../src/modules/admin/platform-config/environment-dashboard/application/environment-dashboard.service';
import { EnvironmentDashboardSelfCheckService } from '../../../../src/modules/admin/platform-config/environment-dashboard/application/environment-dashboard-self-check.service';
import { EnvironmentEventStreamService } from '../../../../src/modules/admin/platform-config/environment-dashboard/application/environment-event-stream.service';
import { EnvironmentDashboardController } from '../../../../src/modules/admin/platform-config/environment-dashboard/presentation/environment-dashboard.controller';

describe('EnvironmentDashboardController SSE boundary', () => {
  let app: INestApplication;
  const dashboardService = {
    getDashboard: jest.fn(),
  };
  const selfCheckService = {
    runSelfCheck: jest.fn(),
  };
  const streamService = {
    stream: jest.fn(() =>
      of({
        data: {
          message: 'snapshot-required',
          observedAt: '2026-06-18T08:00:00.000Z',
        },
        id: 'snapshot-required-1',
        type: 'snapshot-required',
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

  it('streams through EnvironmentEventStreamService without dashboard polling', async () => {
    await request(app.getHttpServer())
      .get('/system/environment/events/stream?lastEventId=evt-query')
      .buffer(true)
      .parse((res, callback) => {
        res.once('data', () => callback(null, 'ok'));
      })
      .expect('content-type', /text\/event-stream/)
      .expect(200);

    expect(streamService.stream).toHaveBeenCalledWith('evt-query');
    expect(dashboardService.getDashboard).not.toHaveBeenCalled();
  });
});
