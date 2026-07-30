import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  parseBlogLegacyAssetMigrationOptions,
  resolveBlogLegacyAssetMinioUseSsl,
  runBlogLegacyAssetMigrationCommand,
} from '../../src/commands/migrate-blog-legacy-assets';

const packageJson = JSON.parse(
  readFileSync(resolve(__dirname, '../../package.json'), 'utf8'),
) as {
  scripts: Record<string, string>;
};

const manifestPath =
  '/home/yemu2/KT/.kt-workspace/test-artifacts/blog-assets/manifest.json';

describe('migrate-blog-legacy-assets command', () => {
  it.each([
    { expected: true, value: 'true' },
    { expected: true, value: ' TRUE ' },
    { expected: false, value: 'false' },
    { expected: false, value: undefined },
  ])('resolves MinIO TLS from $value', ({ expected, value }) => {
    expect(resolveBlogLegacyAssetMinioUseSsl(value)).toBe(expected);
  });

  it.each(['--dry-run', '--execute', '--resume', '--verify'])(
    'parses strict %s mode with a caller-supplied manifest',
    (mode) => {
      expect(
        parseBlogLegacyAssetMigrationOptions([
          mode,
          '--manifest-path',
          manifestPath,
        ]),
      ).toMatchObject({
        manifestPath,
        mode: mode.slice(2),
      });
    },
  );

  it('uses --rollback-manifest as the rollback mode and manifest path', () => {
    expect(
      parseBlogLegacyAssetMigrationOptions([
        '--rollback-manifest',
        manifestPath,
      ]),
    ).toMatchObject({
      manifestPath,
      mode: 'rollback',
    });
  });

  it.each([
    { argv: [] },
    { argv: ['--dry-run'] },
    {
      argv: ['--dry-run', '--verify', '--manifest-path', manifestPath],
    },
    { argv: ['--dry-run', '--manifest-path', '/tmp/outside.json'] },
    { argv: ['--unknown', '--manifest-path', manifestPath] },
  ])('rejects unsafe or ambiguous arguments: $argv', ({ argv }) => {
    expect(() => parseBlogLegacyAssetMigrationOptions(argv)).toThrow();
  });

  it.each(['execute', 'resume', 'rollback'] as const)(
    'requires database identity, maintenance confirmation and an existing backup for %s',
    async (mode) => {
      const service = {
        run: jest.fn(),
      };

      await expect(
        runBlogLegacyAssetMigrationCommand(
          {
            manifestPath,
            mode,
          },
          {
            actualDatabaseIdentity: 'db.example:3306/kt',
            inspectBackupPath: jest.fn().mockReturnValue({
              isFile: false,
              readable: false,
              size: 0,
            }),
            service: service as never,
          },
        ),
      ).rejects.toThrow(/数据库身份|维护|备份/);
      expect(service.run).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      backupPath: '/backups',
      inspection: { isFile: false, readable: true, size: 4096 },
    },
    {
      backupPath: '/backups/empty.sql',
      inspection: { isFile: true, readable: true, size: 0 },
    },
    {
      backupPath: '/backups/unreadable.sql',
      inspection: { isFile: true, readable: false, size: 1024 },
    },
    {
      backupPath: manifestPath,
      inspection: { isFile: true, readable: true, size: 1024 },
    },
  ])(
    'rejects unusable backup evidence $backupPath',
    async ({ backupPath, inspection }) => {
      const service = {
        run: jest.fn(),
      };

      await expect(
        runBlogLegacyAssetMigrationCommand(
          {
            backupPath,
            databaseIdentity: 'db.example:3306/kt',
            maintenanceConfirmed: true,
            manifestPath,
            mode: 'execute',
          },
          {
            actualDatabaseIdentity: 'db.example:3306/kt',
            inspectBackupPath: jest.fn().mockReturnValue(inspection),
            service: service as never,
          },
        ),
      ).rejects.toThrow(/备份/);
      expect(service.run).not.toHaveBeenCalled();
    },
  );

  it('forwards a validated read-only invocation to the migration service', async () => {
    const service = {
      run: jest.fn().mockResolvedValue({
        entries: [],
        mode: 'verify',
        status: 'verified',
      }),
    };

    await expect(
      runBlogLegacyAssetMigrationCommand(
        {
          manifestPath,
          mode: 'verify',
        },
        {
          actualDatabaseIdentity: 'db.example:3306/kt',
          inspectBackupPath: jest.fn(),
          service: service as never,
        },
      ),
    ).resolves.toMatchObject({
      mode: 'verify',
      status: 'verified',
    });
    expect(service.run).toHaveBeenCalledWith({
      manifestPath,
      mode: 'verify',
    });
  });

  it('exposes only the compiled migration command through the package script', () => {
    expect(packageJson.scripts['blog-assets:migrate']).toBe(
      'node dist/commands/migrate-blog-legacy-assets.js',
    );
  });
});
