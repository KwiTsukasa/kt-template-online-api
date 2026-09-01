import * as request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtAuthGuard } from '../../../src/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { MediaGovernancePermissionGuard } from '../../../src/modules/admin/media-governance/presentation/media-governance-permission.guard';
import { MediaScrapeValidationService } from '../../../src/modules/admin/media-scrape-validation/application/media-scrape-validation.service';
import {
  MediaScrapeValidationController,
  MediaScrapeValidationInternalController,
} from '../../../src/modules/admin/media-scrape-validation/presentation/media-scrape-validation.controller';
import { MediaScrapeValidationInternalGuard } from '../../../src/modules/admin/media-scrape-validation/presentation/media-scrape-validation-internal.guard';

describe('MediaScrapeValidationController HTTP', () => {
  let app: INestApplication;
  const service = {
    claimNext: jest.fn(),
    complete: jest.fn(),
    detail: jest.fn(),
    page: jest.fn(),
    requestRecheck: jest.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        MediaScrapeValidationController,
        MediaScrapeValidationInternalController,
      ],
      providers: [
        { provide: MediaScrapeValidationService, useValue: service },
        { provide: JwtAuthGuard, useValue: { canActivate: () => true } },
        {
          provide: MediaGovernancePermissionGuard,
          useValue: { canActivate: () => true },
        },
        {
          provide: MediaScrapeValidationInternalGuard,
          useValue: { canActivate: () => true },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(MediaGovernancePermissionGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(MediaScrapeValidationInternalGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('serves the independent page and revision-bound recheck endpoints', async () => {
    const record = {
      id: 'media-scrape-http-0001',
      revision: 4,
      status: 'issues',
      taskId: 'media-task-http-0001',
    };
    service.page.mockResolvedValue({ items: [record], total: 1 });
    service.requestRecheck.mockResolvedValue({
      ...record,
      revision: 5,
      status: 'pending',
    });

    const page = await request(app.getHttpServer())
      .get('/media-scrape-validation/page?pageNo=1&pageSize=20')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(page.body.data.items).toEqual([record]);

    const recheck = await request(app.getHttpServer())
      .post(`/media-scrape-validation/${record.id}/recheck`)
      .send({ expectedRevision: 4 })
      .expect(201)
      .expect('Cache-Control', 'no-store');
    expect(recheck.body.data).toMatchObject({ revision: 5, status: 'pending' });
    expect(service.requestRecheck).toHaveBeenCalledWith(record.id, {
      expectedRevision: 4,
    });
  });

  it('claims and completes scrape results through the internal API only', async () => {
    const record = {
      id: 'media-scrape-http-0002',
      revision: 7,
      status: 'running',
    };
    service.claimNext.mockResolvedValue(record);
    service.complete.mockResolvedValue({
      ...record,
      revision: 8,
      status: 'healthy',
    });

    await request(app.getHttpServer())
      .post('/internal/media-scrape-validation/claims/next')
      .expect(201);
    await request(app.getHttpServer())
      .post(`/internal/media-scrape-validation/${record.id}/results`)
      .send({
        evidenceSha256: 'a'.repeat(64),
        expectedRevision: 7,
        issues: [],
        status: 'healthy',
        summary: 'NAS 刮削校验正常',
      })
      .expect(201);
    expect(service.complete).toHaveBeenCalledWith(
      record.id,
      expect.objectContaining({ status: 'healthy' }),
    );
  });
});
