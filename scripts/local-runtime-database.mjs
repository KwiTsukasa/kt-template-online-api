import { readFile } from 'node:fs/promises';
import { pbkdf2, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import mysql from 'mysql2/promise';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const LOCAL_DATABASE_PATTERN = /^kt_template_local(?:_[a-z0-9_]+)?$/u;
const derivePassword = promisify(pbkdf2);

/**
 * 读取本地数据库准备阶段必需的环境变量，并在缺失时阻止使用不完整连接参数。
 * @param {string} name - 需要读取的环境变量名。
 * @returns {string} 未裁剪原始内容的环境变量值。
 * @throws 当环境变量缺失或为空时抛出配置错误。
 */
function readRequiredEnvironment(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`本地数据库准备缺少 ${name}`);
  }
  return value;
}

/**
 * 校验数据库名只落在明确的可丢弃本地命名空间，防止重建脚本触达开发或生产业务库。
 * @param {string} database - 待重建的数据库名。
 * @returns {string} 已通过本地隔离命名约束的数据库名。
 * @throws 当数据库名不属于 `kt_template_local*` 隔离命名空间时抛出安全错误。
 */
function assertLocalDatabaseName(database) {
  if (!LOCAL_DATABASE_PATTERN.test(database)) {
    throw new Error(
      'KT_LOCAL_DB_DATABASE 必须匹配 kt_template_local 或 kt_template_local_*',
    );
  }
  return database;
}

/**
 * 根据当前环境构造 MySQL 连接参数，并只在调用方明确传入时选择数据库。
 * @param {string | undefined} database - 可选的目标数据库名。
 * @returns {import('mysql2/promise').ConnectionOptions} 不包含日志输出的 MySQL 连接参数。
 * @throws 当端口不是有效 TCP 端口时抛出配置错误。
 */
function createConnectionOptions(database) {
  const port = Number(readRequiredEnvironment('DB_PORT'));
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('DB_PORT 必须是 1 到 65535 之间的整数');
  }

  const options = {
    connectTimeout: 5_000,
    host: readRequiredEnvironment('DB_HOST'),
    multipleStatements: true,
    password: readRequiredEnvironment('DB_PASSWORD'),
    port,
    supportBigNumbers: true,
    bigNumberStrings: true,
    user: readRequiredEnvironment('DB_USERNAME'),
  };
  if (database) {
    options.database = database;
  }
  return options;
}

/**
 * 为隔离本地库生成与正式认证实现一致的 PBKDF2 密码摘要，使种子账号可通过真实登录接口验证。
 * @param {string} password - 仅用于本地种子账号的明文密码。
 * @returns {Promise<string>} 包含版本、迭代次数、盐和摘要的认证字符串。
 */
async function createLocalAdminPasswordHash(password) {
  const salt = randomBytes(32);
  const digest = await derivePassword(password, salt, 600_000, 32, 'sha256');
  return [
    '',
    'pbkdf2-sha256',
    'v=1',
    'i=600000',
    salt.toString('base64url'),
    digest.toString('base64url'),
  ].join('$');
}

/**
 * 重建专用本地数据库并加载当前完整 schema 与种子，使每次验证都从同一数据库基线开始。
 * @returns {Promise<void>} 完成数据库重建、种子加载和核心表校验后结束。
 * @throws 当连接、SQL 执行或核心表集合校验失败时抛出对应错误。
 */
async function prepareLocalDatabase() {
  const database = assertLocalDatabaseName(
    readRequiredEnvironment('DB_DATABASE'),
  );
  const schemaPath = path.join(
    projectRoot,
    'sql',
    'refactor-v3',
    '00-full-schema.sql',
  );
  const seedPath = path.join(
    projectRoot,
    'sql',
    'refactor-v3',
    '01-seed-core.sql',
  );
  const mediaGovernanceSchemaPath = path.join(
    projectRoot,
    'sql',
    'media-governance-init.sql',
  );
  const systemNoticeSchemaPath = path.join(
    projectRoot,
    'sql',
    'system-notice-menu.sql',
  );
  const [schemaSql, seedSql, mediaGovernanceSchemaSql, systemNoticeSchemaSql] =
    await Promise.all([
      readFile(schemaPath, 'utf8'),
      readFile(seedPath, 'utf8'),
      readFile(mediaGovernanceSchemaPath, 'utf8'),
      readFile(systemNoticeSchemaPath, 'utf8'),
    ]);

  const serverConnection = await mysql.createConnection(
    createConnectionOptions(undefined),
  );
  try {
    await serverConnection.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await serverConnection.query(
      `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await serverConnection.end();
  }

  const databaseConnection = await mysql.createConnection(
    createConnectionOptions(database),
  );
  try {
    await databaseConnection.query(schemaSql);
    await databaseConnection.query(mediaGovernanceSchemaSql);
    await databaseConnection.query(seedSql);
    await databaseConnection.query(systemNoticeSchemaSql);
    const localAdminPasswordHash = await createLocalAdminPasswordHash(
      readRequiredEnvironment('KT_LOCAL_ADMIN_PASSWORD'),
    );
    await databaseConnection.execute(
      'UPDATE admin_user SET password = ? WHERE username = ?',
      [localAdminPasswordHash, 'kwitsukasa'],
    );
    const requiredTables = [
      'admin_notice',
      'admin_llm_config',
      'admin_llm_conversation',
      'admin_llm_message',
      'admin_user',
      'admin_user_role',
      'message_event',
      'message_subscription',
      'message_subscription_template',
      'message_template',
      'media_governance_task',
      'station_notice_message_binding',
    ];
    const [rows] = await databaseConnection.query(
      `SELECT COUNT(*) AS table_count
       FROM information_schema.tables
       WHERE table_schema = ? AND table_name IN (?)`,
      [database, requiredTables],
    );
    const tableCount = Number(rows[0]?.table_count);
    if (tableCount !== requiredTables.length) {
      throw new Error(
        `本地数据库核心表不完整：${tableCount}/${requiredTables.length}`,
      );
    }
    const [permissionRows] = await databaseConnection.query(
      `SELECT COUNT(DISTINCT menu.auth_code) AS permission_count
       FROM admin_menu menu
       JOIN admin_role_menu role_menu ON role_menu.menu_id = menu.id
       JOIN admin_role role ON role.id = role_menu.role_id
       WHERE role.role_code = 'super'
         AND role.is_deleted = 0
         AND menu.is_deleted = 0
         AND menu.name IN ('SystemNotice', 'SystemNoticeEdit', 'SystemNoticeDelete')
         AND menu.auth_code IN ('System:Notice:List', 'System:Notice:Edit', 'System:Notice:Delete')`,
    );
    const messageCenterPermissionCount = Number(
      permissionRows[0]?.permission_count,
    );
    if (messageCenterPermissionCount !== 3) {
      throw new Error(
        `本地消息中心权限不完整：${messageCenterPermissionCount}/3`,
      );
    }
    const [llmPermissionRows] = await databaseConnection.query(
      `SELECT COUNT(*) AS permission_count
       FROM admin_menu menu
       JOIN admin_role_menu role_menu ON role_menu.menu_id = menu.id
       JOIN admin_role role ON role.id = role_menu.role_id
       WHERE role.role_code = 'super'
         AND role.is_deleted = 0
         AND menu.is_deleted = 0
         AND menu.name IN (
           'Llm', 'LlmConfig', 'LlmChat', 'LlmConfigCreate', 'LlmConfigUpdate',
           'LlmConfigDelete', 'LlmConfigTest', 'LlmConfigDefault',
           'LlmConfigToggle', 'LlmChatUse'
         )`,
    );
    const llmPermissionCount = Number(llmPermissionRows[0]?.permission_count);
    if (llmPermissionCount !== 10) {
      throw new Error(`本地大模型权限不完整：${llmPermissionCount}/10`);
    }
    process.stdout.write(
      `${JSON.stringify({
        database,
        llmPermissionCount,
        messageCenterPermissionCount,
        reset: true,
        tableCount,
      })}\n`,
    );
  } finally {
    await databaseConnection.end();
  }
}

await prepareLocalDatabase().catch((error) => {
  let message = String(error);
  if (error instanceof Error) {
    message = error.message;
  }
  process.stderr.write(`本地数据库准备失败：${message}\n`);
  process.exitCode = 1;
});
