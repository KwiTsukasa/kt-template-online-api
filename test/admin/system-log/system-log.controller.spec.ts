import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { JwtAuthGuard } from '../../../src/admin/auth/jwt-auth.guard';
import { SystemLogController } from '../../../src/admin/system-log/system-log.controller';
import { SystemLogService } from '../../../src/admin/system-log/system-log.service';
import { ToolsService } from '../../../src/common';

describe('SystemLogController', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SystemLogController],
      providers: [
        SystemLogService,
        ToolsService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: jest.fn(() => true),
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns Loki status with the real system log service fallback', async () => {
    const response = await request(app.getHttpServer())
      .get('/system/logs/status')
      .expect(200);

    expect(response.body).toEqual({
      code: 200,
      data: {
        app: 'kt-template-online-api',
        configured: false,
        env: 'development',
        selector: '{app="kt-template-online-api",env="development"}',
      },
      msg: '操作成功',
    });
  });

  it('returns an empty page when Loki is not configured', async () => {
    const response = await request(app.getHttpServer())
      .get('/system/logs')
      .query({ pageNo: 1, pageSize: 20 })
      .expect(200);

    expect(response.body).toEqual({
      code: 200,
      data: {
        items: [],
        total: 0,
      },
      msg: '操作成功',
    });
  });
});
