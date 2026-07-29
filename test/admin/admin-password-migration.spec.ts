import type { AdminPasswordMigrationOptions } from '../../src/commands/migrate-admin-passwords';
import {
  buildAdminPasswordMigrationDatabaseIdentity,
  parseAdminPasswordMigrationOptions,
  runAdminPasswordMigration,
} from '../../src/commands/migrate-admin-passwords';

const VERSIONED_HASH =
  '$pbkdf2-sha256$v=1$i=600000$AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE$acCR3Bjb48G7uQRjBo961QHqiLOtaEMb9u_X9DGlq3E';

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
    manifestPath: '/evidence/admin-passwords.json',
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
        pathExists: () => true,
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
        '/evidence/result.json',
      ]),
    ).toEqual({
      backupPath: '/backups/admin-before.sql',
      databaseIdentity: 'db.internal:3306/kt',
      maintenanceConfirmed: true,
      manifestPath: '/evidence/result.json',
      mode: 'execute',
    });
    expect(() =>
      parseAdminPasswordMigrationOptions(['--dry-run', '--verify']),
    ).toThrow('必须且只能指定一个迁移模式');
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
          logger: { error: jest.fn(), log: jest.fn() },
          passwordHashService: harness.passwordHashService as any,
          pathExists: () => true,
          writeManifest: async () => {},
        },
      ),
    ).rejects.toThrow();
    expect(harness.dataSource.initialize).not.toHaveBeenCalled();
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
