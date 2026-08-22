import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  createConnection,
  type Connection,
  type RowDataPacket,
} from 'mysql2/promise';

const MIGRATION_LOCK = 'kt:bot-adapter-protocol-v1';
const PROTOCOL_MIGRATION_FILE = 'bot-adapter-protocol-v1.sql';
const MENU_MIGRATION_FILE = 'bot-adapter-menu-v1.sql';
const VERIFICATION_FILE = 'bot-adapter-protocol-v1-verify.sql';
const VERIFICATION_EXPECTATIONS = new Map<string, number>([
  ['tencent_binding_missing_account_count', 0],
  ['tencent_binding_missing_plugin_count', 0],
  ['legacy_table_count', 0],
  ['canonical_table_count', 33],
  ['legacy_index_name_count', 0],
  ['canonical_menu_mismatch', 0],
  ['canonical_menu_role_mismatch', 0],
  ['legacy_menu_contract_count', 0],
  ['plugin_trigger_mode_mismatch', 0],
  ['plugin_trigger_mode_missing_count', 0],
  ['legacy_plugin_trigger_mode_count', 0],
  ['legacy_bot_subscription_key_count', 0],
  ['legacy_napcat_reverse_ws_path_count', 0],
  ['bot_message_id_width_mismatch_count', 0],
]);

export type BotAdapterMigrationVerification = Record<string, number>;

/**
 * 解析 MySQL CLI 脚本中的动态 DELIMITER，并输出可由 mysql2 逐条执行的语句。
 * @param source - 包含普通 SQL 与存储过程的完整脚本文本。
 * @returns 已移除 DELIMITER 指令和语句终止符的 SQL 语句序列。
 * @throws 脚本切换分隔符时仍有未结束语句，或结尾残留未结束语句时抛出错误。
 */
export function parseMysqlScript(source: string): string[] {
  const statements: string[] = [];
  let delimiter = ';';
  let buffer = '';
  for (const line of source.split(/\r?\n/u)) {
    const trimmed = line.trim();
    const delimiterMatch = trimmed.match(/^DELIMITER\s+(\S+)$/iu);
    if (delimiterMatch) {
      if (buffer.trim()) {
        throw new Error('MySQL 脚本在未结束语句中切换 DELIMITER');
      }
      delimiter = delimiterMatch[1];
      continue;
    }
    buffer += `${line}\n`;
    if (!trimmed.endsWith(delimiter)) continue;
    const delimiterIndex = buffer.lastIndexOf(delimiter);
    const statement = buffer.slice(0, delimiterIndex).trim();
    if (statement) statements.push(statement);
    buffer = '';
  }
  if (buffer.trim()) {
    throw new Error('MySQL 脚本包含未结束语句');
  }
  return statements;
}

/**
 * 校验只读验证脚本返回的每个命名计数，拒绝缺项、非整数或非预期值。
 * @param actual - 以验证列名索引的实际计数。
 * @returns 全部迁移门禁通过后的同一计数字典。
 * @throws 任一必需计数缺失、无效或不等于冻结期望时抛出错误。
 */
export function assertBotAdapterMigrationVerification(
  actual: BotAdapterMigrationVerification,
): BotAdapterMigrationVerification {
  for (const [name, expected] of VERIFICATION_EXPECTATIONS) {
    const value = actual[name];
    if (!Number.isInteger(value)) {
      throw new Error(`Bot Adapter 迁移验证缺少整数计数：${name}`);
    }
    if (value !== expected) {
      throw new Error(
        `Bot Adapter 迁移验证失败：${name}=${value}，期望 ${expected}`,
      );
    }
  }
  return actual;
}

/**
 * 读取必需数据库环境变量并拒绝空值，防止 initContainer 隐式连接错误实例。
 * @param name - 数据库环境变量名称。
 * @returns 去除首尾空白后的环境变量值。
 * @throws 变量缺失或为空时抛出错误。
 */
function readRequiredEnvironment(name: string): string {
  const value = process.env[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Bot Adapter 迁移缺少 ${name}`);
  }
  return value.trim();
}

/**
 * 从镜像内固定 SQL 根读取版本化迁移文件，禁止使用调用参数选择任意脚本。
 * @param fileName - 固定迁移文件名。
 * @returns UTF-8 SQL 文本。
 */
function readMigrationFile(fileName: string): string {
  let sqlRoot = process.env.BOT_ADAPTER_MIGRATION_SQL_ROOT;
  if (!sqlRoot) sqlRoot = join(process.cwd(), 'sql');
  return readFileSync(resolve(sqlRoot, fileName), 'utf8');
}

/**
 * 按解析后的顺序逐条执行 SQL，保证存储过程体不会被普通分号错误拆分。
 * @param connection - 已绑定目标数据库的 mysql2 连接。
 * @param source - 版本化 SQL 脚本文本。
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
 * 通过汇总旧表、菜单、字典和订阅键的残留数量，决定是否进入迁移写阶段。
 * @param connection - 已绑定目标数据库的 mysql2 连接。
 * @returns 任一旧契约仍存在时大于零的计数。
 */
async function readLegacyContractCount(
  connection: Connection,
): Promise<number> {
  const [rows] = await connection.query<RowDataPacket[]>(`
    SELECT
      (SELECT COUNT(*) FROM information_schema.tables
       WHERE table_schema = DATABASE()
         AND table_type = 'BASE TABLE'
         AND table_name LIKE 'qqbot\\_%')
      + (SELECT COUNT(*) FROM admin_menu
         WHERE name LIKE 'QqBot%'
            OR path = '/qqbot'
            OR path LIKE '/qqbot/%'
            OR component LIKE '/qqbot/%'
            OR auth_code LIKE 'QqBot:%'
            OR auth_code LIKE 'Bot:PluginTask:%'
            OR path IN ('/bot/plugin', '/bot/plugin-task')
            OR path LIKE '/bot/plugin-platform/%')
      + (SELECT COUNT(*) FROM admin_dict
         WHERE dict_code IN ('QQBOT_PLUGIN_TRIGGER_MODE', 'BOT_PLUGIN_TRIGGER_MODE'))
      + (SELECT COUNT(*) FROM message_subscription
         WHERE subscriber_key = 'qqbot' OR active_key LIKE 'qqbot:%')
      + (SELECT COUNT(*) FROM napcat_container
         WHERE reverse_ws_url LIKE '%/qqbot/onebot/reverse%')
      + (SELECT COUNT(*) FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND character_maximum_length < 255
           AND (
             (table_name = 'bot_conversation' AND column_name = 'last_message_id')
             OR (table_name = 'bot_message' AND column_name = 'message_id')
             OR (table_name = 'bot_send_log' AND column_name = 'message_id')
           ))
      AS legacy_count
  `);
  return Number(rows[0]?.legacy_count || 0);
}

/**
 * 从只读验证脚本的各结果集中收集冻结命名计数，供发布门禁逐项核对。
 * @param connection - 已绑定目标数据库的 mysql2 连接。
 * @param source - 版本化只读验证 SQL。
 * @returns 通过列名索引的验证计数。
 */
async function readVerificationResults(
  connection: Connection,
  source: string,
): Promise<BotAdapterMigrationVerification> {
  const actual: BotAdapterMigrationVerification = {};
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
 * 在数据库 advisory lock 内幂等执行 Bot Adapter 表与菜单迁移，并在释放锁前完成只读强校验。
 * @returns 是否执行了迁移写入及验证计数摘要。
 * @throws 连接身份、迁移 SQL、锁或任一验证计数不满足时抛出错误。
 */
export async function runBotAdapterProtocolMigration(): Promise<{
  migrated: boolean;
  verification: BotAdapterMigrationVerification;
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
    if (!lockAcquired) throw new Error('无法取得 Bot Adapter 数据库迁移锁');

    const legacyCount = await readLegacyContractCount(connection);
    let migrated = false;
    if (legacyCount > 0) {
      await executeMysqlScript(
        connection,
        readMigrationFile(PROTOCOL_MIGRATION_FILE),
      );
      await executeMysqlScript(
        connection,
        readMigrationFile(MENU_MIGRATION_FILE),
      );
      migrated = true;
    }
    const verification = assertBotAdapterMigrationVerification(
      await readVerificationResults(
        connection,
        readMigrationFile(VERIFICATION_FILE),
      ),
    );
    return { migrated, verification };
  } finally {
    if (lockAcquired) {
      await connection.query('SELECT RELEASE_LOCK(?)', [MIGRATION_LOCK]);
    }
    await connection.end();
  }
}

/**
 * 运行 K8s initContainer 迁移并只输出非敏感计数摘要。
 */
async function main(): Promise<void> {
  const result = await runBotAdapterProtocolMigration();
  process.stdout.write(
    `${JSON.stringify({
      canonicalTableCount: result.verification.canonical_table_count,
      legacyTableCount: result.verification.legacy_table_count,
      migrated: result.migrated,
      status: 'ready',
    })}\n`,
  );
}

if (require.main === module) {
  void main().catch((error) => {
    let message = 'Bot Adapter protocol migration failed';
    if (error instanceof Error) message = error.message;
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
