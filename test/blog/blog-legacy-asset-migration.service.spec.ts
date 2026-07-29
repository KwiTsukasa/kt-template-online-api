import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';

import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  BlogLegacyAssetHttpFetcher,
  BlogLegacyAssetManifestFileStore,
  BlogLegacyAssetMigrationService,
  defaultBlogLegacyAssetRawHttpRequest,
  type BlogLegacyAssetRawHttpRequest,
} from '../../src/modules/blog/application/blog-legacy-asset-migration.service';
import type {
  BlogLegacyAssetMigrationManifest,
  BlogLegacyAssetMigrationManifestStore,
} from '../../src/modules/blog/domain/blog-legacy-asset-migration.types';

const manifestPath =
  '/home/yemu2/KT/.kt-workspace/test-artifacts/blog-assets/manifest.json';
const invalidManifestPath = `/home/yemu2/KT/.kt-workspace/test-artifacts/blog-assets/invalid-${process.pid}.json`;

function createManifestStore() {
  let current: BlogLegacyAssetMigrationManifest | undefined;
  const store: BlogLegacyAssetMigrationManifestStore = {
    assertPath: jest.fn(),
    exists: jest.fn(() => current !== undefined),
    read: jest.fn(async () => {
      if (!current) throw new Error('manifest missing');
      return structuredClone(current);
    }),
    write: jest.fn(async (_path, manifest) => {
      current = structuredClone(manifest);
    }),
  };

  return {
    get current() {
      return current;
    },
    store,
  };
}

function createMigrationService() {
  const articleRepository = {
    find: jest.fn().mockResolvedValue([
      {
        contentHtml:
          '<img src="https://legacy.example/article-html.png"><img src="https://other.example/ignored.png">',
        contentMarkdown:
          '![正文](https://legacy.example/article-markdown.webp)',
        cover: 'https://legacy.example/cover.jpg',
        excerpt: '摘要 https://legacy.example/excerpt.gif',
        id: '100',
      },
    ]),
  };
  const themeRepository = {
    find: jest.fn().mockResolvedValue([
      {
        config: {
          backgroundImage: 'https://legacy.example/theme.png',
          site: {
            authorAvatar: '/api/blog/asset/already-local.png',
          },
        },
        id: 'argon',
      },
    ]),
  };
  const dataSource = {
    transaction: jest.fn(),
  };
  const minioClientService = {
    getObject: jest.fn(),
    removeObject: jest.fn(),
    uploadObject: jest.fn(),
  };
  const fetcher = {
    fetch: jest.fn(async (url: string) => {
      const buffer = Buffer.from(`asset:${url}`);
      return {
        buffer,
        finalUrl: url,
        mimeType: url.endsWith('.jpg') ? 'image/jpeg' : 'image/png',
      };
    }),
    isAllowedSourceUrl: jest.fn((url: string) =>
      url.startsWith('https://legacy.example/'),
    ),
  };
  const manifest = createManifestStore();
  const service = new BlogLegacyAssetMigrationService(
    new ConfigService({
      BLOG_ASSET_MIGRATION_ALLOWED_HOSTS: 'legacy.example',
      DB_DATABASE: 'kt',
      DB_HOST: 'db.example',
      DB_PORT: '3306',
    }),
    articleRepository as never,
    themeRepository as never,
    dataSource as never,
    minioClientService as never,
    fetcher as never,
    manifest.store,
  );

  return {
    articleRepository,
    dataSource,
    fetcher,
    manifest,
    minioClientService,
    service,
    themeRepository,
  };
}

function createStoredManifestEntry() {
  const contentSha256 = 'a'.repeat(64);
  return {
    basename: 'cover.png',
    contentSha256,
    field: 'cover',
    mimeType: 'image/png',
    objectKey: `blog/migrated/${contentSha256}/cover.png`,
    oldUrl: 'https://legacy.example/cover.png',
    publicUrl: `/api/blog/asset/${contentSha256}/cover.png`,
    rowId: '100',
    size: 5,
    status: 'planned',
    table: 'blog_article',
  };
}

describe('BlogLegacyAssetManifestFileStore', () => {
  it.each([
    ['arbitrary object key', { objectKey: 'admin/avatar.png' }],
    ['arbitrary public URL', { publicUrl: 'javascript:alert(1)' }],
    ['invalid table-field pair', { field: 'config' }],
    ['unsafe MIME', { mimeType: 'text/html' }],
  ])('rejects a tampered manifest with %s', async (_name, mutation) => {
    const store = new BlogLegacyAssetManifestFileStore();
    const entry = {
      ...createStoredManifestEntry(),
      ...mutation,
    };
    await mkdir(dirname(invalidManifestPath), { recursive: true });
    await writeFile(
      invalidManifestPath,
      JSON.stringify({
        createdAt: '2026-07-29T00:00:00.000Z',
        entries: [entry],
        mode: 'dry-run',
        status: 'planned',
        updatedAt: '2026-07-29T00:00:00.000Z',
        version: 1,
      }),
    );

    try {
      await expect(store.read(invalidManifestPath)).rejects.toThrow(/manifest/);
    } finally {
      await rm(invalidManifestPath, { force: true });
    }
  });
});

describe('BlogLegacyAssetHttpFetcher', () => {
  it('pins every allowed redirect hop to the validated public DNS result', async () => {
    const resolver = jest
      .fn()
      .mockResolvedValueOnce([{ address: '203.0.113.10', family: 4 }])
      .mockResolvedValueOnce([{ address: '203.0.113.20', family: 4 }]);
    const request: jest.MockedFunction<BlogLegacyAssetRawHttpRequest> = jest
      .fn()
      .mockResolvedValueOnce({
        body: Buffer.alloc(0),
        headers: {
          location: 'https://cdn.example/final.png',
        },
        status: 302,
      })
      .mockResolvedValueOnce({
        body: Buffer.from('image'),
        headers: {
          'content-length': '5',
          'content-type': 'image/png',
        },
        status: 200,
      });
    const fetcher = new BlogLegacyAssetHttpFetcher(
      new ConfigService({
        BLOG_ASSET_MIGRATION_ALLOWED_HOSTS: 'legacy.example,cdn.example',
      }),
      resolver,
      request,
    );

    await expect(
      fetcher.fetch('https://legacy.example/start.png'),
    ).resolves.toMatchObject({
      buffer: Buffer.from('image'),
      finalUrl: 'https://cdn.example/final.png',
      mimeType: 'image/png',
    });
    expect(request.mock.calls[0][0]).toMatchObject({
      address: '203.0.113.10',
      url: new URL('https://legacy.example/start.png'),
    });
    expect(request.mock.calls[1][0]).toMatchObject({
      address: '203.0.113.20',
      url: new URL('https://cdn.example/final.png'),
    });
  });

  it.each([
    ['127.0.0.1', 4],
    ['10.0.0.1', 4],
    ['100.64.0.1', 4],
    ['169.254.1.1', 4],
    ['172.16.0.1', 4],
    ['192.168.1.1', 4],
    ['0.0.0.0', 4],
    ['224.0.0.1', 4],
    ['::1', 6],
    ['::', 6],
    ['fc00::1', 6],
    ['fe80::1', 6],
    ['ff02::1', 6],
    ['::ffff:127.0.0.1', 6],
  ])('rejects forbidden DNS result %s', async (address, family) => {
    const fetcher = new BlogLegacyAssetHttpFetcher(
      new ConfigService({
        BLOG_ASSET_MIGRATION_ALLOWED_HOSTS: 'legacy.example',
      }),
      jest.fn().mockResolvedValue([{ address, family }]),
      jest.fn(),
    );

    await expect(
      fetcher.fetch('https://legacy.example/asset.png'),
    ).rejects.toThrow(/禁止|不安全/);
  });

  it('rejects a subdomain, oversized body, unsafe MIME and excess redirects', async () => {
    const resolver = jest
      .fn()
      .mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
    const request = jest.fn();
    const fetcher = new BlogLegacyAssetHttpFetcher(
      new ConfigService({
        BLOG_ASSET_MIGRATION_ALLOWED_HOSTS: 'legacy.example',
        BLOG_ASSET_MIGRATION_MAX_BYTES: 4,
        BLOG_ASSET_MIGRATION_MAX_REDIRECTS: 1,
      }),
      resolver,
      request,
    );

    await expect(
      fetcher.fetch('https://child.legacy.example/a.png'),
    ).rejects.toThrow(/allowlist/);

    request.mockResolvedValueOnce({
      body: Buffer.from('12345'),
      headers: { 'content-type': 'image/png' },
      status: 200,
    });
    await expect(fetcher.fetch('https://legacy.example/a.png')).rejects.toThrow(
      /大小/,
    );

    request.mockResolvedValueOnce({
      body: Buffer.from('x'),
      headers: { 'content-type': 'text/html' },
      status: 200,
    });
    await expect(fetcher.fetch('https://legacy.example/a.png')).rejects.toThrow(
      /MIME/,
    );

    request
      .mockResolvedValueOnce({
        body: Buffer.alloc(0),
        headers: { location: '/b.png' },
        status: 302,
      })
      .mockResolvedValueOnce({
        body: Buffer.alloc(0),
        headers: { location: '/c.png' },
        status: 302,
      });
    await expect(fetcher.fetch('https://legacy.example/a.png')).rejects.toThrow(
      /重定向/,
    );
  });

  it('re-resolves a redirect and rejects it before a private destination request', async () => {
    const resolver = jest
      .fn()
      .mockResolvedValueOnce([{ address: '203.0.113.10', family: 4 }])
      .mockResolvedValueOnce([{ address: '192.168.1.10', family: 4 }]);
    const request = jest.fn().mockResolvedValueOnce({
      body: Buffer.alloc(0),
      headers: {
        location: '/private.png',
      },
      status: 302,
    });
    const fetcher = new BlogLegacyAssetHttpFetcher(
      new ConfigService({
        BLOG_ASSET_MIGRATION_ALLOWED_HOSTS: 'legacy.example',
      }),
      resolver,
      request,
    );

    await expect(
      fetcher.fetch('https://legacy.example/start.png'),
    ).rejects.toThrow(/禁止|不安全/);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('uses the pinned address with the original Host on a real local HTTP request', async () => {
    let receivedHost = '';
    const server = createServer((request, response) => {
      receivedHost = request.headers.host || '';
      response.writeHead(200, {
        'Content-Length': '5',
        'Content-Type': 'image/png',
      });
      response.end('image');
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('本地 HTTP 测试端口不可用');
    }

    try {
      await expect(
        defaultBlogLegacyAssetRawHttpRequest({
          address: '127.0.0.1',
          family: 4,
          maxBytes: 1024,
          timeoutMs: 1_000,
          url: new URL(`http://legacy.example:${address.port}/asset.png`),
        }),
      ).resolves.toMatchObject({
        body: Buffer.from('image'),
        status: 200,
      });
      expect(receivedHost).toBe(`legacy.example:${address.port}`);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });

  it('destroys the pinned Agent when the bounded HTTP request fails', async () => {
    const request = jest
      .spyOn(axios, 'request')
      .mockRejectedValueOnce(new Error('timeout'));
    const destroy = jest.spyOn(HttpsAgent.prototype, 'destroy');

    await expect(
      defaultBlogLegacyAssetRawHttpRequest({
        address: '203.0.113.10',
        family: 4,
        maxBytes: 1024,
        timeoutMs: 100,
        url: new URL('https://legacy.example/asset.png'),
      }),
    ).rejects.toThrow('timeout');
    expect(destroy).toHaveBeenCalledTimes(1);

    request.mockRestore();
    destroy.mockRestore();
  });

  it('bounds DNS and redirect work within the configured fetch timeout', async () => {
    const fetcher = new BlogLegacyAssetHttpFetcher(
      new ConfigService({
        BLOG_ASSET_MIGRATION_ALLOWED_HOSTS: 'legacy.example',
        BLOG_ASSET_MIGRATION_TIMEOUT_MS: 100,
      }),
      jest.fn(
        () =>
          new Promise(() => {
            // 由迁移器总超时终止等待。
          }),
      ),
      jest.fn(),
    );

    await expect(
      fetcher.fetch('https://legacy.example/asset.png'),
    ).rejects.toThrow(/超时/);
  });
});

describe('BlogLegacyAssetMigrationService', () => {
  it('scans all five legacy fields and produces content-addressed dry-run entries without writes', async () => {
    const fixture = createMigrationService();

    const result = await fixture.service.run({
      manifestPath,
      mode: 'dry-run',
    });

    expect(result.entries).toHaveLength(5);
    expect(
      result.entries.map((entry) => `${entry.table}.${entry.field}`),
    ).toEqual(
      expect.arrayContaining([
        'blog_article.content_html',
        'blog_article.content_markdown',
        'blog_article.cover',
        'blog_article.excerpt',
        'blog_theme_config.config',
      ]),
    );
    for (const entry of result.entries) {
      const expectedHash = createHash('sha256')
        .update(Buffer.from(`asset:${entry.oldUrl}`))
        .digest('hex');
      expect(entry.contentSha256).toBe(expectedHash);
      expect(entry.objectKey).toBe(
        `blog/migrated/${expectedHash}/${entry.basename}`,
      );
      expect(entry.publicUrl).toBe(
        `/api/blog/asset/${expectedHash}/${entry.basename}`,
      );
      expect(entry.status).toBe('planned');
    }
    expect(fixture.minioClientService.uploadObject).not.toHaveBeenCalled();
    expect(fixture.dataSource.transaction).not.toHaveBeenCalled();
    expect(fixture.manifest.store.write).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toMatch(
      /DB_PASSWORD|MINIO_ACCESS_KEY|MINIO_SECRET_KEY|credential/iu,
    );
  });

  it('resumes by skipping completed entries instead of downloading or writing them again', async () => {
    const fixture = createMigrationService();
    const dryRun = await fixture.service.run({
      manifestPath,
      mode: 'dry-run',
    });
    const completed = {
      ...dryRun,
      entries: dryRun.entries.map((entry) => ({
        ...entry,
        status: 'completed' as const,
      })),
      mode: 'execute' as const,
      status: 'completed' as const,
      updatedAt: '2026-07-29T00:00:00.000Z',
    };
    await fixture.manifest.store.write(manifestPath, completed);
    jest.mocked(fixture.manifest.store.write).mockClear();
    fixture.fetcher.fetch.mockClear();

    const resumed = await fixture.service.run({
      backupPath: '/backups/blog.sql',
      databaseIdentity: 'db.example:3306/kt',
      maintenanceConfirmed: true,
      manifestPath,
      mode: 'resume',
    });

    expect(resumed.entries.every((entry) => entry.status === 'completed')).toBe(
      true,
    );
    expect(fixture.fetcher.fetch).not.toHaveBeenCalled();
    expect(fixture.minioClientService.uploadObject).not.toHaveBeenCalled();
    expect(fixture.dataSource.transaction).not.toHaveBeenCalled();
    expect(jest.mocked(fixture.manifest.store.write)).toHaveBeenCalledTimes(1);
    expect(fixture.manifest.current).toMatchObject({
      mode: 'resume',
    });
    expect(fixture.manifest.current?.updatedAt).not.toBe(
      '2026-07-29T00:00:00.000Z',
    );
  });

  it('rewrites multiple URLs across separate nested theme config leaves in one transaction', async () => {
    const currentConfig = {
      backgroundImage: 'https://legacy.example/background.png',
      nested: {
        avatar: 'https://legacy.example/background.png?v=2',
        untouched: '/local.png',
      },
    };
    const update = jest.fn();
    const transactionRepository = {
      findOne: jest.fn().mockResolvedValue({
        config: currentConfig,
        id: 'argon',
      }),
      update,
    };
    const dataSource = {
      transaction: jest.fn(async (callback) =>
        callback({
          getRepository: jest.fn(() => transactionRepository),
        }),
      ),
    };
    const fetcher = {
      fetch: jest.fn(async (url: string) => ({
        buffer: Buffer.from(url),
        finalUrl: url,
        mimeType: 'image/png',
      })),
      isAllowedSourceUrl: jest.fn().mockReturnValue(true),
    };
    const manifest = createManifestStore();
    const minioClientService = {
      uploadObject: jest.fn().mockResolvedValue({}),
    };
    const service = new BlogLegacyAssetMigrationService(
      new ConfigService({
        BLOG_ASSET_MIGRATION_ALLOWED_HOSTS: 'legacy.example',
        DB_DATABASE: 'kt',
        DB_HOST: 'db.example',
        DB_PORT: '3306',
      }),
      {
        find: jest.fn().mockResolvedValue([]),
      } as never,
      {
        find: jest.fn().mockResolvedValue([
          {
            config: currentConfig,
            id: 'argon',
          },
        ]),
      } as never,
      dataSource as never,
      minioClientService as never,
      fetcher as never,
      manifest.store,
    );

    await service.run({
      backupPath: '/backups/blog.sql',
      databaseIdentity: 'db.example:3306/kt',
      maintenanceConfirmed: true,
      manifestPath,
      mode: 'execute',
    });

    expect(update).toHaveBeenCalledTimes(1);
    expect(transactionRepository.findOne).toHaveBeenCalledWith({
      lock: {
        mode: 'pessimistic_write',
      },
      where: {
        id: 'argon',
      },
    });
    expect(update.mock.calls[0][1].config).toEqual({
      backgroundImage: expect.stringMatching(
        /^\/api\/blog\/asset\/[a-f0-9]{64}\/background\.png$/u,
      ),
      nested: {
        avatar: expect.stringMatching(
          /^\/api\/blog\/asset\/[a-f0-9]{64}\/background\.png$/u,
        ),
        untouched: '/local.png',
      },
    });
  });

  it('rejects an irreversible many-to-one URL mapping before writing a manifest', async () => {
    const currentConfig = {
      primary: 'https://legacy.example/a.png',
      secondary: 'https://legacy.example/b.png',
    };
    const fetcher = {
      fetch: jest.fn(async () => ({
        buffer: Buffer.from('shared-image'),
        finalUrl: 'https://legacy.example/shared.png',
        mimeType: 'image/png',
      })),
      isAllowedSourceUrl: jest.fn().mockReturnValue(true),
    };
    const manifest = createManifestStore();
    const service = new BlogLegacyAssetMigrationService(
      new ConfigService({
        BLOG_ASSET_MIGRATION_ALLOWED_HOSTS: 'legacy.example',
        DB_DATABASE: 'kt',
        DB_HOST: 'db.example',
        DB_PORT: '3306',
      }),
      {
        find: jest.fn().mockResolvedValue([]),
      } as never,
      {
        find: jest.fn().mockResolvedValue([
          {
            config: currentConfig,
            id: 'argon',
          },
        ]),
      } as never,
      {
        transaction: jest.fn(),
      } as never,
      {
        uploadObject: jest.fn(),
      } as never,
      fetcher as never,
      manifest.store,
    );

    await expect(
      service.run({
        manifestPath,
        mode: 'dry-run',
      }),
    ).rejects.toThrow(/冲突|不可逆/);
    expect(manifest.store.write).not.toHaveBeenCalled();
  });

  it('rejects a resumed manifest whose old URL no longer matches the exact allowlist', async () => {
    const fixture = createMigrationService();
    const manifest = await fixture.service.run({
      manifestPath,
      mode: 'dry-run',
    });
    const tampered = {
      ...manifest,
      entries: manifest.entries.map((entry, index) =>
        index === 0
          ? {
              ...entry,
              oldUrl: 'https://other.example/asset.png',
            }
          : entry,
      ),
      mode: 'execute' as const,
    };
    await fixture.manifest.store.write(manifestPath, tampered);

    await expect(
      fixture.service.run({
        backupPath: '/backups/blog.sql',
        databaseIdentity: 'db.example:3306/kt',
        maintenanceConfirmed: true,
        manifestPath,
        mode: 'resume',
      }),
    ).rejects.toThrow(/allowlist/);
    expect(fixture.minioClientService.uploadObject).not.toHaveBeenCalled();
  });

  it('verifies DB and MinIO content, then rolls back only the DB URL without deleting the shared object', async () => {
    const oldUrl = 'https://legacy.example/cover.png';
    const buffer = Buffer.from('cover');
    const contentSha256 = createHash('sha256').update(buffer).digest('hex');
    const publicUrl = `/api/blog/asset/${contentSha256}/cover.png`;
    const entry = {
      basename: 'cover.png',
      contentSha256,
      field: 'cover' as const,
      mimeType: 'image/png',
      objectKey: `blog/migrated/${contentSha256}/cover.png`,
      oldUrl,
      publicUrl,
      rowId: '100',
      size: buffer.length,
      status: 'completed' as const,
      table: 'blog_article' as const,
    };
    const manifest = createManifestStore();
    await manifest.store.write(manifestPath, {
      createdAt: '2026-07-29T00:00:00.000Z',
      entries: [entry],
      mode: 'execute',
      status: 'completed',
      updatedAt: '2026-07-29T00:00:00.000Z',
      version: 1,
    });
    const update = jest.fn();
    const transactionRepository = {
      findOne: jest.fn().mockResolvedValue({
        cover: publicUrl,
        id: '100',
      }),
      update,
    };
    const dataSource = {
      transaction: jest.fn(async (callback) =>
        callback({
          getRepository: jest.fn(() => transactionRepository),
        }),
      ),
    };
    let objectMimeType = 'image/jpeg';
    const minioClientService = {
      getObject: jest.fn(async () => ({
        stat: {
          metaData: {
            'content-type': objectMimeType,
          },
          size: buffer.length,
        },
        stream: Readable.from(buffer),
      })),
      removeObject: jest.fn(),
    };
    const service = new BlogLegacyAssetMigrationService(
      new ConfigService({
        BLOG_ASSET_MIGRATION_ALLOWED_HOSTS: 'legacy.example',
        DB_DATABASE: 'kt',
        DB_HOST: 'db.example',
        DB_PORT: '3306',
      }),
      {
        findOne: jest.fn().mockResolvedValue({
          cover: publicUrl,
          id: '100',
        }),
      } as never,
      {
        findOne: jest.fn(),
      } as never,
      dataSource as never,
      minioClientService as never,
      {
        isAllowedSourceUrl: jest.fn().mockReturnValue(true),
      } as never,
      manifest.store,
    );

    await expect(
      service.run({
        manifestPath,
        mode: 'verify',
      }),
    ).rejects.toThrow(/验证失败/);

    objectMimeType = 'image/png';
    await expect(
      service.run({
        manifestPath,
        mode: 'verify',
      }),
    ).resolves.toMatchObject({
      entries: [
        expect.objectContaining({
          status: 'verified',
        }),
      ],
      status: 'verified',
    });

    await expect(
      service.run({
        backupPath: '/backups/blog.sql',
        databaseIdentity: 'db.example:3306/kt',
        maintenanceConfirmed: true,
        manifestPath,
        mode: 'rollback',
      }),
    ).resolves.toMatchObject({
      entries: [
        expect.objectContaining({
          status: 'rolled-back',
        }),
      ],
      status: 'rolled-back',
    });
    expect(update).toHaveBeenCalledWith(
      {
        id: '100',
      },
      {
        cover: oldUrl,
      },
    );
    expect(transactionRepository.findOne).toHaveBeenCalledWith({
      lock: {
        mode: 'pessimistic_write',
      },
      where: {
        id: '100',
      },
    });
    expect(minioClientService.removeObject).not.toHaveBeenCalled();
  });
});
