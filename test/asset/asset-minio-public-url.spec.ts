import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MinioService } from 'nestjs-minio-client';
import * as request from 'supertest';
import { ToolsService } from '../../src/common';
import { MinioClientService } from '../../src/modules/asset/application/asset-minio.service';
import { MinioClientController } from '../../src/modules/asset/contract/asset-minio.controller';
import { JwtAuthGuard } from '../../src/modules/admin/identity/auth/presentation/jwt-auth.guard';

const INTERNAL_MINIO_ENDPOINT = 'http://10.22.52.201:9000';

function createMinioClient() {
  return {
    bucketExists: jest.fn(async () => true),
    putObject: jest.fn(async () => ({ etag: 'etag-1' })),
    presignedGetObject: jest.fn(
      async () =>
        `${INTERNAL_MINIO_ENDPOINT}/kt-template-online/uploads/demo.txt`,
    ),
  };
}

describe('MinioClientService same-origin public URL', () => {
  it('returns only a root-relative API download URL after upload', async () => {
    const client = createMinioClient();
    const service = new MinioClientService(
      { client } as unknown as MinioService,
      {
        get: jest.fn((key: string) => {
          if (key === 'MINIO_ENDPOINT') return '10.22.52.201';
          if (key === 'MINIO_PORT') return '9000';
          if (key === 'MINIO_BUCKET') return 'kt-template-online';
          return undefined;
        }),
      } as unknown as ConfigService,
    );

    const result = await service.uploadObject({
      bucketName: 'demo-bucket',
      objectName: 'uploads/folder name/demo.txt',
      file: {
        buffer: Buffer.from('demo'),
        mimetype: 'text/plain',
        originalname: 'demo.txt',
        size: 4,
      },
    });

    expect(result.url).toBe(
      '/api/minio/download?objectName=uploads%2Ffolder+name%2Fdemo.txt&bucketName=demo-bucket',
    );
    expect(result.url).not.toContain(INTERNAL_MINIO_ENDPOINT);
    expect(client.presignedGetObject).not.toHaveBeenCalled();
  });

  it('rejects the media descriptor private bucket from generic routes', () => {
    const service = new MinioClientService(
      { client: createMinioClient() } as unknown as MinioService,
      { get: jest.fn(() => undefined) } as unknown as ConfigService,
    );

    expect(() =>
      service.getBucketName('kt-media-governance-private'),
    ).toThrow('该 Bucket 只能通过所属领域服务访问');
  });
});

describe('GET /minio/url same-origin contract', () => {
  let app: INestApplication;
  let apiUrl: string;
  const minioClientService = {
    getSameOriginDownloadUrl: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MinioClientController],
      providers: [
        ToolsService,
        {
          provide: MinioClientService,
          useValue: minioClientService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    apiUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the same-origin download route and never the MinIO endpoint', async () => {
    const sameOriginUrl =
      '/api/minio/download?objectName=uploads%2Fdemo.txt&bucketName=demo-bucket';
    minioClientService.getSameOriginDownloadUrl.mockReturnValue(sameOriginUrl);

    const response = await request(apiUrl)
      .get('/minio/url')
      .query({
        objectName: 'uploads/demo.txt',
        bucketName: 'demo-bucket',
      })
      .expect(200);

    expect(minioClientService.getSameOriginDownloadUrl).toHaveBeenCalledWith(
      'uploads/demo.txt',
      'demo-bucket',
    );
    expect(response.body).toEqual({
      code: 200,
      data: sameOriginUrl,
      msg: '操作成功',
    });
    expect(JSON.stringify(response.body)).not.toContain(
      INTERNAL_MINIO_ENDPOINT,
    );
  });
});
