import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { DataSource } from 'typeorm';
import { AdminPasswordHashService } from '../modules/admin/identity/auth/admin-password-hash.service';

export type AdminPasswordMigrationMode = 'dry-run' | 'execute' | 'verify';

export type AdminPasswordMigrationOptions = {
  backupPath?: string;
  databaseIdentity?: string;
  maintenanceConfirmed: boolean;
  manifestPath: string;
  mode: AdminPasswordMigrationMode;
};

export type AdminPasswordMigrationManifest = {
  counts: {
    migrated: number;
    pending: number;
    scanned: number;
    skipped: number;
  };
  ids: {
    migrated: string[];
    pending: string[];
    skipped: string[];
  };
  mode: AdminPasswordMigrationMode;
  status:
    | 'completed'
    | 'commit-unknown'
    | 'failed'
    | 'prepared'
    | 'rollback-failed'
    | 'verification-failed';
};

type AdminPasswordMigrationQueryRunner = {
  commitTransaction(): Promise<unknown>;
  connect(): Promise<unknown>;
  query(query: string, parameters?: unknown[]): Promise<any>;
  release(): Promise<unknown>;
  rollbackTransaction(): Promise<unknown>;
  startTransaction(): Promise<unknown>;
};

type AdminPasswordMigrationDataSource = {
  createQueryRunner(): AdminPasswordMigrationQueryRunner;
  destroy(): Promise<unknown>;
  initialize(): Promise<unknown>;
};

type AdminPasswordMigrationDependencies = {
  actualDatabaseIdentity: string;
  dataSource: AdminPasswordMigrationDataSource;
  logger: Pick<Console, 'error' | 'log'>;
  passwordHashService: Pick<
    AdminPasswordHashService,
    'hashPassword' | 'isPasswordHash'
  >;
  pathExists(path: string): boolean;
  writeManifest(
    path: string,
    manifest: AdminPasswordMigrationManifest,
  ): Promise<void>;
};

type AdminPasswordMigrationRow = {
  id: string;
  password: string;
};

const DEFAULT_MANIFEST_PATH = resolve(
  __dirname,
  '../../../..',
  '.kt-workspace',
  'db-sync',
  'admin-password-migration-manifest.json',
);

class AdminPasswordMigrationUsageError extends Error {}

export function parseAdminPasswordMigrationOptions(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): AdminPasswordMigrationOptions {
  const modes: AdminPasswordMigrationMode[] = [];
  let backupPath = env.ADMIN_PASSWORD_MIGRATION_BACKUP_PATH?.trim();
  let databaseIdentity = env.ADMIN_PASSWORD_MIGRATION_DATABASE_IDENTITY?.trim();
  let maintenanceConfirmed =
    env.ADMIN_PASSWORD_MIGRATION_MAINTENANCE_CONFIRMED === 'true';
  let manifestPath =
    env.ADMIN_PASSWORD_MIGRATION_MANIFEST_PATH?.trim() || DEFAULT_MANIFEST_PATH;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') {
      modes.push('dry-run');
      continue;
    }
    if (argument === '--execute') {
      modes.push('execute');
      continue;
    }
    if (argument === '--verify') {
      modes.push('verify');
      continue;
    }
    if (argument === '--maintenance-confirmed') {
      maintenanceConfirmed = true;
      continue;
    }

    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new AdminPasswordMigrationUsageError(`参数 ${argument} 缺少值`);
    }
    if (argument === '--backup-path') {
      backupPath = value;
    } else if (argument === '--database-identity') {
      databaseIdentity = value;
    } else if (argument === '--manifest-path') {
      manifestPath = value;
    } else {
      throw new AdminPasswordMigrationUsageError(`未知参数 ${argument}`);
    }
    index += 1;
  }

  if (modes.length !== 1) {
    throw new AdminPasswordMigrationUsageError('必须且只能指定一个迁移模式');
  }

  return {
    backupPath,
    databaseIdentity,
    maintenanceConfirmed,
    manifestPath,
    mode: modes[0],
  };
}

export function buildAdminPasswordMigrationDatabaseIdentity(
  env: NodeJS.ProcessEnv,
) {
  const host = env.DB_HOST?.trim();
  const port = env.DB_PORT?.trim() || '3306';
  const database = env.DB_DATABASE?.trim();
  if (!host || !database) {
    throw new AdminPasswordMigrationUsageError('数据库连接身份不完整');
  }
  return `${host}:${port}/${database}`;
}

export async function runAdminPasswordMigration(
  options: AdminPasswordMigrationOptions,
  dependencies: AdminPasswordMigrationDependencies,
) {
  assertExecuteSafety(options, dependencies);

  const manifest = createManifest(options.mode);
  let initialized = false;
  let queryRunner: AdminPasswordMigrationQueryRunner | undefined;
  let transactionStarted = false;
  let commitAttempted = false;
  let committed = false;
  let initiallyPendingIds: string[] = [];
  let operationError: unknown;

  try {
    await dependencies.dataSource.initialize();
    initialized = true;
    queryRunner = dependencies.dataSource.createQueryRunner();
    await queryRunner.connect();

    if (options.mode === 'execute') {
      await queryRunner.startTransaction();
      transactionStarted = true;
    }

    const rows = (await queryRunner.query(
      `SELECT CAST(id AS CHAR) AS id, password
       FROM admin_user
       ORDER BY id${options.mode === 'execute' ? ' FOR UPDATE' : ''}`,
    )) as AdminPasswordMigrationRow[];

    for (const row of rows) {
      const id = String(row.id);
      manifest.counts.scanned += 1;
      if (dependencies.passwordHashService.isPasswordHash(row.password)) {
        manifest.ids.skipped.push(id);
        manifest.counts.skipped += 1;
      } else {
        manifest.ids.pending.push(id);
        manifest.counts.pending += 1;
      }
    }
    initiallyPendingIds = [...manifest.ids.pending];

    if (options.mode === 'execute') {
      for (const row of rows) {
        const id = String(row.id);
        if (!manifest.ids.pending.includes(id)) continue;

        const passwordHash =
          await dependencies.passwordHashService.hashPassword(row.password);
        const updateResult = await queryRunner.query(
          'UPDATE admin_user SET password = ? WHERE id = ?',
          [passwordHash, id],
        );
        if (readAffectedRows(updateResult) !== 1) {
          throw new Error('Admin password migration row update failed');
        }

        manifest.ids.migrated.push(id);
        manifest.counts.migrated += 1;
      }

      manifest.ids.pending = [];
      manifest.counts.pending = 0;
      manifest.status = 'prepared';
      await dependencies.writeManifest(options.manifestPath, manifest);

      commitAttempted = true;
      await queryRunner.commitTransaction();
      transactionStarted = false;
      committed = true;
      manifest.status = 'completed';
      await dependencies.writeManifest(options.manifestPath, manifest);
    } else if (options.mode === 'verify' && manifest.counts.pending > 0) {
      manifest.status = 'verification-failed';
    }

    if (options.mode !== 'execute') {
      await dependencies.writeManifest(options.manifestPath, manifest);
    }
    logSafely(dependencies.logger, 'log', formatManifestSummary(manifest));
    return manifest;
  } catch (error) {
    operationError = error;
    let rollbackFailed = false;
    if (transactionStarted && queryRunner) {
      try {
        await queryRunner.rollbackTransaction();
      } catch {
        rollbackFailed = true;
      }
      transactionStarted = false;
    }

    const commitOutcomeUnknown = commitAttempted && !committed;
    if (!committed) {
      if (commitOutcomeUnknown) {
        manifest.status = 'commit-unknown';
      } else {
        manifest.status = rollbackFailed ? 'rollback-failed' : 'failed';
        manifest.ids.migrated = [];
        manifest.counts.migrated = 0;
        manifest.ids.pending = initiallyPendingIds;
        manifest.counts.pending = initiallyPendingIds.length;
      }
      try {
        await dependencies.writeManifest(options.manifestPath, manifest);
      } catch {
        // 迁移原始错误优先，manifest 写入失败不得覆盖回滚证据。
      }
    }
    logSafely(
      dependencies.logger,
      'error',
      committed
        ? 'Admin password migration committed; manifest finalization failed'
        : commitOutcomeUnknown
          ? 'Admin password migration commit outcome is unknown; run --verify before retrying'
          : 'Admin password migration failed',
    );
    throw error;
  } finally {
    const cleanupErrors: unknown[] = [];
    if (queryRunner) {
      try {
        await queryRunner.release();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (initialized) {
      try {
        await dependencies.dataSource.destroy();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length > 0) {
      logSafely(
        dependencies.logger,
        'error',
        'Admin password migration cleanup failed',
      );
      if (operationError === undefined) {
        throw cleanupErrors[0];
      }
    }
  }
}

function assertExecuteSafety(
  options: AdminPasswordMigrationOptions,
  dependencies: AdminPasswordMigrationDependencies,
) {
  if (options.mode !== 'execute') return;
  if (!options.databaseIdentity) {
    throw new AdminPasswordMigrationUsageError(
      'execute 模式必须提供明确数据库身份',
    );
  }
  if (options.databaseIdentity !== dependencies.actualDatabaseIdentity) {
    throw new AdminPasswordMigrationUsageError('数据库身份与当前连接不一致');
  }
  if (!options.maintenanceConfirmed) {
    throw new AdminPasswordMigrationUsageError('execute 模式必须确认维护窗口');
  }
  if (!options.backupPath) {
    throw new AdminPasswordMigrationUsageError('execute 模式必须提供备份路径');
  }
  if (!dependencies.pathExists(options.backupPath)) {
    throw new AdminPasswordMigrationUsageError('备份路径不存在');
  }
}

function createManifest(
  mode: AdminPasswordMigrationMode,
): AdminPasswordMigrationManifest {
  return {
    counts: {
      migrated: 0,
      pending: 0,
      scanned: 0,
      skipped: 0,
    },
    ids: {
      migrated: [],
      pending: [],
      skipped: [],
    },
    mode,
    status: 'completed',
  };
}

function createDataSource(env: NodeJS.ProcessEnv) {
  const port = Number(env.DB_PORT || 3306);
  if (
    !env.DB_HOST ||
    !env.DB_USERNAME ||
    !env.DB_DATABASE ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    throw new AdminPasswordMigrationUsageError('数据库连接参数不完整');
  }

  return new DataSource({
    database: env.DB_DATABASE,
    host: env.DB_HOST,
    password: env.DB_PASSWORD,
    port,
    synchronize: false,
    timezone: env.DB_TIMEZONE || '+08:00',
    type: 'mysql',
    username: env.DB_USERNAME,
  });
}

function formatManifestSummary(manifest: AdminPasswordMigrationManifest) {
  return [
    `mode=${manifest.mode}`,
    `status=${manifest.status}`,
    `scanned=${manifest.counts.scanned}`,
    `migrated=${manifest.counts.migrated}`,
    `skipped=${manifest.counts.skipped}`,
    `pending=${manifest.counts.pending}`,
  ].join(' ');
}

function logSafely(
  logger: Pick<Console, 'error' | 'log'>,
  level: 'error' | 'log',
  message: string,
) {
  try {
    logger[level](message);
  } catch {
    // 日志实现不得改变迁移事务或错误传播结果。
  }
}

function readAffectedRows(result: any) {
  const header = Array.isArray(result) ? result[0] : result;
  return Number(header?.affectedRows);
}

async function writeMigrationManifest(
  path: string,
  manifest: AdminPasswordMigrationManifest,
) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  let writeError: unknown;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporaryPath, path);
  } catch (error) {
    writeError = error;
    throw error;
  } finally {
    try {
      await rm(temporaryPath, { force: true });
    } catch (error) {
      if (writeError === undefined) throw error;
    }
  }
}

async function main() {
  const options = parseAdminPasswordMigrationOptions(process.argv.slice(2));
  const actualDatabaseIdentity = buildAdminPasswordMigrationDatabaseIdentity(
    process.env,
  );
  const dataSource = createDataSource(process.env);
  const manifest = await runAdminPasswordMigration(options, {
    actualDatabaseIdentity,
    dataSource,
    logger: console,
    passwordHashService: new AdminPasswordHashService(),
    pathExists: existsSync,
    writeManifest: writeMigrationManifest,
  });
  if (manifest.status === 'verification-failed') {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main().catch((error) => {
    if (error instanceof AdminPasswordMigrationUsageError) {
      console.error(error.message);
    } else {
      console.error('Admin password migration failed');
    }
    process.exitCode = 1;
  });
}
