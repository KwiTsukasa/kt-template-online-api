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

/**
 * 从`argv`、`env`解析管理端密码迁移选项；先通过 `assertAdminPasswordMigrationManifestPath` 校验输入边界。
 * @param argv - 用于管理端密码迁移选项的领域对象，包含 `length`、`index`、`index + 1` 字段。
 * @param env - 用于管理端密码迁移选项的领域对象，包含 `ADMIN_PASSWORD_MIGRATION_BACKUP_PATH`、`ADMIN_PASSWORD_MIGRATION_DATABASE_IDENTITY`、`ADMIN_PASSWORD_MIGRATION_MAINTENANCE_CONFIRMED`、`ADMIN_PASSWORD_MIGRATION_MANIFEST_PATH` 字段；省略时默认采用 `process.env`。
 * @returns 包含 `backupPath`、`databaseIdentity`、`maintenanceConfirmed`、`manifestPath`、`mode` 字段的管理端密码迁移选项。
 * @throws 当 `specifiedOptions.has(argument)` 成立时拒绝当前输入并抛出 `AdminPasswordMigrationUsageError`；当 `!value || value.startsWith('--')` 成立时拒绝当前输入并抛出 `AdminPasswordMigrationUsageError`；
 *   当 `argument !== '--backup-path' && argument !== '--database-identity' && a…` 成立时拒绝当前输入并抛出 `AdminPasswordMigrationUsageError`；
 *   当 `modes.length !== 1` 成立时拒绝当前输入并抛出 `AdminPasswordMigrationUsageError`；当 `!manifestPath` 成立时拒绝当前输入并抛出 `AdminPasswordMigrationUsageError`。
 */
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

/**
 * 根据`env`构造管理端密码迁移数据库身份。
 * @param env - 用于管理端密码迁移数据库身份的领域对象，包含 `DB_HOST`、`DB_PORT`、`DB_DATABASE` 字段。
 * @returns 按参数编码并拼接完成的管理端密码迁移数据库身份。
 * @throws 当 `!host || !database` 成立时拒绝当前输入并抛出 `AdminPasswordMigrationUsageError`。
 */
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

/**
 * 根据`options`、`dependencies`处理管理端密码迁移；先通过 `assertAdminPasswordMigrationManifestPath` 校验输入边界。
 * @param options - 控制管理端密码迁移筛选、缓存或输出方式的可选项，包含 `manifestPath`、`mode` 字段。
 * @param dependencies - 用于管理端密码迁移的领域对象，包含 `inspectManifestPath`、`writeManifest`、`dataSource`、`passwordHashService` 字段。
 * @returns 管理端密码迁移。
 * @throws 当 `assertManifestPathIsNew` 调用失败时重新抛出该入口捕获且决定公开的原异常；当 `readAffectedRows(updateResult) !== 1` 成立时拒绝当前输入并抛出 `Error`；
 *   当 `dependencies.dataSource.initialize` 或 `dependencies.dataSource.createQueryRunner` 调用失败时重新抛出该入口捕获且决定公开的原异常；当 `operationError === undefined` 成立时拒绝当前输入并抛出 `cleanupErrors[0]`。
 */
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
      (() => {
        if (manifestPublished) {
          return 'replace';
        }
        return 'create';
      })(),
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
       ORDER BY id${(() => {
         if (options.mode === 'execute') {
           return ' FOR UPDATE';
         }
         return '';
       })()}`,
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
        if (rollbackFailed) {
          manifest.status = 'rollback-failed';
        } else {
          manifest.status = 'failed';
        }
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
      (() => {
        if (committed) {
          return 'Admin password migration committed; manifest finalization failed';
        }
        if (commitOutcomeUnknown) {
          return 'Admin password migration commit outcome is unknown; run --verify before retrying';
        }
        return 'Admin password migration failed';
      })(),
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

/**
 * 校验`options`、`dependencies`、`manifestInspection`是否满足执行安全性约束，并拒绝不合法输入。
 * @param options - 控制执行安全性筛选、缓存或输出方式的可选项，包含 `mode`、`databaseIdentity`、`maintenanceConfirmed`、`backupPath` 字段。
 * @param dependencies - 用于执行安全性的领域对象，包含 `actualDatabaseIdentity`、`inspectBackupPath` 字段。
 * @param manifestInspection - 用于执行安全性的领域对象，包含 `exists`、`identity` 字段。
 * @returns 执行安全性；没有可用结果或提前结束时为 `undefined`。
 * @throws 执行模式缺少数据库身份、维护确认或备份路径，身份不匹配，或备份文件不稳定、不可读、为空、含符号链接或与清单同一文件时抛出 `AdminPasswordMigrationUsageError`。
 */
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
    if (!backup.stable || !backup.exists || !backup.identity) {
      throw new AdminPasswordMigrationUsageError(
        '备份路径必须是可读的非空普通文件',
      );
    }
    if (!backup.isFile || !backup.readable || backup.size < 1) {
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

/**
 * 校验`path`是否满足管理端密码迁移清单路径约束，并拒绝不合法输入。
 * @param path - 必须保持在受控根目录内的路径。
 * @throws 当 `!target.includes(workspaceSegment) || !target.endsWith('.json')` 成立时拒绝当前输入并抛出 `AdminPasswordMigrationUsageError`。
 */
function assertAdminPasswordMigrationManifestPath(path: string) {
  const target = resolve(path);
  const workspaceSegment = `${sep}.kt-workspace${sep}`;
  if (!target.includes(workspaceSegment) || !target.endsWith('.json')) {
    throw new AdminPasswordMigrationUsageError(
      'manifest 必须由调用方指定为 .kt-workspace 下的 JSON 文件',
    );
  }
}

/**
 * 校验`inspection`是否满足清单路径安全性约束，并拒绝不合法输入。
 * @param inspection - 用于清单路径安全性的领域对象，包含 `parentHasSymbolicLink`、`isSymbolicLink`、`stable`、`exists` 字段。
 * @throws 当 `inspection.parentHasSymbolicLink` 成立时拒绝当前输入并抛出 `AdminPasswordMigrationUsageError`；当 `inspection.isSymbolicLink` 成立时拒绝当前输入并抛出 `AdminPasswordMigrationUsageError`；
 *   当 `!inspection.stable || (inspection.exists && (!inspection.isFile || !ins…` 成立时拒绝当前输入并抛出 `AdminPasswordMigrationUsageError`。
 */
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

/**
 * 校验`inspection`是否满足清单路径是否新建约束，并拒绝不合法输入。
 * @param inspection - 用于清单路径是否新建的领域对象，包含 `exists` 字段。
 * @throws 当 `inspection.exists` 成立时拒绝当前输入并抛出 `AdminPasswordMigrationUsageError`。
 */
function assertManifestPathIsNew(
  inspection: AdminPasswordMigrationPathInspection,
) {
  if (inspection.exists) {
    throw new AdminPasswordMigrationUsageError(
      'manifest 必须使用不存在的新路径',
    );
  }
}

/**
 * 创建清单，并输出固定投影 `counts`、`ids`、`mode`、`status` 字段。
 * @param mode - 选择清单处理分支的模式值。
 * @returns 包含 `counts`、`ids`、`mode`、`status` 字段的清单。
 */
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

/**
 * 根据`env`构造数据来源。
 * @param env - 用于数据来源的领域对象，包含 `DB_PORT`、`DB_HOST`、`DB_USERNAME`、`DB_DATABASE` 字段。
 * @returns 完成初始化并携带当前边界配置的数据来源。
 * @throws 当 `!env.DB_HOST || !env.DB_USERNAME || !env.DB_DATABASE` 成立时拒绝当前输入并抛出 `AdminPasswordMigrationUsageError`；
 *   当 `!Number.isInteger(port) || port < 1 || port > 65_535` 成立时拒绝当前输入并抛出 `AdminPasswordMigrationUsageError`。
 */
function createDataSource(env: NodeJS.ProcessEnv) {
  const port = Number(env.DB_PORT || 3306);
  if (!env.DB_HOST || !env.DB_USERNAME || !env.DB_DATABASE) {
    throw new AdminPasswordMigrationUsageError('数据库连接参数不完整');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
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

/**
 * 将`manifest`转换为清单摘要。
 * @param manifest - 用于清单摘要的领域对象，包含 `mode`、`status`、`counts` 字段。
 * @returns 清单摘要。
 */
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

/**
 * 按指定日志级别写入迁移消息；日志器缺少对应方法时跳过，不影响迁移结果。
 * @param logger - 用于按指定日志级别写入迁移消息的领域对象，包含 `level` 字段。
 * @param level - 决定按指定日志级别写入迁移消息内容、边界或目标的 `level` 值。
 * @param message - 包含正文、发送目标与账号身份的待处理消息。
 */
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

/**
 * 按`result`读取受影响的行。
 * @param result - 用于受影响的行的领域对象，包含 `0` 字段。
 * @returns 受影响的行。
 */
function readAffectedRows(result: any) {
  const header = (() => {
    if (Array.isArray(result)) {
      return result[0];
    }
    return result;
  })();
  return Number(header?.affectedRows);
}

/**
 * 根据`path`、`manifest`、`publishMode`更新管理端密码迁移清单；把变更持久化到当前存储（`writeFile`）。
 * @param path - 必须保持在受控根目录内的路径。
 * @param manifest - 决定管理端密码迁移清单内容、边界或目标的 `manifest` 值。
 * @param publishMode - 决定管理端密码迁移清单内容、边界或目标的 `publishMode` 值；省略时默认采用 `'create'`。
 * @throws 当 `!initialInspection.exists` 成立时拒绝当前输入并抛出 `AdminPasswordMigrationUsageError`；当 `!preparedInspection.exists` 成立时拒绝当前输入并抛出 `AdminPasswordMigrationUsageError`；
 *   当 `!publishInspection.exists` 成立时拒绝当前输入并抛出 `AdminPasswordMigrationUsageError`；当 `writeFile` 或 `JSON.stringify` 调用失败时重新抛出该入口捕获且决定公开的原异常；
 *   当 `writeError === undefined` 成立时重新抛出该入口捕获且决定公开的原异常。
 */
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

/**
 * 创建路径检查，并输出固定投影 `exists`、`isFile`、`isSymbolicLink`、`parentHasSymbolicLink`、`readable` 字段。
 * @param overrides - 决定路径Inspection内容、边界或目标的 `overrides` 值；省略时默认采用 `{}`。
 * @returns 包含 `exists`、`isFile`、`isSymbolicLink`、`parentHasSymbolicLink`、`readable` 字段的路径Inspection。
 */
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

/**
 * 逐级检查目标路径到文件系统根之间是否含符号链接，用于阻止迁移清单越过受控路径。
 * @param path - 必须保持在受控根目录内的路径。
 * @returns 满足路径ContainsSymbolicLink约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
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

/**
 * 根据`path`拼接稳定的管理端密码清单路径，用于隔离对应资源或存储记录；当 `parentHasSymbolicLink` 成立时返回 `createPathInspection({ parentHasSymbolicLin…`。
 * @param path - 必须保持在受控根目录内的路径。
 * @returns 管理端密码清单路径。
 */
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

/**
 * 根据`path`拼接稳定的管理端密码备份路径，用于隔离对应资源或存储记录；当 `parentHasSymbolicLink` 成立时返回 `createPathInspection({ parentHasSymbolicLin…`。
 * @param path - 必须保持在受控根目录内的路径。
 * @returns 管理端密码备份路径。
 */
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

/**
 * 调用路径检查结果的释放函数；释放失败由调用方的清理边界处理。
 * @param inspection - 用于调用路径检查结果的释放函数的领域对象，包含 `release` 字段。
 */
function releasePathInspectionSafely(
  inspection: AdminPasswordMigrationPathInspection,
) {
  try {
    inspection.release();
  } catch {
    // 路径门禁错误优先，关闭只读备份描述符失败不得掩盖原始拒绝原因。
  }
}

/**
 * 解析管理员密码迁移参数，核对目标数据库身份并执行迁移；验收失败时把进程退出码设为 `1`。
 */
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
