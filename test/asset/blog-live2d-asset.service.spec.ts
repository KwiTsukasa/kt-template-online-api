import { Readable } from 'node:stream';
import { BadRequestException, HttpStatus } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import * as request from 'supertest';
import { ClientIpService, PublicRateLimitService } from '../../src/common';
import { MinioClientService } from '../../src/modules/asset/application/asset-minio.service';
import { BlogLive2DAssetService } from '../../src/modules/asset/application/blog-live2d-asset.service';
import { BlogLive2DAssetController } from '../../src/modules/asset/contract/blog-live2d-asset.controller';

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

function createClientIp(publicOrigin = 'https://nas4.kwitsukasa.top:45678') {
  return {
    getPublicOrigin: jest.fn(() => publicOrigin),
  };
}

function createHttpRequest(headers: Record<string, string> = {}) {
  return {
    headers,
    protocol: 'http',
  } as unknown as Request;
}

function createService(
  minio = createMinio(),
  config = createConfig(),
  clientIp = createClientIp(),
) {
  return new BlogLive2DAssetService(
    minio as never,
    config as never,
    clientIp as never,
  );
}

function createClientIpProvider() {
  return {
    provide: ClientIpService,
    useValue: createClientIp(),
  };
}

function createRateLimitProvider() {
  return {
    provide: PublicRateLimitService,
    useValue: {
      bindLive2DConcurrentLease: jest.fn().mockResolvedValue(undefined),
    },
  };
}

describe('BlogLive2DAssetService', () => {
  it('allows the trusted request-matching NATMap origin with its dynamic port', () => {
    const clientIp = createClientIp();
    const service = createService(createMinio(), createConfig(), clientIp);
    const req = createHttpRequest({
      host: 'nas4.kwitsukasa.top:45678',
      'x-forwarded-proto': 'https',
    });

    expect(() =>
      service.assertAllowedRequest(
        req,
        'https://nas4.kwitsukasa.top:45678/blog/post/1',
        undefined,
      ),
    ).not.toThrow();
    expect(clientIp.getPublicOrigin).toHaveBeenCalledWith(req);
  });

  it.each(['https://nas4.kwitsukasa.top', 'https://nas4.kwitsukasa.top:443'])(
    'rejects a NATMap origin without an explicit dynamic port: %s',
    (value) => {
      const service = createService(
        createMinio(),
        createConfig(),
        createClientIp(value),
      );

      expect(() =>
        service.assertAllowedRequest(
          createHttpRequest(),
          `${value}/blog/post/1`,
          undefined,
        ),
      ).toThrow(BadRequestException);
    },
  );

  it('does not trust a forged forwarded host or a retired configured origin', () => {
    const clientIp = createClientIp();
    const service = createService(createMinio(), createConfig(), clientIp);
    const req = createHttpRequest({
      host: 'nas4.kwitsukasa.top:45678',
      'x-forwarded-host': 'evil.example',
      'x-forwarded-proto': 'https',
    });

    expect(() =>
      service.assertAllowedRequest(
        req,
        'https://evil.example/hotlink',
        undefined,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      service.assertAllowedRequest(req, undefined, 'http://localhost:5999'),
    ).toThrow(BadRequestException);
  });

  it('allows the legacy blog referer', () => {
    const service = createService();

    expect(() =>
      service.assertAllowedRequest(
        createHttpRequest(),
        'https://blog.kwitsukasa.top/post/1',
        undefined,
      ),
    ).not.toThrow();
  });

  it('allows the legacy blog origin when referer is absent', () => {
    const service = createService();

    expect(() =>
      service.assertAllowedRequest(
        createHttpRequest(),
        undefined,
        'https://blog.kwitsukasa.top',
      ),
    ).not.toThrow();
  });

  it('rejects external referer', () => {
    const service = createService();

    expect(() =>
      service.assertAllowedRequest(
        createHttpRequest(),
        'https://example.com/hotlink',
        undefined,
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects missing or malformed request source', () => {
    const service = createService();
    const req = createHttpRequest();

    expect(() =>
      service.assertAllowedRequest(req, undefined, undefined),
    ).toThrow(BadRequestException);
    expect(() =>
      service.assertAllowedRequest(req, 'not-a-url', undefined),
    ).toThrow(BadRequestException);
  });

  it('maps the root catalog below the configured MinIO prefix', async () => {
    const minio = createMinio();
    const service = createService(minio);

    await service.getCatalogObject('pio');

    expect(minio.getObject).toHaveBeenCalledWith(
      'blog/live2d/pio/catalog.json',
      'kt-template-online',
    );
  });

  it('maps nested MOC3 runtime files below the configured MinIO prefix', async () => {
    const minio = createMinio();
    const service = createService(minio);

    await service.getRuntimeObject('pio', 'moc3', [
      'assets',
      'model',
      'motions',
      'breath1.motion3.json',
    ]);

    expect(minio.getObject).toHaveBeenCalledWith(
      'blog/live2d/pio/moc3/assets/model/motions/breath1.motion3.json',
      'kt-template-online',
    );
  });

  it('maps the fixed MOC family entry below the configured MinIO prefix', async () => {
    const minio = createMinio();
    const service = createService(minio);

    await service.getRuntimeObject('pio', 'moc', ['index.json']);

    expect(minio.getObject).toHaveBeenCalledWith(
      'blog/live2d/pio/moc/index.json',
      'kt-template-online',
    );
  });

  it('maps the fixed MOC texture manifest below the configured MinIO prefix', async () => {
    const minio = createMinio();
    const service = createService(minio);

    await service.getRuntimeObject('pio', 'moc', ['textures', 'manifest.json']);

    expect(minio.getObject).toHaveBeenCalledWith(
      'blog/live2d/pio/moc/textures/manifest.json',
      'kt-template-online',
    );
  });

  it('maps missing MinIO runtime objects to HTTP 404', async () => {
    const minio = createMinio();
    minio.getObject.mockRejectedValueOnce(
      Object.assign(new Error('Not Found'), { code: 'NotFound' }),
    );
    const service = createService(minio);

    await expect(
      service.getRuntimeObject('pio', 'moc', ['manifest.json']),
    ).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
      message: 'Live2D runtime asset not found',
    });
    expect(minio.getObject).toHaveBeenCalledWith(
      'blog/live2d/pio/moc/manifest.json',
      'kt-template-online',
    );
  });

  it('rejects runtime path traversal before touching MinIO', async () => {
    const minio = createMinio();
    const service = createService(minio);

    await expect(
      service.getRuntimeObject('pio', 'moc', ['%252e%252e', 'secret.env']),
    ).rejects.toThrow(BadRequestException);
    expect(minio.getObject).not.toHaveBeenCalled();
  });

  it.each([
    ['absolute URL', 'moc', ['https://evil.test', 'texture.png']],
    ['absolute path', 'moc', ['/textures', 'texture.png']],
    ['backslash path', 'moc', ['textures\\texture.png']],
    ['dot segment', 'moc', ['.', 'texture.png']],
    ['family traversal', '../moc', ['texture.png']],
    ['custom version family', 'v1', ['manifest.json']],
  ])(
    'rejects unsafe %s runtime paths before touching MinIO',
    async (_name, family, objectPath) => {
      const minio = createMinio();
      const service = createService(minio);

      await expect(
        service.getRuntimeObject('pio', family, objectPath),
      ).rejects.toThrow(BadRequestException);
      expect(minio.getObject).not.toHaveBeenCalled();
    },
  );

  it('maps the Tia root catalog below the shared Blog Live2D root prefix', async () => {
    const minio = createMinio();
    const service = createService(
      minio,
      createConfig({ BLOG_LIVE2D_ROOT_PREFIX: 'blog/live2d' }),
    );

    await service.getCatalogObject('tia');

    expect(minio.getObject).toHaveBeenCalledWith(
      'blog/live2d/tia/catalog.json',
      'kt-template-online',
    );
  });

  it('maps Tia MOC runtime files below the Tia public root', async () => {
    const minio = createMinio();
    const service = createService(
      minio,
      createConfig({ BLOG_LIVE2D_ROOT_PREFIX: 'blog/live2d' }),
    );

    await service.getRuntimeObject('tia', 'moc', [
      'textures',
      'default-costume.png',
    ]);

    expect(minio.getObject).toHaveBeenCalledWith(
      'blog/live2d/tia/moc/textures/default-costume.png',
      'kt-template-online',
    );
  });

  it('rejects unsupported Live2D characters before touching MinIO', async () => {
    const minio = createMinio();
    const service = createService(
      minio,
      createConfig({ BLOG_LIVE2D_ROOT_PREFIX: 'blog/live2d' }),
    );

    await expect(
      service.getRuntimeObject('evil', 'moc', ['index.json']),
    ).rejects.toThrow(BadRequestException);
    expect(minio.getObject).not.toHaveBeenCalled();
  });
});

describe('BlogLive2DAssetController', () => {
  it('streams the Pio root catalog for allowed blog requests', async () => {
    const minio = createMinio();
    const moduleRef = await Test.createTestingModule({
      controllers: [BlogLive2DAssetController],
      providers: [
        BlogLive2DAssetService,
        createRateLimitProvider(),
        createClientIpProvider(),
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
    const rateLimitService = moduleRef.get(PublicRateLimitService);
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
      expect(rateLimitService.bindLive2DConcurrentLease).toHaveBeenCalledTimes(
        1,
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
        createRateLimitProvider(),
        createClientIpProvider(),
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
        .get('/blog/live2d/pio/moc3/assets/textures/default-costume.png')
        .set('Referer', 'https://blog.kwitsukasa.top/post/1')
        .expect(HttpStatus.OK);

      expect(Buffer.from(response.body).toString()).toBe('ok');
      expect(response.headers['content-type']).toContain('image/png');
      expect(response.headers['cache-control']).toBe(
        'public, max-age=31536000, immutable',
      );
      expect(minio.getObject).toHaveBeenCalledWith(
        'blog/live2d/pio/moc3/assets/textures/default-costume.png',
        'kt-template-online',
      );
    } finally {
      await app.close();
    }
  });

  it('streams fixed Pio MOC JSON assets with a short cache policy', async () => {
    const minio = createMinio();
    const moduleRef = await Test.createTestingModule({
      controllers: [BlogLive2DAssetController],
      providers: [
        BlogLive2DAssetService,
        createRateLimitProvider(),
        createClientIpProvider(),
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
        .get('/blog/live2d/pio/moc/index.json')
        .set('Referer', 'https://blog.kwitsukasa.top/post/1')
        .expect(HttpStatus.OK);

      expect(response.body).toEqual({ ok: true });
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.headers['cache-control']).toBe('public, max-age=60');
      expect(minio.getObject).toHaveBeenCalledWith(
        'blog/live2d/pio/moc/index.json',
        'kt-template-online',
      );
    } finally {
      await app.close();
    }
  });

  it('streams fixed Pio MOC texture manifests with a short cache policy', async () => {
    const minio = createMinio();
    const moduleRef = await Test.createTestingModule({
      controllers: [BlogLive2DAssetController],
      providers: [
        BlogLive2DAssetService,
        createRateLimitProvider(),
        createClientIpProvider(),
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
        .get('/blog/live2d/pio/moc/textures/manifest.json')
        .set('Referer', 'https://blog.kwitsukasa.top/post/1')
        .expect(HttpStatus.OK);

      expect(response.body).toEqual({ ok: true });
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.headers['cache-control']).toBe('public, max-age=60');
      expect(minio.getObject).toHaveBeenCalledWith(
        'blog/live2d/pio/moc/textures/manifest.json',
        'kt-template-online',
      );
    } finally {
      await app.close();
    }
  });

  it('streams Tia MOC assets for allowed blog requests', async () => {
    const minio = createMinio();
    const moduleRef = await Test.createTestingModule({
      controllers: [BlogLive2DAssetController],
      providers: [
        BlogLive2DAssetService,
        createRateLimitProvider(),
        createClientIpProvider(),
        {
          provide: MinioClientService,
          useValue: minio,
        },
        {
          provide: ConfigService,
          useValue: createConfig({ BLOG_LIVE2D_ROOT_PREFIX: 'blog/live2d' }),
        },
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    try {
      const response = await request(app.getHttpServer())
        .get('/blog/live2d/tia/moc/index.json')
        .set('Referer', 'https://blog.kwitsukasa.top/post/1')
        .expect(HttpStatus.OK);

      expect(response.body).toEqual({ ok: true });
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.headers['cache-control']).toBe('public, max-age=60');
      expect(minio.getObject).toHaveBeenCalledWith(
        'blog/live2d/tia/moc/index.json',
        'kt-template-online',
      );
    } finally {
      await app.close();
    }
  });

  it('rejects unsupported character requests before streaming assets', async () => {
    const minio = createMinio();
    const moduleRef = await Test.createTestingModule({
      controllers: [BlogLive2DAssetController],
      providers: [
        BlogLive2DAssetService,
        createRateLimitProvider(),
        createClientIpProvider(),
        {
          provide: MinioClientService,
          useValue: minio,
        },
        {
          provide: ConfigService,
          useValue: createConfig({ BLOG_LIVE2D_ROOT_PREFIX: 'blog/live2d' }),
        },
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    try {
      await request(app.getHttpServer())
        .get('/blog/live2d/evil/catalog.json')
        .set('Referer', 'https://blog.kwitsukasa.top/post/1')
        .expect(HttpStatus.BAD_REQUEST);
      await request(app.getHttpServer())
        .get('/blog/live2d/evil/moc/index.json')
        .set('Referer', 'https://blog.kwitsukasa.top/post/1')
        .expect(HttpStatus.BAD_REQUEST);
      expect(minio.getObject).not.toHaveBeenCalled();
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
        createRateLimitProvider(),
        createClientIpProvider(),
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
        .get(
          '/blog/live2d/pio/moc3/assets/model/pio.moc-reconstructed.model3.json',
        )
        .set('Referer', 'https://example.com/post/1')
        .expect(HttpStatus.BAD_REQUEST);
      expect(minio.getObject).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
