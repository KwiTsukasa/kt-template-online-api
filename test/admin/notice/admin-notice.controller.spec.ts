import type { INestApplication } from '@nestjs/common';

import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AdminSuperGuard } from '../../../src/admin/auth/admin-super.guard';
import { JwtAuthGuard } from '../../../src/admin/auth/jwt-auth.guard';
import { AdminNoticeController } from '../../../src/admin/notice/admin-notice.controller';
import { AdminNoticeService } from '../../../src/admin/notice/admin-notice.service';

describe('AdminNoticeController', () => {
  let app: INestApplication;
  let currentRoles: string[];
  const noticeService = {
    page: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminNoticeController],
      providers: [
        {
          provide: AdminNoticeService,
          useValue: noticeService,
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
