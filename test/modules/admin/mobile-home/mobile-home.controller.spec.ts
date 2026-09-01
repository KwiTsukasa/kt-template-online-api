import type { INestApplication } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AdminSuperGuard } from '../../../../src/modules/admin/identity/auth/presentation/admin-super.guard';
import { JwtAuthGuard } from '../../../../src/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { MobileHomeService } from '../../../../src/modules/admin/platform-config/mobile-home/application/mobile-home.service';
import { MobileHomeController } from '../../../../src/modules/admin/platform-config/mobile-home/presentation/mobile-home.controller';

describe('MobileHomeController', () => {
  let app: INestApplication;
  let apiUrl: string;
  const service = {
    assist: jest.fn(),
    callHomeService: jest.fn(),
    getBootstrap: jest.fn(),
    getGameSnapshot: jest.fn(),
    getHomeSnapshot: jest.fn(),
    submitGamePin: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MobileHomeController],
      providers: [{ provide: MobileHomeService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminSuperGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    apiUrl = await app.getUrl();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service.getBootstrap.mockResolvedValue({
      environment: {
        actions: [],
        events: [
          {
            eventId: 'evt-home-assistant-1',
            observedAt: '2026-08-27T06:00:00.000Z',
            severity: 'ok',
            siteId: 'nas-prod',
            sourceKind: 'local',
            summary: 'Home Assistant 连接正常',
            topic: 'kt/env/nas-prod/home-assistant/event',
            type: 'environment-event',
          },
        ],
        generatedAt: '2026-08-27T06:00:00.000Z',
        refreshedAt: '2026-08-27T06:00:00.000Z',
        sites: [],
        summary: { byStatus: {}, totalSignals: 0 },
        topology: { edges: [], nodes: [] },
      },
      notices: {
        items: [
          {
            content: '环境状态已更新',
            createTime: new Date(2026, 7, 27, 14, 0, 0),
            eventType: 'environment.changed',
            id: '2041700000000300001',
            isTop: true,
            lastSeenAt: new Date(2026, 7, 27, 14, 1, 0),
            occurrenceCount: 2,
            severity: 'warn',
            source: 'environment-dashboard',
            status: 1,
            summary: '一项环境信号发生变化',
            title: '环境提醒',
          },
        ],
        total: 1,
        unreadCount: 3,
      },
    });
    service.getHomeSnapshot.mockResolvedValue({
      activities: [],
      areas: [],
      connected: true,
      energy: [],
      entities: [],
      generatedAt: '2026-08-31T10:00:00.000Z',
      scenes: [],
    });
    service.callHomeService.mockResolvedValue({
      requestId: 'request-light-0001',
    });
    service.assist.mockResolvedValue({
      continueConversation: false,
      responseType: 'action_done',
      speech: '已打开客厅主灯',
    });
    service.getGameSnapshot.mockResolvedValue({
      apps: [{ id: 'app-1', name: 'Steam Big Picture' }],
      displayResolution: '3200x1440',
      generatedAt: '2026-08-31T10:00:00.000Z',
      host: '10.66.66.4',
      httpsPort: 38994,
      managementReady: true,
      streamPort: 38999,
      virtualGamepadReady: true,
      virtualDisplayReady: true,
    });
    service.submitGamePin.mockResolvedValue({ accepted: true });
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps the bootstrap route behind the existing Admin super boundary', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, MobileHomeController)).toEqual([
      JwtAuthGuard,
      AdminSuperGuard,
    ]);
  });

  it('returns one no-store Vben snapshot with explicit datetime fields', async () => {
    const response = await request(apiUrl)
      .get('/system/mobile-home/bootstrap')
      .expect(200)
      .expect('Cache-Control', 'no-store');

    expect(response.body).toMatchObject({
      code: 200,
      data: {
        environment: {
          generatedAt: '2026-08-27T06:00:00.000Z',
        },
        notices: {
          total: 1,
          unreadCount: 3,
        },
      },
    });
    expect(response.body).not.toHaveProperty('err');
    expect(response.body.data.environment.events).toEqual([
      expect.objectContaining({ eventId: 'evt-home-assistant-1' }),
    ]);
    expect(response.body.data.environment.events[0]).not.toHaveProperty('id');
    expect(response.body.data.notices.items[0].createTime).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    );
    expect(response.body.data.notices.items[0].lastSeenAt).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    );
    expect(service.getBootstrap).toHaveBeenCalledTimes(1);
  });

  it('returns no-store Home Assistant and Sunshine snapshots', async () => {
    const home = await request(apiUrl)
      .get('/system/mobile-home/home')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    const game = await request(apiUrl)
      .get('/system/mobile-home/game')
      .expect(200)
      .expect('Cache-Control', 'no-store');

    expect(home.body.data).toMatchObject({ connected: true, entities: [] });
    expect(game.body.data).toMatchObject({
      apps: [{ id: 'app-1', name: 'Steam Big Picture' }],
      displayResolution: '3200x1440',
      host: '10.66.66.4',
      httpsPort: 38994,
      streamPort: 38999,
      virtualGamepadReady: true,
      virtualDisplayReady: true,
    });
  });

  it('forwards allowlisted Home writes, Assist text and Sunshine PIN requests', async () => {
    await request(apiUrl)
      .post('/system/mobile-home/home/service')
      .send({
        data: { brightness: 180 },
        domain: 'light',
        entityId: 'light.living_room',
        requestId: 'request-light-0001',
        service: 'turn_on',
      })
      .expect(201);
    await request(apiUrl)
      .post('/system/mobile-home/home/assist')
      .send({ text: '打开客厅主灯' })
      .expect(201);
    await request(apiUrl)
      .post('/system/mobile-home/game/pin')
      .send({ name: 'KwiCore', pin: '1234' })
      .expect(201);

    expect(service.callHomeService).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'light.living_room' }),
    );
    expect(service.assist).toHaveBeenCalledWith({ text: '打开客厅主灯' });
    expect(service.submitGamePin).toHaveBeenCalledWith('1234', 'KwiCore');
  });
});
