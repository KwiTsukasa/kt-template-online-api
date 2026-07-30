import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  AdminPasswordMigrationOptions,
  AdminPasswordMigrationPathInspection,
} from '../../src/commands/migrate-admin-passwords';
import {
  buildAdminPasswordMigrationDatabaseIdentity,
  inspectAdminPasswordBackupPath,
  inspectAdminPasswordManifestPath,
  parseAdminPasswordMigrationOptions,
  runAdminPasswordMigration,
  writeAdminPasswordMigrationManifest,
} from '../../src/commands/migrate-admin-passwords';

const VERSIONED_HASH =
  '$pbkdf2-sha256$v=1$i=600000$AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE$acCR3Bjb48G7uQRjBo961QHqiLOtaEMb9u_X9DGlq3E';

function createPathSafetyFixture() {
  const root = mkdtempSync(join(tmpdir(), 'kt-admin-password-paths-'));
  const workspace = join(root, '.kt-workspace', 'task13');
  mkdirSync(workspace, { recursive: true });
  const backupPath = join(root, 'database.sql.gpg');
  const manifestPath = join(workspace, 'manifest.json');
  writeFileSync(backupPath, 'encrypted-backup', { mode: 0o600 });
  return {
    backupPath,
    cleanup: () => rmSync(root, { force: true, recursive: true }),
    manifestPath,
    root,
    workspace,
  };
}

function createPathInspection(
  overrides: Partial<AdminPasswordMigrationPathInspection> = {},
): AdminPasswordMigrationPathInspection {
  return {
    exists: true,
    identity: '1:1',
    isFile: true,
    isSymbolicLink: false,
    parentHasSymbolicLink: false,
    readable: true,
    release: jest.fn(),
    size: 128,
    stable: true,
    ...overrides,
  };
}

function createMissingManifestInspection() {
  return createPathInspection({
    exists: false,
    identity: undefined,
    isFile: false,
    readable: false,
    size: 0,
  });
}

function createHarness(
  rows: Array<{ id: string; password: string }>,
  mode: AdminPasswordMigrationOptions['mode'],
) {
  const query = jest
    .fn()
    .mockResolvedValueOnce(rows)
    .mockResolvedValue({ affectedRows: 1 });
  const queryRunner = {
    commitTransaction: jest.fn(),
    connect: jest.fn(),
    query,
    release: jest.fn(),
    rollbackTransaction: jest.fn(),
    startTransaction: jest.fn(),
  };
  const dataSource = {
    createQueryRunner: jest.fn(() => queryRunner),
    destroy: jest.fn(),
    initialize: jest.fn(),
  };
  const passwordHashService = {
    hashPassword: jest.fn(async (password: string) => `hashed:${password}`),
    isPasswordHash: jest.fn((password: string) =>
      password.startsWith('$pbkdf2-sha256$'),
    ),
  };
  const manifests: unknown[] = [];
  const logger = { error: jest.fn(), log: jest.fn() };
  const writeManifest = jest.fn(async (_path, manifest) => {
    manifests.push(structuredClone(manifest));
  });
  const options: AdminPasswordMigrationOptions = {
    backupPath: '/backups/admin-before.sql',
    databaseIdentity: 'db.internal:3306/kt',
    maintenanceConfirmed: true,
    manifestPath: '/app/.kt-workspace/task13/admin-passwords.json',
    mode,
  };

  return {
    dataSource,
    logger,
    manifests,
    options,
    passwordHashService,
    query,
    queryRunner,
    run: () =>
      runAdminPasswordMigration(options, {
        actualDatabaseIdentity: 'db.internal:3306/kt',
        dataSource: dataSource as any,
        logger,
        passwordHashService: passwordHashService as any,
        inspectBackupPath: () => createPathInspection(),
        inspectManifestPath: () => createMissingManifestInspection(),
        writeManifest,
      }),
    writeManifest,
  };
}

describe('Admin password migration command', () => {
  it('parses exactly one non-interactive mode and explicit safety inputs', () => {
    expect(
      parseAdminPasswordMigrationOptions([
        '--execute',
        '--database-identity',
        'db.internal:3306/kt',
        '--maintenance-confirmed',
        '--backup-path',
        '/backups/admin-before.sql',
        '--manifest-path',
        '/app/.kt-workspace/task13/result.json',
      ]),
    ).toEqual({
      backupPath: '/backups/admin-before.sql',
      databaseIdentity: 'db.internal:3306/kt',
      maintenanceConfirmed: true,
      manifestPath: '/app/.kt-workspace/task13/result.json',
      mode: 'execute',
    });
    expect(() =>
      parseAdminPasswordMigrationOptions(['--dry-run', '--verify']),
    ).toThrow('必须且只能指定一个迁移模式');
    expect(() => parseAdminPasswordMigrationOptions(['--dry-run'], {})).toThrow(
      '必须由调用方指定 manifest 路径',
    );
  });

  it.each([
    ['/evidence/result.json'],
    ['/app/.kt-workspace/task13/result.txt'],
    ['/app/.kt-workspace/../result.json'],
  ])(
    'rejects a manifest outside the required JSON evidence boundary: %s',
    (path) => {
      expect(() =>
        parseAdminPasswordMigrationOptions([
          '--dry-run',
          '--manifest-path',
          path,
        ]),
      ).toThrow('manifest 必须由调用方指定为 .kt-workspace 下的 JSON 文件');
    },
  );

  it.each([
    [
      '--backup-path',
      '/backups/first.sql',
      '--backup-path',
      '/backups/second.sql',
    ],
    [
      '--database-identity',
      'db.internal:3306/first',
      '--database-identity',
      'db.internal:3306/second',
    ],
    [
      '--manifest-path',
      '/app/.kt-workspace/task13/first.json',
      '--manifest-path',
      '/app/.kt-workspace/task13/second.json',
    ],
  ])('rejects a repeated value option: %s', (...optionArguments) => {
    expect(() =>
      parseAdminPasswordMigrationOptions(['--dry-run', ...optionArguments]),
    ).toThrow('只能指定一次');
  });

  it('rejects a repeated maintenance confirmation flag', () => {
    expect(() =>
      parseAdminPasswordMigrationOptions([
        '--dry-run',
        '--maintenance-confirmed',
        '--maintenance-confirmed',
        '--manifest-path',
        '/app/.kt-workspace/task13/result.json',
      ]),
    ).toThrow('只能指定一次');
  });

  it('accepts the same manifest contract from the environment', () => {
    expect(
      parseAdminPasswordMigrationOptions(['--verify'], {
        ADMIN_PASSWORD_MIGRATION_MANIFEST_PATH:
          '/app/.kt-workspace/task13/verify.json',
      }),
    ).toMatchObject({
      manifestPath: '/app/.kt-workspace/task13/verify.json',
      mode: 'verify',
    });
  });

  it('builds the database identity without including credentials', () => {
    expect(
      buildAdminPasswordMigrationDatabaseIdentity({
        DB_DATABASE: 'kt',
        DB_HOST: 'db.internal',
        DB_PASSWORD: 'must-not-leak',
        DB_PORT: '3306',
        DB_USERNAME: 'root',
      }),
    ).toBe('db.internal:3306/kt');
  });

  it.each([
    ['database identity', { databaseIdentity: undefined }],
    ['maintenance confirmation', { maintenanceConfirmed: false }],
    ['backup path', { backupPath: undefined }],
  ])('rejects execute without %s', async (_label, overrides) => {
    const harness = createHarness([], 'execute');

    await expect(
      runAdminPasswordMigration(
        { ...harness.options, ...overrides },
        {
          actualDatabaseIdentity: 'db.internal:3306/kt',
          dataSource: harness.dataSource as any,
          inspectManifestPath: () => createMissingManifestInspection(),
          logger: { error: jest.fn(), log: jest.fn() },
          passwordHashService: harness.passwordHashService as any,
          inspectBackupPath: () => createPathInspection(),
          writeManifest: async () => {},
        },
      ),
    ).rejects.toThrow();
    expect(harness.dataSource.initialize).not.toHaveBeenCalled();
  });

  it.each([
    ['missing file', { isFile: false, readable: false, size: 0 }],
    ['directory', { isFile: false, readable: true, size: 4096 }],
    ['unreadable file', { isFile: true, readable: false, size: 128 }],
    ['empty file', { isFile: true, readable: true, size: 0 }],
  ])('rejects execute with an invalid backup: %s', async (_label, backup) => {
    const harness = createHarness([], 'execute');

    await expect(
      runAdminPasswordMigration(harness.options, {
        actualDatabaseIdentity: 'db.internal:3306/kt',
        dataSource: harness.dataSource as any,
        inspectBackupPath: () => createPathInspection(backup),
        inspectManifestPath: () => createMissingManifestInspection(),
        logger: { error: jest.fn(), log: jest.fn() },
        passwordHashService: harness.passwordHashService as any,
        writeManifest: async () => {},
      }),
    ).rejects.toThrow('备份路径必须是可读的非空普通文件');
    expect(harness.dataSource.initialize).not.toHaveBeenCalled();
  });

  it('rejects canonical-equivalent backup and manifest paths before inspection or initialization', async () => {
    const harness = createHarness([], 'execute');
    const inspectBackupPath = jest.fn(() => createPathInspection());

    await expect(
      runAdminPasswordMigration(
        {
          ...harness.options,
          backupPath: '/app/.kt-workspace/task13/./manifest.json',
          manifestPath: '/app/.kt-workspace/task13/manifest.json',
        },
        {
          actualDatabaseIdentity: 'db.internal:3306/kt',
          dataSource: harness.dataSource as any,
          inspectBackupPath,
          inspectManifestPath: () => createMissingManifestInspection(),
          logger: { error: jest.fn(), log: jest.fn() },
          passwordHashService: harness.passwordHashService as any,
          writeManifest: harness.writeManifest,
        },
      ),
    ).rejects.toThrow('备份路径不能与 manifest 相同');
    expect(inspectBackupPath).not.toHaveBeenCalled();
    expect(harness.dataSource.initialize).not.toHaveBeenCalled();
    expect(harness.writeManifest).not.toHaveBeenCalled();
  });

  it('rejects a backup symlink alias before database initialization', async () => {
    const fixture = createPathSafetyFixture();
    const backupAlias = join(fixture.root, 'backup-alias.sql.gpg');
    writeFileSync(fixture.manifestPath, '{}\n', { mode: 0o600 });
    symlinkSync(fixture.manifestPath, backupAlias);
    const harness = createHarness([], 'execute');

    try {
      await expect(
        runAdminPasswordMigration(
          {
            ...harness.options,
            backupPath: backupAlias,
            manifestPath: fixture.manifestPath,
          },
          {
            actualDatabaseIdentity: 'db.internal:3306/kt',
            dataSource: harness.dataSource as any,
            inspectBackupPath: inspectAdminPasswordBackupPath,
            inspectManifestPath: inspectAdminPasswordManifestPath,
            logger: harness.logger,
            passwordHashService: harness.passwordHashService as any,
            writeManifest: harness.writeManifest,
          },
        ),
      ).rejects.toThrow('备份路径不能包含符号链接');
      expect(harness.dataSource.initialize).not.toHaveBeenCalled();
      expect(harness.writeManifest).not.toHaveBeenCalled();
      expect(readFileSync(fixture.manifestPath, 'utf8')).toBe('{}\n');
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects hard-linked backup and manifest identities before database initialization', async () => {
    const fixture = createPathSafetyFixture();
    linkSync(fixture.backupPath, fixture.manifestPath);
    const harness = createHarness([], 'execute');

    try {
      await expect(
        runAdminPasswordMigration(
          {
            ...harness.options,
            backupPath: fixture.backupPath,
            manifestPath: fixture.manifestPath,
          },
          {
            actualDatabaseIdentity: 'db.internal:3306/kt',
            dataSource: harness.dataSource as any,
            inspectBackupPath: inspectAdminPasswordBackupPath,
            inspectManifestPath: inspectAdminPasswordManifestPath,
            logger: harness.logger,
            passwordHashService: harness.passwordHashService as any,
            writeManifest: harness.writeManifest,
          },
        ),
      ).rejects.toThrow('备份路径不能与 manifest 指向同一文件');
      expect(harness.dataSource.initialize).not.toHaveBeenCalled();
      expect(harness.writeManifest).not.toHaveBeenCalled();
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects a manifest symlink or symlinked parent before database initialization', async () => {
    const fixture = createPathSafetyFixture();
    const manifestTarget = join(fixture.root, 'outside.json');
    writeFileSync(manifestTarget, '{}\n', { mode: 0o600 });
    symlinkSync(manifestTarget, fixture.manifestPath);
    const harness = createHarness([], 'execute');

    try {
      await expect(
        runAdminPasswordMigration(
          {
            ...harness.options,
            backupPath: fixture.backupPath,
            manifestPath: fixture.manifestPath,
          },
          {
            actualDatabaseIdentity: 'db.internal:3306/kt',
            dataSource: harness.dataSource as any,
            inspectBackupPath: inspectAdminPasswordBackupPath,
            inspectManifestPath: inspectAdminPasswordManifestPath,
            logger: harness.logger,
            passwordHashService: harness.passwordHashService as any,
            writeManifest: harness.writeManifest,
          },
        ),
      ).rejects.toThrow('manifest 不能是符号链接');

      rmSync(fixture.manifestPath);
      const realParent = join(fixture.root, 'real-parent');
      mkdirSync(realParent);
      rmSync(fixture.workspace, { recursive: true });
      symlinkSync(realParent, fixture.workspace);

      await expect(
        runAdminPasswordMigration(
          {
            ...harness.options,
            backupPath: fixture.backupPath,
            manifestPath: fixture.manifestPath,
          },
          {
            actualDatabaseIdentity: 'db.internal:3306/kt',
            dataSource: harness.dataSource as any,
            inspectBackupPath: inspectAdminPasswordBackupPath,
            inspectManifestPath: inspectAdminPasswordManifestPath,
            logger: harness.logger,
            passwordHashService: harness.passwordHashService as any,
            writeManifest: harness.writeManifest,
          },
        ),
      ).rejects.toThrow('manifest 父路径不能包含符号链接');
      expect(harness.dataSource.initialize).not.toHaveBeenCalled();
      expect(harness.writeManifest).not.toHaveBeenCalled();
    } finally {
      fixture.cleanup();
    }
  });

  it('fails closed when the manifest writer receives an existing symlink', async () => {
    const fixture = createPathSafetyFixture();
    const outsidePath = join(fixture.root, 'outside.json');
    writeFileSync(outsidePath, 'preserve-me\n', { mode: 0o600 });
    symlinkSync(outsidePath, fixture.manifestPath);

    try {
      await expect(
        writeAdminPasswordMigrationManifest(fixture.manifestPath, {
          counts: { migrated: 0, pending: 0, scanned: 0, skipped: 0 },
          ids: { migrated: [], pending: [], skipped: [] },
          mode: 'dry-run',
          status: 'completed',
        }),
      ).rejects.toThrow('manifest 不能是符号链接');
      expect(readFileSync(outsidePath, 'utf8')).toBe('preserve-me\n');
    } finally {
      fixture.cleanup();
    }
  });

  it('does not overwrite a pre-existing regular manifest on first publish', async () => {
    const fixture = createPathSafetyFixture();
    writeFileSync(fixture.manifestPath, 'preserve-existing\n', { mode: 0o600 });

    try {
      await expect(
        writeAdminPasswordMigrationManifest(fixture.manifestPath, {
          counts: { migrated: 0, pending: 0, scanned: 0, skipped: 0 },
          ids: { migrated: [], pending: [], skipped: [] },
          mode: 'dry-run',
          status: 'completed',
        }),
      ).rejects.toThrow('manifest 必须使用不存在的新路径');
      expect(readFileSync(fixture.manifestPath, 'utf8')).toBe(
        'preserve-existing\n',
      );
    } finally {
      fixture.cleanup();
    }
  });

  it('atomically creates and updates a regular manifest in a new evidence path', async () => {
    const fixture = createPathSafetyFixture();
    const manifest = {
      counts: { migrated: 0, pending: 0, scanned: 0, skipped: 0 },
      ids: { migrated: [], pending: [], skipped: [] },
      mode: 'execute' as const,
      status: 'prepared' as const,
    };

    try {
      await writeAdminPasswordMigrationManifest(fixture.manifestPath, manifest);
      await writeAdminPasswordMigrationManifest(
        fixture.manifestPath,
        {
          ...manifest,
          status: 'completed',
        },
        'replace',
      );
      expect(
        JSON.parse(readFileSync(fixture.manifestPath, 'utf8')),
      ).toMatchObject({
        mode: 'execute',
        status: 'completed',
      });
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects an existing manifest before database initialization', async () => {
    const harness = createHarness([], 'dry-run');

    await expect(
      runAdminPasswordMigration(harness.options, {
        actualDatabaseIdentity: 'db.internal:3306/kt',
        dataSource: harness.dataSource as any,
        inspectBackupPath: () => createPathInspection(),
        inspectManifestPath: () => createPathInspection({ identity: '1:2' }),
        logger: harness.logger,
        passwordHashService: harness.passwordHashService as any,
        writeManifest: harness.writeManifest,
      }),
    ).rejects.toThrow('manifest 必须使用不存在的新路径');
    expect(harness.dataSource.initialize).not.toHaveBeenCalled();
    expect(harness.writeManifest).not.toHaveBeenCalled();
  });

  it('runs dry-run without hashing, transaction, or writes', async () => {
    const harness = createHarness(
      [
        { id: '1', password: 'plaintext-one' },
        { id: '2', password: VERSIONED_HASH },
      ],
      'dry-run',
    );

    const manifest = await harness.run();

    expect(manifest).toMatchObject({
      counts: {
        migrated: 0,
        pending: 1,
        scanned: 2,
        skipped: 1,
      },
      ids: {
        migrated: [],
        pending: ['1'],
        skipped: ['2'],
      },
      mode: 'dry-run',
      status: 'completed',
    });
    expect(harness.passwordHashService.hashPassword).not.toHaveBeenCalled();
    expect(harness.queryRunner.startTransaction).not.toHaveBeenCalled();
    expect(harness.query).toHaveBeenCalledTimes(1);
  });

  it('migrates plaintext rows one by one in one transaction and skips hashes', async () => {
    const harness = createHarness(
      [
        { id: '1', password: 'plaintext-one' },
        { id: '2', password: VERSIONED_HASH },
        { id: '3', password: 'plaintext-three' },
      ],
      'execute',
    );

    const manifest = await harness.run();

    expect(harness.queryRunner.startTransaction).toHaveBeenCalledTimes(1);
    expect(harness.passwordHashService.hashPassword.mock.calls).toEqual([
      ['plaintext-one'],
      ['plaintext-three'],
    ]);
    expect(harness.query).toHaveBeenNthCalledWith(
      2,
      'UPDATE admin_user SET password = ? WHERE id = ?',
      ['hashed:plaintext-one', '1'],
    );
    expect(harness.query).toHaveBeenNthCalledWith(
      3,
      'UPDATE admin_user SET password = ? WHERE id = ?',
      ['hashed:plaintext-three', '3'],
    );
    expect(harness.queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(harness.queryRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(harness.manifests.map((item: any) => item.status)).toEqual([
      'prepared',
      'completed',
    ]);
    expect(manifest).toMatchObject({
      counts: { migrated: 2, pending: 0, scanned: 3, skipped: 1 },
      mode: 'execute',
      status: 'completed',
    });
  });

  it('holds the backup identity lease until manifest and database cleanup finish', async () => {
    const harness = createHarness([], 'execute');
    const release = jest.fn();
    const writeManifest = jest.fn(async () => {
      expect(release).not.toHaveBeenCalled();
    });

    await runAdminPasswordMigration(harness.options, {
      actualDatabaseIdentity: 'db.internal:3306/kt',
      dataSource: harness.dataSource as any,
      inspectBackupPath: () => createPathInspection({ release }),
      inspectManifestPath: () => createMissingManifestInspection(),
      logger: harness.logger,
      passwordHashService: harness.passwordHashService as any,
      writeManifest,
    });

    expect(writeManifest).toHaveBeenCalledTimes(2);
    expect(harness.dataSource.destroy).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(harness.dataSource.destroy.mock.invocationCallOrder[0]).toBeLessThan(
      release.mock.invocationCallOrder[0],
    );
  });

  it('is idempotent when every password already uses the locked format', async () => {
    const harness = createHarness(
      [
        { id: '1', password: VERSIONED_HASH },
        { id: '2', password: VERSIONED_HASH },
      ],
      'execute',
    );

    const manifest = await harness.run();

    expect(harness.passwordHashService.hashPassword).not.toHaveBeenCalled();
    expect(harness.query).toHaveBeenCalledTimes(1);
    expect(manifest.counts).toEqual({
      migrated: 0,
      pending: 0,
      scanned: 2,
      skipped: 2,
    });
  });

  it('reports verify failure without updating rows', async () => {
    const harness = createHarness(
      [
        { id: '1', password: VERSIONED_HASH },
        { id: '2', password: 'plaintext-two' },
      ],
      'verify',
    );

    const manifest = await harness.run();

    expect(manifest.status).toBe('verification-failed');
    expect(manifest.ids.pending).toEqual(['2']);
    expect(harness.query).toHaveBeenCalledTimes(1);
    expect(harness.queryRunner.startTransaction).not.toHaveBeenCalled();
  });

  it('rolls back the complete transaction when any row fails', async () => {
    const harness = createHarness(
      [
        { id: '1', password: 'plaintext-one' },
        { id: '2', password: 'plaintext-two' },
      ],
      'execute',
    );
    harness.passwordHashService.hashPassword
      .mockResolvedValueOnce('hashed:plaintext-one')
      .mockRejectedValueOnce(new Error('hash failed'));

    await expect(harness.run()).rejects.toThrow('hash failed');

    expect(harness.queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(harness.queryRunner.commitTransaction).not.toHaveBeenCalled();
    expect(harness.manifests.at(-1)).toMatchObject({
      mode: 'execute',
      status: 'failed',
    });
  });

  it('rolls back when the prepared manifest cannot be written', async () => {
    const harness = createHarness(
      [{ id: '1', password: 'plaintext-one' }],
      'execute',
    );
    const manifestError = new Error('manifest write failed');
    harness.writeManifest.mockRejectedValueOnce(manifestError);

    await expect(harness.run()).rejects.toBe(manifestError);

    expect(harness.queryRunner.commitTransaction).not.toHaveBeenCalled();
    expect(harness.queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(harness.manifests.at(-1)).toMatchObject({
      mode: 'execute',
      status: 'failed',
    });
  });

  it('keeps prepared evidence when final manifest write fails after commit', async () => {
    const harness = createHarness(
      [{ id: '1', password: 'plaintext-one' }],
      'execute',
    );
    const manifestError = new Error('manifest finalization failed');
    harness.writeManifest
      .mockImplementationOnce(async (_path, manifest) => {
        harness.manifests.push(structuredClone(manifest));
      })
      .mockRejectedValueOnce(manifestError);

    await expect(harness.run()).rejects.toBe(manifestError);

    expect(harness.queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(harness.queryRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(harness.manifests).toEqual([
      expect.objectContaining({
        mode: 'execute',
        status: 'prepared',
      }),
    ]);
  });

  it('records commit-unknown with migrated IDs when COMMIT throws and rollback succeeds', async () => {
    const harness = createHarness(
      [{ id: '1', password: 'plaintext-one' }],
      'execute',
    );
    const commitError = new Error('commit outcome unknown');
    harness.queryRunner.commitTransaction.mockRejectedValue(commitError);

    await expect(harness.run()).rejects.toBe(commitError);

    expect(harness.queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(harness.manifests.at(-1)).toMatchObject({
      counts: {
        migrated: 1,
        pending: 0,
        scanned: 1,
        skipped: 0,
      },
      ids: {
        migrated: ['1'],
        pending: [],
        skipped: [],
      },
      mode: 'execute',
      status: 'commit-unknown',
    });
    expect(harness.logger.error).toHaveBeenCalledWith(
      'Admin password migration commit outcome is unknown; run --verify before retrying',
    );
  });

  it('preserves a commit error when rollback and cleanup also fail', async () => {
    const harness = createHarness(
      [{ id: '1', password: 'plaintext-one' }],
      'execute',
    );
    const commitError = new Error('commit failed');
    harness.queryRunner.commitTransaction.mockRejectedValue(commitError);
    harness.queryRunner.rollbackTransaction.mockRejectedValue(
      new Error('rollback failed'),
    );
    harness.queryRunner.release.mockRejectedValue(new Error('release failed'));
    harness.dataSource.destroy.mockRejectedValue(new Error('destroy failed'));

    await expect(harness.run()).rejects.toBe(commitError);

    expect(harness.queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(harness.manifests.at(-1)).toMatchObject({
      counts: expect.objectContaining({
        migrated: 1,
        pending: 0,
      }),
      ids: expect.objectContaining({
        migrated: ['1'],
        pending: [],
      }),
      mode: 'execute',
      status: 'commit-unknown',
    });
  });

  it('never places plaintext, hashes, or database credentials in the manifest', async () => {
    const harness = createHarness(
      [
        { id: 'secret-id', password: 'plaintext-secret' },
        { id: 'hashed-id', password: VERSIONED_HASH },
      ],
      'dry-run',
    );

    await harness.run();

    const serialized = JSON.stringify(harness.manifests);
    expect(serialized).toContain('secret-id');
    expect(serialized).not.toContain('plaintext-secret');
    expect(serialized).not.toContain('$pbkdf2-sha256$');
    expect(serialized).not.toContain('must-not-leak');
    expect(
      JSON.stringify([
        harness.logger.log.mock.calls,
        harness.logger.error.mock.calls,
      ]),
    ).not.toContain('plaintext-secret');
  });
});
