import { closeSync, constants, fstatSync, lstatSync, openSync } from 'node:fs';
import { link, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, parse, relative, resolve, sep } from 'node:path';

import { DataSource } from 'typeorm';
import { AdminPasswordHashService } from '@/modules/admin/identity/auth/application/admin-password-hash.service';

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

export type AdminPasswordMigrationPathInspection = {
  exists: boolean;
  identity?: string;
  isFile: boolean;
  isSymbolicLink: boolean;
  parentHasSymbolicLink: boolean;
  readable: boolean;
  release(): void;
  size: number;
  stable: boolean;
};

type AdminPasswordManifestPublishMode = 'create' | 'replace';

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
  inspectBackupPath(path: string): AdminPasswordMigrationPathInspection;
  inspectManifestPath(path: string): AdminPasswordMigrationPathInspection;
  logger: Pick<Console, 'error' | 'log'>;
  passwordHashService: Pick<
    AdminPasswordHashService,
    'hashPassword' | 'isPasswordHash'
  >;
  writeManifest(
    path: string,
    manifest: AdminPasswordMigrationManifest,
    publishMode?: AdminPasswordManifestPublishMode,
  ): Promise<void>;
};

type AdminPasswordMigrationRow = {
  id: string;
  password: string;
};

class AdminPasswordMigrationUsageError extends Error {}

/** 解析管理端密码迁移选项。 */
export function parseAdminPasswordMigrationOptions(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): AdminPasswordMigrationOptions {
  const modes: AdminPasswordMigrationMode[] = [];
  const specifiedOptions = new Set<string>();
  let backupPath = env.ADMIN_PASSWORD_MIGRATION_BACKUP_PATH?.trim();
  let databaseIdentity = env.ADMIN_PASSWORD_MIGRATION_DATABASE_IDENTITY?.trim();
  let maintenanceConfirmed =
    env.ADMIN_PASSWORD_MIGRATION_MAINTENANCE_CONFIRMED === 'true';
  let manifestPath = env.ADMIN_PASSWORD_MIGRATION_MANIFEST_PATH?.trim();

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
      if (specifiedOptions.has(argument)) {
        throw new AdminPasswordMigrationUsageError(
          `参数 ${argument} 只能指定一次`,
        );
      }
      specifiedOptions.add(argument);
      maintenanceConfirmed = true;
      continue;
    }

    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new AdminPasswordMigrationUsageError(`参数 ${argument} 缺少值`);
    }
    if (
      argument !== '--backup-path' &&
      argument !== '--database-identity' &&
      argument !== '--manifest-path'
    ) {
      throw new AdminPasswordMigrationUsageError(`未知参数 ${argument}`);
    }
    if (specifiedOptions.has(argument)) {
      throw new AdminPasswordMigrationUsageError(
        `参数 ${argument} 只能指定一次`,
      );
    }
    specifiedOptions.add(argument);

    if (argument === '--backup-path') {
      backupPath = value;
    } else if (argument === '--database-identity') {
      databaseIdentity = value;
    } else {
      manifestPath = value;
    }
    index += 1;
  }

  if (modes.length !== 1) {
    throw new AdminPasswordMigrationUsageError('必须且只能指定一个迁移模式');
  }
  if (!manifestPath) {
    throw new AdminPasswordMigrationUsageError(
      '必须由调用方指定 manifest 路径',
    );
  }
  assertAdminPasswordMigrationManifestPath(manifestPath);

  return {
    backupPath,
    databaseIdentity,
    maintenanceConfirmed,
    manifestPath,
    mode: modes[0],
  };
}

/** 构建管理端密码迁移数据库身份。 */
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

/** 执行管理端密码迁移。 */
export async function runAdminPasswordMigration(
  options: AdminPasswordMigrationOptions,
  dependencies: AdminPasswordMigrationDependencies,
) {
  assertAdminPasswordMigrationManifestPath(options.manifestPath);
  const manifestInspection = dependencies.inspectManifestPath(
    options.manifestPath,
  );
  assertManifestPathSafety(manifestInspection);
  const pathSafetyLease = assertExecuteSafety(
    options,
    dependencies,
    manifestInspection,
  );
  try {
    assertManifestPathIsNew(manifestInspection);
  } catch (error) {
    if (pathSafetyLease) releasePathInspectionSafely(pathSafetyLease);
    throw error;
  }

  const manifest = createManifest(options.mode);
  let initialized = false;
  let queryRunner: AdminPasswordMigrationQueryRunner | undefined;
  let transactionStarted = false;
  let commitAttempted = false;
  let committed = false;
  let initiallyPendingIds: string[] = [];
  let operationError: unknown;
  let manifestPublished = false;
  const persistManifest = async () => {
    await dependencies.writeManifest(
      options.manifestPath,
      manifest,
      manifestPublished ? 'replace' : 'create',
    );
    manifestPublished = true;
  };

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
      await persistManifest();

      commitAttempted = true;
      await queryRunner.commitTransaction();
      transactionStarted = false;
      committed = true;
      manifest.status = 'completed';
      await persistManifest();
    } else if (options.mode === 'verify' && manifest.counts.pending > 0) {
      manifest.status = 'verification-failed';
    }

    if (options.mode !== 'execute') {
      await persistManifest();
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
        await persistManifest();
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
    if (pathSafetyLease) {
      try {
        pathSafetyLease.release();
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

/** 断言执行安全性。 */
function assertExecuteSafety(
  options: AdminPasswordMigrationOptions,
  dependencies: AdminPasswordMigrationDependencies,
  manifestInspection: AdminPasswordMigrationPathInspection,
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
  if (resolve(options.backupPath) === resolve(options.manifestPath)) {
    throw new AdminPasswordMigrationUsageError('备份路径不能与 manifest 相同');
  }
  const backup = dependencies.inspectBackupPath(options.backupPath);
  try {
    if (backup.parentHasSymbolicLink) {
      throw new AdminPasswordMigrationUsageError('备份父路径不能包含符号链接');
    }
    if (backup.isSymbolicLink) {
      throw new AdminPasswordMigrationUsageError('备份路径不能包含符号链接');
    }
    if (
      !backup.stable ||
      !backup.exists ||
      !backup.identity ||
      !backup.isFile ||
      !backup.readable ||
      backup.size < 1
    ) {
      throw new AdminPasswordMigrationUsageError(
        '备份路径必须是可读的非空普通文件',
      );
    }
    if (
      manifestInspection.exists &&
      manifestInspection.identity === backup.identity
    ) {
      throw new AdminPasswordMigrationUsageError(
        '备份路径不能与 manifest 指向同一文件',
      );
    }
  } catch (error) {
    releasePathInspectionSafely(backup);
    throw error;
  }
  return backup;
}

/** 断言管理端密码迁移清单路径。 */
function assertAdminPasswordMigrationManifestPath(path: string) {
  const target = resolve(path);
  const workspaceSegment = `${sep}.kt-workspace${sep}`;
  if (!target.includes(workspaceSegment) || !target.endsWith('.json')) {
    throw new AdminPasswordMigrationUsageError(
      'manifest 必须由调用方指定为 .kt-workspace 下的 JSON 文件',
    );
  }
}

/** 断言清单路径安全性。 */
function assertManifestPathSafety(
  inspection: AdminPasswordMigrationPathInspection,
) {
  if (inspection.parentHasSymbolicLink) {
    throw new AdminPasswordMigrationUsageError(
      'manifest 父路径不能包含符号链接',
    );
  }
  if (inspection.isSymbolicLink) {
    throw new AdminPasswordMigrationUsageError('manifest 不能是符号链接');
  }
  if (
    !inspection.stable ||
    (inspection.exists && (!inspection.isFile || !inspection.identity))
  ) {
    throw new AdminPasswordMigrationUsageError(
      'manifest 路径必须是普通文件或可安全创建的新文件',
    );
  }
}

/** 断言清单路径是否新建。 */
function assertManifestPathIsNew(
  inspection: AdminPasswordMigrationPathInspection,
) {
  if (inspection.exists) {
    throw new AdminPasswordMigrationUsageError(
      'manifest 必须使用不存在的新路径',
    );
  }
}

/** 创建清单。 */
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

/** 创建数据来源。 */
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

/** 格式化清单摘要。 */
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

/** 返回日志安全地。 */
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

/** 读取受影响的行。 */
function readAffectedRows(result: any) {
  const header = Array.isArray(result) ? result[0] : result;
  return Number(header?.affectedRows);
}

/** 写入管理端密码迁移清单。 */
export async function writeAdminPasswordMigrationManifest(
  path: string,
  manifest: AdminPasswordMigrationManifest,
  publishMode: AdminPasswordManifestPublishMode = 'create',
) {
  const target = resolve(path);
  assertAdminPasswordMigrationManifestPath(target);
  const initialInspection = inspectAdminPasswordManifestPath(target);
  assertManifestPathSafety(initialInspection);
  if (publishMode === 'create') {
    assertManifestPathIsNew(initialInspection);
  } else if (!initialInspection.exists) {
    throw new AdminPasswordMigrationUsageError('manifest 更新要求现有普通文件');
  }
  await mkdir(dirname(target), { recursive: true });
  const preparedInspection = inspectAdminPasswordManifestPath(target);
  assertManifestPathSafety(preparedInspection);
  if (publishMode === 'create') {
    assertManifestPathIsNew(preparedInspection);
  } else if (!preparedInspection.exists) {
    throw new AdminPasswordMigrationUsageError('manifest 更新要求现有普通文件');
  }
  const temporaryPath = `${target}.${process.pid}.${Date.now()}.tmp`;
  let writeError: unknown;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    const publishInspection = inspectAdminPasswordManifestPath(target);
    assertManifestPathSafety(publishInspection);
    if (publishMode === 'create') {
      assertManifestPathIsNew(publishInspection);
      await link(temporaryPath, target);
    } else {
      if (!publishInspection.exists) {
        throw new AdminPasswordMigrationUsageError(
          'manifest 更新要求现有普通文件',
        );
      }
      await rename(temporaryPath, target);
    }
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

/** 创建路径检查。 */
function createPathInspection(
  overrides: Partial<AdminPasswordMigrationPathInspection> = {},
): AdminPasswordMigrationPathInspection {
  return {
    exists: false,
    isFile: false,
    isSymbolicLink: false,
    parentHasSymbolicLink: false,
    readable: false,
    release: () => {},
    size: 0,
    stable: true,
    ...overrides,
  };
}

/** 返回路径包含符号化的链接。 */
function pathContainsSymbolicLink(path: string) {
  const target = resolve(path);
  const root = parse(target).root;
  const components = relative(root, target).split(sep).filter(Boolean);
  let current = root;

  for (const component of components) {
    current = join(current, component);
    try {
      if (lstatSync(current).isSymbolicLink()) return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      return true;
    }
  }
  return false;
}

/** 检查管理端密码清单路径。 */
export function inspectAdminPasswordManifestPath(
  path: string,
): AdminPasswordMigrationPathInspection {
  const target = resolve(path);
  const parentHasSymbolicLink = pathContainsSymbolicLink(dirname(target));
  if (parentHasSymbolicLink) {
    return createPathInspection({ parentHasSymbolicLink });
  }
  try {
    const stat = lstatSync(target, { bigint: true });
    return createPathInspection({
      exists: true,
      identity: `${stat.dev}:${stat.ino}`,
      isFile: stat.isFile(),
      isSymbolicLink: stat.isSymbolicLink(),
      parentHasSymbolicLink,
      readable: stat.isFile(),
      size: Number(stat.size),
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return createPathInspection({ parentHasSymbolicLink });
    }
    return createPathInspection({
      parentHasSymbolicLink,
      stable: false,
    });
  }
}

/** 检查管理端密码备份路径。 */
export function inspectAdminPasswordBackupPath(
  path: string,
): AdminPasswordMigrationPathInspection {
  const target = resolve(path);
  const parentHasSymbolicLink = pathContainsSymbolicLink(dirname(target));
  if (parentHasSymbolicLink) {
    return createPathInspection({ parentHasSymbolicLink });
  }
  let pathStat;
  try {
    pathStat = lstatSync(target, { bigint: true });
  } catch (error) {
    return createPathInspection({
      parentHasSymbolicLink,
      stable: (error as NodeJS.ErrnoException).code === 'ENOENT',
    });
  }
  if (pathStat.isSymbolicLink()) {
    return createPathInspection({
      exists: true,
      identity: `${pathStat.dev}:${pathStat.ino}`,
      isSymbolicLink: true,
      parentHasSymbolicLink,
    });
  }
  if (!pathStat.isFile()) {
    return createPathInspection({
      exists: true,
      identity: `${pathStat.dev}:${pathStat.ino}`,
      parentHasSymbolicLink,
      size: Number(pathStat.size),
    });
  }

  let descriptor: number | undefined;
  try {
    descriptor = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(descriptor, { bigint: true });
    const pathIdentity = `${pathStat.dev}:${pathStat.ino}`;
    const descriptorIdentity = `${stat.dev}:${stat.ino}`;
    let released = false;
    return createPathInspection({
      exists: true,
      identity: descriptorIdentity,
      isFile: stat.isFile(),
      parentHasSymbolicLink,
      readable: true,
      release: () => {
        if (released) return;
        released = true;
        closeSync(descriptor);
      },
      size: Number(stat.size),
      stable: pathIdentity === descriptorIdentity,
    });
  } catch {
    if (descriptor !== undefined) closeSync(descriptor);
    return createPathInspection({
      exists: true,
      isFile: pathStat.isFile(),
      parentHasSymbolicLink,
      size: Number(pathStat.size),
      stable: false,
    });
  }
}

/** 释放路径检查安全地。 */
function releasePathInspectionSafely(
  inspection: AdminPasswordMigrationPathInspection,
) {
  try {
    inspection.release();
  } catch {
    // 路径门禁错误优先，关闭只读备份描述符失败不得掩盖原始拒绝原因。
  }
}

/** 执行当前模块的主流程。 */
async function main() {
  const options = parseAdminPasswordMigrationOptions(process.argv.slice(2));
  const actualDatabaseIdentity = buildAdminPasswordMigrationDatabaseIdentity(
    process.env,
  );
  const dataSource = createDataSource(process.env);
  const manifest = await runAdminPasswordMigration(options, {
    actualDatabaseIdentity,
    dataSource,
    inspectBackupPath: inspectAdminPasswordBackupPath,
    inspectManifestPath: inspectAdminPasswordManifestPath,
    logger: console,
    passwordHashService: new AdminPasswordHashService(),
    writeManifest: writeAdminPasswordMigrationManifest,
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
