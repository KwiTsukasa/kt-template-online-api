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
    getBootstrap: jest.fn(),
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
        events: [],
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
    expect(response.body.data.notices.items[0].createTime).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    );
    expect(response.body.data.notices.items[0].lastSeenAt).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    );
    expect(service.getBootstrap).toHaveBeenCalledTimes(1);
  });
});
