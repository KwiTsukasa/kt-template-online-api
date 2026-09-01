import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  createConnection,
  type Connection,
  type RowDataPacket,
} from 'mysql2/promise';

import { parseMysqlScript } from './migrate-bot-adapter-protocol';

const MIGRATION_LOCK = 'kt:media-governance-series-work-v1';
const MIGRATION_FILES = [
  'media-governance-series-work-v1.sql',
  'media-governance-rss-context-v2.sql',
  'media-governance-series-delete-v1.sql',
  'media-governance-mechanical-scrape-split.sql',
];
const VERIFICATION_FILES = [
  'media-governance-series-work-v1-verify.sql',
  'media-governance-rss-context-v2-verify.sql',
  'media-governance-series-delete-v1-verify.sql',
  'media-governance-mechanical-scrape-split-verify.sql',
];
const VERIFICATION_EXPECTATIONS = new Map<string, number>([
  ['work_table_count', 2],
  ['schema_contract_mismatch_count', 0],
  ['invalid_series_namespace_count', 0],
  ['series_without_primary_work_count', 0],
  ['season_work_mismatch_count', 0],
  ['duplicate_work_canonical_count', 0],
  ['non_tv_work_with_season_count', 0],
  ['task_work_series_mismatch_count', 0],
  ['legacy_series_reference_without_work_ref_count', 0],
  ['rss_context_column_count', 4],
  ['rss_context_missing_identity_count', 0],
  ['rss_context_work_ref_mismatch_count', 0],
  ['rss_context_index_count', 2],
  ['series_delete_permission_identity_count', 1],
  ['series_delete_permission_conflict_count', 0],
  ['series_delete_permission_duplicate_count', 0],
  ['series_delete_missing_super_binding_count', 0],
  ['series_delete_non_super_binding_count', 0],
  ['scrape_validation_table_count', 1],
  ['scrape_validation_required_column_count', 19],
  ['scrape_validation_task_unique_index_count', 1],
  ['legacy_media_agent_table_count', 0],
  ['legacy_media_task_column_count', 0],
  ['legacy_media_unit_column_count', 0],
  ['closed_task_without_scrape_validation_count', 0],
  ['orphan_scrape_validation_count', 0],
]);

export type MediaGovernanceSeriesWorkMigrationVerification = Record<
  string,
  number
>;

/**
 * 校验 Series-first 迁移后的表、所有权、引用和任务上下文计数，任何缺项或漂移都阻止 API 启动。
 *
 * @param actual - 由只读验证 SQL 返回的命名计数。
 * @returns 全部冻结期望均满足后的同一计数字典。
 * @throws 任一必需计数缺失、无效或不等于期望时抛出错误。
 */
export function assertMediaGovernanceSeriesWorkMigrationVerification(
  actual: MediaGovernanceSeriesWorkMigrationVerification,
): MediaGovernanceSeriesWorkMigrationVerification {
  for (const [name, expected] of VERIFICATION_EXPECTATIONS) {
    const value = actual[name];
    if (!Number.isInteger(value)) {
      throw new Error(`媒体 Series-first 迁移验证缺少整数计数：${name}`);
    }
    if (value !== expected) {
      throw new Error(
        `媒体 Series-first 迁移验证失败：${name}=${value}，期望 ${expected}`,
      );
    }
  }
  return actual;
}

/**
 * 读取非空数据库环境变量，避免 initContainer 隐式连接错误实例。
 *
 * @param name - 数据库环境变量名。
 * @returns 去除首尾空白后的变量值。
 * @throws 变量缺失或为空时抛出错误。
 */
function readRequiredEnvironment(name: string): string {
  const value = process.env[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`媒体 Series-first 迁移缺少 ${name}`);
  }
  return value.trim();
}

/**
 * 从镜像固定 SQL 根读取指定 Series-first 迁移制品。
 *
 * @param fileName - 固定版本化 SQL 文件名。
 * @returns UTF-8 SQL 文本。
 */
function readMigrationFile(fileName: string): string {
  let sqlRoot = process.env.MEDIA_GOVERNANCE_MIGRATION_SQL_ROOT;
  if (!sqlRoot) sqlRoot = join(process.cwd(), 'sql');
  return readFileSync(resolve(sqlRoot, fileName), 'utf8');
}

/**
 * 顺序执行解析后的幂等 SQL 语句，保留 DDL 与回填的既定依赖顺序。
 *
 * @param connection - 已绑定目标数据库的 mysql2 连接。
 * @param source - 完整版本化迁移 SQL。
 */
async function executeMysqlScript(
  connection: Connection,
  source: string,
): Promise<void> {
  for (const statement of parseMysqlScript(source)) {
    await connection.query(statement);
  }
}

/**
 * 把迁移后的结构与目录关系查询收敛为发布门禁字典，并忽略不含冻结字段的结果集。
 *
 * @param connection - 已绑定迁移目标的 mysql2 连接。
 * @param source - 仅含 SELECT 的验证 SQL。
 * @returns 以验证列名索引的实际计数。
 */
async function readVerificationResults(
  connection: Connection,
  source: string,
): Promise<MediaGovernanceSeriesWorkMigrationVerification> {
  const actual: MediaGovernanceSeriesWorkMigrationVerification = {};
  for (const statement of parseMysqlScript(source)) {
    const [rows] = await connection.query<RowDataPacket[]>(statement);
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const row = rows[0];
    for (const name of VERIFICATION_EXPECTATIONS.keys()) {
      if (!(name in row)) continue;
      actual[name] = Number(row[name]);
    }
  }
  return actual;
}

/**
 * 在数据库 advisory lock 内执行 Series-first 幂等迁移并在释放锁前强校验全部所有权边界。
 *
 * @returns 已执行迁移及验证计数摘要。
 * @throws 数据库身份、端口、锁、SQL 或任一验证计数无效时抛出错误。
 */
export async function runMediaGovernanceSeriesWorkMigration(): Promise<{
  migrated: boolean;
  verification: MediaGovernanceSeriesWorkMigrationVerification;
}> {
  const database = readRequiredEnvironment('DB_DATABASE');
  if (!/^[A-Za-z0-9_]+$/u.test(database)) {
    throw new Error('DB_DATABASE 不是安全数据库标识');
  }
  const port = Number(readRequiredEnvironment('DB_PORT'));
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('DB_PORT 不是有效 TCP 端口');
  }
  const connection = await createConnection({
    charset: 'utf8mb4',
    connectTimeout: 10_000,
    database,
    host: readRequiredEnvironment('DB_HOST'),
    password: readRequiredEnvironment('DB_PASSWORD'),
    port,
    supportBigNumbers: true,
    user: readRequiredEnvironment('DB_USERNAME'),
  });
  let lockAcquired = false;
  try {
    const [lockRows] = await connection.query<RowDataPacket[]>(
      'SELECT GET_LOCK(?, 60) AS acquired',
      [MIGRATION_LOCK],
    );
    lockAcquired = Number(lockRows[0]?.acquired) === 1;
    if (!lockAcquired) {
      throw new Error('无法取得媒体 Series-first 数据库迁移锁');
    }
    for (const migrationFile of MIGRATION_FILES) {
      await executeMysqlScript(connection, readMigrationFile(migrationFile));
    }
    const verificationResults: MediaGovernanceSeriesWorkMigrationVerification =
      {};
    for (const verificationFile of VERIFICATION_FILES) {
      Object.assign(
        verificationResults,
        await readVerificationResults(
          connection,
          readMigrationFile(verificationFile),
        ),
      );
    }
    const verification =
      assertMediaGovernanceSeriesWorkMigrationVerification(verificationResults);
    return { migrated: true, verification };
  } finally {
    if (lockAcquired) {
      await connection.query('SELECT RELEASE_LOCK(?)', [MIGRATION_LOCK]);
    }
    await connection.end();
  }
}

/**
 * 运行 K8s initContainer 迁移并只输出非敏感验证计数。
 */
async function main(): Promise<void> {
  const result = await runMediaGovernanceSeriesWorkMigration();
  process.stdout.write(
    `${JSON.stringify({
      migrated: result.migrated,
      status: 'ready',
      rssContextColumnCount: result.verification.rss_context_column_count,
      scrapeValidationTableCount:
        result.verification.scrape_validation_table_count,
      seriesDeletePermissionIdentityCount:
        result.verification.series_delete_permission_identity_count,
      workTableCount: result.verification.work_table_count,
    })}\n`,
  );
}

if (require.main === module) {
  void main().catch((error) => {
    let message = '媒体 Series-first 迁移失败';
    if (error instanceof Error) message = error.message;
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
