import { Readable } from 'node:stream';
import { BadRequestException, HttpStatus } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as request from 'supertest';
import { MinioClientService } from '../../src/modules/asset/application/asset-minio.service';
import { BlogLive2DAssetService } from '../../src/modules/asset/application/blog-live2d-asset.service';
import { BlogLive2DAssetController } from '../../src/modules/asset/contract/blog-live2d-asset.controller';

/**
 * Creates the config facade used by Blog Live2D asset tests.
 * @param overrides - Runtime config values that should replace the default fixture.
 * @returns ConfigService-compatible object for direct service construction.
 */
function createConfig(overrides: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    BLOG_LIVE2D_ALLOWED_ORIGINS:
      'https://blog.kwitsukasa.top,http://localhost:5999',
    BLOG_LIVE2D_BUCKET: 'kt-template-online',
    BLOG_LIVE2D_PREFIX: 'blog/live2d/pio',
    ...overrides,
  };

  return {
    get: jest.fn((key: string) => values[key]),
  };
}

/**
 * Creates a MinIO client facade that records requested object names.
 * @returns Mocked MinIO client service used by the service and controller tests.
 */
function createMinio() {
  return {
    getDefaultBucket: jest.fn(() => 'kt-template-online'),
    getObject: jest.fn(async (objectName: string, bucketName?: string) => {
      const isJson = objectName.endsWith('.json');
      return {
        bucketName,
        objectName,
        stat: {
          etag: 'etag-1',
          lastModified: new Date('2026-07-04T00:00:00.000Z'),
          metaData: {
            'content-type': isJson ? 'application/json' : 'image/png',
          },
          size: 2,
        },
        stream: Readable.from([isJson ? '{"ok":true}' : 'ok']),
      };
    }),
  };
}

describe('BlogLive2DAssetService', () => {
  it('allows configured blog referer', () => {
    const service = new BlogLive2DAssetService(
      createMinio() as never,
      createConfig() as never,
    );

    expect(() =>
      service.assertAllowedRequest(
        'https://blog.kwitsukasa.top/post/1',
        undefined,
      ),
    ).not.toThrow();
  });

  it('allows configured origin when referer is absent', () => {
    const service = new BlogLive2DAssetService(
      createMinio() as never,
      createConfig() as never,
    );

    expect(() =>
      service.assertAllowedRequest(undefined, 'http://localhost:5999'),
    ).not.toThrow();
  });

  it('rejects external referer', () => {
    const service = new BlogLive2DAssetService(
      createMinio() as never,
      createConfig() as never,
    );

    expect(() =>
      service.assertAllowedRequest('https://example.com/hotlink', undefined),
    ).toThrow(BadRequestException);
  });

  it('rejects missing or malformed request source', () => {
    const service = new BlogLive2DAssetService(
      createMinio() as never,
      createConfig() as never,
    );

    expect(() => service.assertAllowedRequest(undefined, undefined)).toThrow(
      BadRequestException,
    );
    expect(() => service.assertAllowedRequest('not-a-url', undefined)).toThrow(
      BadRequestException,
    );
  });

  it('maps the root catalog below the configured MinIO prefix', async () => {
    const minio = createMinio();
    const service = new BlogLive2DAssetService(
      minio as never,
      createConfig() as never,
    );

    await service.getCatalogObject();

    expect(minio.getObject).toHaveBeenCalledWith(
      'blog/live2d/pio/catalog.json',
      'kt-template-online',
    );
  });

  it('maps nested runtime files below the configured MinIO prefix', async () => {
    const minio = createMinio();
    const service = new BlogLive2DAssetService(
      minio as never,
      createConfig() as never,
    );

    await service.getRuntimeObject('v1', [
      'assets',
      'model',
      'motions',
      'breath1.motion3.json',
    ]);

    expect(minio.getObject).toHaveBeenCalledWith(
      'blog/live2d/pio/v1/assets/model/motions/breath1.motion3.json',
      'kt-template-online',
    );
  });

  it('maps missing MinIO runtime objects to HTTP 404', async () => {
    const minio = createMinio();
    minio.getObject.mockRejectedValueOnce(
      Object.assign(new Error('Not Found'), { code: 'NotFound' }),
    );
    const service = new BlogLive2DAssetService(
      minio as never,
      createConfig() as never,
    );

    await expect(
      service.getRuntimeObject('v1', ['manifest.json']),
    ).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
      message: 'Live2D runtime asset not found',
    });
    expect(minio.getObject).toHaveBeenCalledWith(
      'blog/live2d/pio/v1/manifest.json',
      'kt-template-online',
    );
  });

  it('rejects runtime path traversal before touching MinIO', async () => {
    const minio = createMinio();
    const service = new BlogLive2DAssetService(
      minio as never,
      createConfig() as never,
    );

    await expect(
      service.getRuntimeObject('v1', ['%252e%252e', 'secret.env']),
    ).rejects.toThrow(BadRequestException);
    expect(minio.getObject).not.toHaveBeenCalled();
  });

  it.each([
    ['absolute URL', 'v1', ['https://evil.test', 'texture.png']],
    ['absolute path', 'v1', ['/textures', 'texture.png']],
    ['backslash path', 'v1', ['textures\\texture.png']],
    ['dot segment', 'v1', ['.', 'texture.png']],
    ['version traversal', '../v1', ['texture.png']],
  ])(
    'rejects unsafe %s runtime paths before touching MinIO',
    async (_name, version, objectPath) => {
      const minio = createMinio();
      const service = new BlogLive2DAssetService(
        minio as never,
        createConfig() as never,
      );

      await expect(service.getRuntimeObject(version, objectPath)).rejects.toThrow(
        BadRequestException,
      );
      expect(minio.getObject).not.toHaveBeenCalled();
    },
  );
});

describe('BlogLive2DAssetController', () => {
  it('streams the Pio root catalog for allowed blog requests', async () => {
    const minio = createMinio();
    const moduleRef = await Test.createTestingModule({
      controllers: [BlogLive2DAssetController],
      providers: [
        BlogLive2DAssetService,
        {
          provide: MinioClientService,
          useValue: minio,
        },
        {
          provide: ConfigService,
          useValue: createConfig(),
        },
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    try {
      const response = await request(app.getHttpServer())
        .get('/blog/live2d/pio/catalog.json')
        .set('Referer', 'https://blog.kwitsukasa.top/post/1')
        .expect(HttpStatus.OK);

      expect(response.body).toEqual({ ok: true });
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.headers['cache-control']).toBe('public, max-age=60');
      expect(minio.getObject).toHaveBeenCalledWith(
        'blog/live2d/pio/catalog.json',
        'kt-template-online',
      );
    } finally {
      await app.close();
    }
  });

  it('streams nested Pio runtime assets for allowed blog requests', async () => {
    const minio = createMinio();
    const moduleRef = await Test.createTestingModule({
      controllers: [BlogLive2DAssetController],
      providers: [
        BlogLive2DAssetService,
        {
          provide: MinioClientService,
          useValue: minio,
        },
        {
          provide: ConfigService,
          useValue: createConfig(),
        },
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    try {
      const response = await request(app.getHttpServer())
        .get('/blog/live2d/pio/v1/assets/textures/default-costume.png')
        .set('Referer', 'https://blog.kwitsukasa.top/post/1')
        .expect(HttpStatus.OK);

      expect(Buffer.from(response.body).toString()).toBe('ok');
      expect(response.headers['content-type']).toContain('image/png');
      expect(response.headers['cache-control']).toBe(
        'public, max-age=31536000, immutable',
      );
      expect(minio.getObject).toHaveBeenCalledWith(
        'blog/live2d/pio/v1/assets/textures/default-costume.png',
        'kt-template-online',
      );
    } finally {
      await app.close();
    }
  });

  it('rejects external hotlink requests before streaming assets', async () => {
    const minio = createMinio();
    const moduleRef = await Test.createTestingModule({
      controllers: [BlogLive2DAssetController],
      providers: [
        BlogLive2DAssetService,
        {
          provide: MinioClientService,
          useValue: minio,
        },
        {
          provide: ConfigService,
          useValue: createConfig(),
        },
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    try {
      await request(app.getHttpServer())
        .get('/blog/live2d/pio/v1/assets/model/pio.moc-reconstructed.model3.json')
        .set('Referer', 'https://example.com/post/1')
        .expect(HttpStatus.BAD_REQUEST);
      expect(minio.getObject).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
