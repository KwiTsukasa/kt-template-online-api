import type { INestApplication } from '@nestjs/common';

import { Test } from '@nestjs/testing';
import { of } from 'rxjs';
import * as request from 'supertest';
import { AdminSuperGuard } from '../../../src/modules/admin/identity/auth/presentation/admin-super.guard';
import { JwtAuthGuard } from '../../../src/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { AdminNoticeController } from '../../../src/modules/admin/platform-config/notice/admin-notice.controller';
import { AdminNoticeEventStreamService } from '../../../src/modules/admin/platform-config/notice/admin-notice-event-stream.service';
import { AdminNoticeService } from '../../../src/modules/admin/platform-config/notice/admin-notice.service';

describe('AdminNoticeController', () => {
  let app: INestApplication;
  let currentRoles: string[];
  const noticeService = {
    getUnreadCount: jest.fn(),
    markReadBatch: jest.fn(),
    page: jest.fn(),
  };
  const eventStream = {
    stream: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminNoticeController],
      providers: [
        {
          provide: AdminNoticeService,
          useValue: noticeService,
        },
        {
          provide: AdminNoticeEventStreamService,
          useValue: eventStream,
        },
        AdminSuperGuard,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: jest.fn((context) => {
          context.switchToHttp().getRequest().adminUser = {
            roles: currentRoles.map((roleCode) => ({
              isDeleted: false,
              roleCode,
              status: 1,
            })),
          };
          return true;
        }),
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    currentRoles = ['super'];
    jest.clearAllMocks();
    eventStream.stream.mockReturnValue(
      of({
        data: {
          message: 'snapshot-required',
          observedAt: '2026-08-18T00:00:00.000Z',
        },
        id: 'notice-initial',
        type: 'snapshot-required',
      }),
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  it('passes event notice filters through the HTTP list endpoint', async () => {
    noticeService.page.mockResolvedValueOnce({
      items: [
        {
          eventType: 'qqbot.account.offline',
          id: 'notice-1',
          occurrenceCount: 3,
          severity: 'error',
          source: 'qqbot',
          status: 1,
          title: 'QQBot 账号已下线：1914728559',
        },
      ],
      total: 1,
    });

    const response = await request(app.getHttpServer())
      .get('/system/notice/list')
      .query({
        eventType: 'qqbot.account.offline',
        severity: 'error',
        source: 'qqbot',
        status: 1,
      })
      .expect(200);

    expect(noticeService.page).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'qqbot.account.offline',
        severity: 'error',
        source: 'qqbot',
        status: '1',
      }),
    );
    expect(response.body).toEqual({
      code: 200,
      data: {
        items: [
          expect.objectContaining({
            eventType: 'qqbot.account.offline',
            occurrenceCount: 3,
            severity: 'error',
            source: 'qqbot',
          }),
        ],
        total: 1,
      },
      msg: '操作成功',
    });
  });

  it('rejects event notice access for non-super admin users', async () => {
    currentRoles = ['admin'];

    await request(app.getHttpServer()).get('/system/notice/list').expect(403);
    expect(noticeService.page).not.toHaveBeenCalled();
  });

  it('marks selected unread notices as read through one HTTP request', async () => {
    const ids = ['2041700000000300001', '2041700000000300002'];
    noticeService.markReadBatch.mockResolvedValueOnce({ updated: 2 });

    const response = await request(app.getHttpServer())
      .post('/system/notice/read/batch')
      .send({ ids })
      .expect(201);

    expect(noticeService.markReadBatch).toHaveBeenCalledWith(ids);
    expect(response.body).toEqual({
      code: 200,
      data: { updated: 2 },
      msg: '操作成功',
    });
  });

  it('returns the unread count through the authenticated HTTP endpoint', async () => {
    noticeService.getUnreadCount.mockResolvedValueOnce(9);

    const response = await request(app.getHttpServer())
      .get('/system/notice/unread-count')
      .expect(200);

    expect(response.body).toEqual({
      code: 200,
      data: { count: 9 },
      msg: '操作成功',
    });
  });

  it('streams realtime changes through authenticated SSE with replay cursor', async () => {
    await request(app.getHttpServer())
      .get('/system/notice/events/stream?lastEventId=query-event')
      .set('Last-Event-ID', 'header-event')
      .buffer(true)
      .parse((response, callback) => {
        response.once('data', () => callback(null, 'ok'));
      })
      .expect('content-type', /text\/event-stream/)
      .expect('x-accel-buffering', 'no')
      .expect(200);

    expect(eventStream.stream).toHaveBeenCalledWith('header-event');
  });

  it('does not expose manual notice creation endpoint', async () => {
    await request(app.getHttpServer())
      .post('/system/notice/save')
      .send({
        content: 'manual',
        title: 'manual',
      })
      .expect(404);
  });
});
