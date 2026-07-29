import { PassThrough, Readable } from 'node:stream';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { IS_PUBLIC_KEY } from '../../src/common';
import { MinioClientService } from '../../src/modules/asset/application/asset-minio.service';
import { BlogPublicAssetController } from '../../src/modules/blog/contract/blog-public-asset.controller';

const sha256 = 'a'.repeat(64);

describe('BlogPublicAssetController', () => {
  let app: INestApplication;
  const minioClientService = {
    getObject: jest.fn(),
    statObject: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [BlogPublicAssetController],
      providers: [
        {
          provide: MinioClientService,
          useValue: minioClientService,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    minioClientService.getObject.mockReset();
    minioClientService.statObject.mockReset();
    minioClientService.getObject.mockImplementation(async (objectName) => ({
      objectName,
      stat: {
        lastModified: new Date(),
        metaData: {
          'content-type': 'image/png',
        },
        size: 5,
      },
      stream: Readable.from(Buffer.from('image')),
    }));
    minioClientService.statObject.mockResolvedValue({
      lastModified: new Date(),
      metaData: {
        'content-type': 'image/png',
      },
      size: 5,
    });
  });

  it('streams GET and metadata-only HEAD from the fixed content-addressed prefix', async () => {
    const path = `/blog/asset/${sha256}/cover.png`;

    await request(app.getHttpServer())
      .get(path)
      .expect(200)
      .expect('Content-Type', /image\/png/)
      .expect('Content-Length', '5')
      .expect('Cache-Control', 'public, max-age=31536000, immutable')
      .expect((response) => {
        expect(response.body).toEqual(Buffer.from('image'));
      });

    await request(app.getHttpServer())
      .head(path)
      .expect(200)
      .expect('Content-Type', /image\/png/)
      .expect('Content-Length', '5')
      .expect('Cache-Control', 'public, max-age=31536000, immutable');

    expect(minioClientService.getObject).toHaveBeenNthCalledWith(
      1,
      `blog/migrated/${sha256}/cover.png`,
    );
    expect(minioClientService.getObject).toHaveBeenCalledTimes(1);
    expect(minioClientService.statObject).toHaveBeenCalledWith(
      `blog/migrated/${sha256}/cover.png`,
    );
  });

  it.each([
    '/blog/asset/not-a-hash/cover.png',
    `/blog/asset/${sha256}/..`,
    `/blog/asset/${sha256}/%2e%2e%2fsecret`,
    `/blog/asset/${sha256}/bad%5cname.png`,
  ])('rejects invalid hash or basename %s', async (path) => {
    await request(app.getHttpServer())
      .get(path)
      .expect((response) => {
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.status).toBeLessThan(500);
      });
  });

  it('does not expose POST or arbitrary bucket/key input', async () => {
    await request(app.getHttpServer())
      .post(`/blog/asset/${sha256}/cover.png`)
      .send({
        bucketName: 'other',
        objectName: '../../secret',
      })
      .expect(404);
  });

  it('manages MinIO source errors instead of leaving an unhandled stream error', async () => {
    const source = new PassThrough();
    source.on('error', () => undefined);
    minioClientService.getObject.mockResolvedValueOnce({
      stat: {
        metaData: {
          'content-type': 'image/png',
        },
        size: 5,
      },
      stream: source,
    });
    const response = Object.assign(new PassThrough(), {
      setHeader: jest.fn(),
    });
    const controller = app.get(BlogPublicAssetController);

    const transfer = controller.getAsset(
      sha256,
      'cover.png',
      response as never,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    const hasManagedErrorListener = source.listenerCount('error') > 1;
    source.destroy(new Error('MinIO stream failed'));
    const transferError = await transfer.then(
      () => undefined,
      (error: unknown) => error,
    );
    response.destroy();

    expect(hasManagedErrorListener).toBe(true);
    expect(transferError).toEqual(new Error('MinIO stream failed'));
  });

  it('destroys the MinIO source when the client response aborts', async () => {
    const source = new PassThrough();
    minioClientService.getObject.mockResolvedValueOnce({
      stat: {
        metaData: {
          'content-type': 'image/png',
        },
        size: 5,
      },
      stream: source,
    });
    const response = Object.assign(new PassThrough(), {
      setHeader: jest.fn(),
    });
    response.on('error', () => undefined);
    const controller = app.get(BlogPublicAssetController);

    const transfer = controller.getAsset(
      sha256,
      'cover.png',
      response as never,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    response.destroy(new Error('client aborted'));
    await transfer.catch(() => undefined);
    const sourceWasDestroyed = source.destroyed;
    if (!source.destroyed) source.destroy();

    expect(sourceWasDestroyed).toBe(true);
  });

  it('marks both public asset handlers as explicit public routes', () => {
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        BlogPublicAssetController.prototype.getAsset,
      ),
    ).toBe(true);
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        BlogPublicAssetController.prototype.headAsset,
      ),
    ).toBe(true);
  });
});
