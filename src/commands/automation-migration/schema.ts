import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { parseMysqlScript } from '../migrate-bot-adapter-protocol';

export const AUTOMATION_SQL_FILES = [
  'automation-definitions-v1.sql',
  'automation-execution-v1.sql',
  'automation-schedules-v1.sql',
  'bot-reminders-v2.sql',
] as const;
const DRAFT_TABLES = new Set([
  'automation_task',
  'automation_trigger',
  'automation_ruleset',
  'automation_form',
  'automation_workflow',
  'automation_schedule',
]);

/**
 * 读取指定表的实际字段元数据，迁移只据此决定增补，不依赖环境推测现有版本。
 * @param connection - 明确连接到目标库的迁移连接。
 * @param table - 当前需要检查的固定表名。
 * @returns 按字段名索引的类型、可空及排序规则信息。
 */
export async function readAutomationColumns(
  connection: Connection,
  table: string,
) {
  const [rows] = await connection.query<RowDataPacket[]>(
    'SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',
    [table],
  );
  return new Map(rows.map((row) => [String(row.COLUMN_NAME), row]));
}

/**
 * 分隔建表体的顶层定义，保留函数参数、复合索引以及引号中的逗号。
 * @param body - 建表语句外层括号中的字段及索引定义。
 * @returns 每个字段或索引的完整定义。
 * @throws 括号或引号不完整时拒绝解析。
 */
function splitDefinitions(body: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let index = 0; index < body.length; index++) {
    const char = body[index];
    if (quote) {
      if (char === '\\') index++;
      else if (char === quote) {
        if (body[index + 1] === quote) index++;
        else quote = '';
      }
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) {
      items.push(body.slice(start, index).trim());
      start = index + 1;
    }
    if (depth < 0) throw new Error('自动化建表括号不匹配');
  }
  if (quote || depth !== 0) throw new Error('自动化建表定义未结束');
  items.push(body.slice(start).trim());
  return items;
}

/**
 * 规范化 MySQL 整数字段的显示宽度，仍严格区分长度、精度和无符号属性。
 * @param type - SQL 或元数据中的字段类型。
 * @returns 用于结构比较的规范类型。
 */
function canonicalType(type: string): string {
  return type
    .toLowerCase()
    .replace(/\b(tinyint|smallint|int|bigint)\(\d+\)/g, '$1');
}

/**
 * 验证新建或已有表的字段、主键与唯一约束，避免 CREATE IF NOT EXISTS 掩盖结构漂移。
 * @param connection - 迁移连接。
 * @param table - 当前声明的表名。
 * @param body - 版本化 SQL 中的建表体。
 * @throws 字段类型、可空、排序规则或索引契约不符时阻止启动。
 */
async function verifyTable(
  connection: Connection,
  table: string,
  body: string,
): Promise<void> {
  const columns = await readAutomationColumns(connection, table);
  const [indexRows] = await connection.query<RowDataPacket[]>(
    'SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX',
    [table],
  );
  const indexes = new Map<string, { columns: string[]; unique: boolean }>();
  for (const row of indexRows) {
    const name = String(row.INDEX_NAME);
    const index = indexes.get(name) || {
      columns: [],
      unique: Number(row.NON_UNIQUE) === 0,
    };
    index.columns.push(String(row.COLUMN_NAME));
    indexes.set(name, index);
  }
  for (const definition of splitDefinitions(body)) {
    const key =
      /^(PRIMARY KEY|UNIQUE KEY|KEY)\s*(?:`?([A-Za-z0-9_]+)`?\s*)?\(([^)]+)\)$/i.exec(
        definition,
      );
    if (key) {
      let name = key[2];
      if (key[1].toUpperCase() === 'PRIMARY KEY') name = 'PRIMARY';
      const expected = key[3]
        .split(',')
        .map((value) => value.trim().replace(/`/g, ''));
      const actual = indexes.get(name);
      if (
        !actual ||
        actual.columns.join(',') !== expected.join(',') ||
        actual.unique !== (key[1].toUpperCase() !== 'KEY')
      )
        throw new Error(`自动化索引不一致：${table}.${name}`);
      continue;
    }
    const match =
      /^`?([A-Za-z0-9_]+)`?\s+([A-Za-z]+(?:\(\d+(?:,\d+)?\))?)/.exec(
        definition,
      );
    if (!match) throw new Error(`无法验证自动化字段定义：${table}`);
    const column = columns.get(match[1]);
    if (
      !column ||
      canonicalType(String(column.COLUMN_TYPE)) !== canonicalType(match[2])
    )
      throw new Error(`自动化字段类型不一致：${table}.${match[1]}`);
    if ((column.IS_NULLABLE === 'NO') !== /\bNOT NULL\b/i.test(definition))
      throw new Error(`自动化字段可空约束不一致：${table}.${match[1]}`);
    if (
      /COLLATE utf8mb4_bin/i.test(definition) &&
      column.COLLATION_NAME !== 'utf8mb4_bin'
    )
      throw new Error(`自动化身份排序规则不一致：${table}.${match[1]}`);
    if (
      /\bUNIQUE\b/i.test(definition) &&
      ![...indexes.values()].some(
        (index) =>
          index.unique &&
          index.columns.length === 1 &&
          index.columns[0] === match[1],
      )
    )
      throw new Error(`自动化身份缺少唯一索引：${table}.${match[1]}`);
  }
}

/**
 * 创建独立模块的二十三张表，并为已有预览草稿补来源身份；所有建表均核对实际结构。
 * @param connection - 已持迁移锁的明确目标连接。
 * @param sqlRoot - 当前发布包内版本化 SQL 目录。
 * @returns 本次验证通过的表名列表。
 * @throws 非预期语句、结构漂移或写入失败时阻止应用启动。
 */
export async function ensureAutomationSchema(
  connection: Connection,
  sqlRoot: string,
): Promise<string[]> {
  const tables: string[] = [];
  for (const file of AUTOMATION_SQL_FILES) {
    const source = readFileSync(join(sqlRoot, file), 'utf8');
    for (const statement of parseMysqlScript(source)) {
      const match =
        /^\s*(?:--[^\n]*\n\s*)*CREATE TABLE IF NOT EXISTS\s+`?([A-Za-z0-9_]+)`?\s*\(([\s\S]+)\)\s*ENGINE=/i.exec(
          statement,
        );
      if (!match) throw new Error(`自动化迁移只接受版本化建表语句：${file}`);
      const table = match[1];
      if (!table.startsWith('automation_') && table !== 'bot_reminder')
        throw new Error('自动化迁移表超出范围');
      await connection.query(statement);
      if (DRAFT_TABLES.has(table)) {
        const columns = await readAutomationColumns(connection, table);
        if (!columns.has('source_key'))
          await connection.query(
            `ALTER TABLE \`${table}\` ADD COLUMN source_key VARCHAR(191) COLLATE utf8mb4_bin NULL UNIQUE`,
          );
      }
      await verifyTable(connection, table, match[2]);
      tables.push(table);
    }
  }
  if (tables.length !== 24 || new Set(tables).size !== 24)
    throw new Error('自动化模块表数不符合发布契约');
  return tables;
}

/**
 * 在首次切换前封存旧表的全部原始字段，重入只允许逐字段一致的同库快照。
 * @param connection - 旧写入者已经停止的迁移连接。
 * @param table - 明确允许备份的旧任务或运行表。
 * @returns 同库备份表名，不删除或修改原表。
 * @throws 非白名单表或快照数据漂移时停止迁移。
 */
export async function preserveLegacyTaskTable(
  connection: Connection,
  table: string,
): Promise<string> {
  if (!['plugin_task', 'plugin_task_run'].includes(table))
    throw new Error('备份表超出旧任务范围');
  const backup = '_kt_automation_v2_backup_' + table;
  await connection.query(
    `CREATE TABLE IF NOT EXISTS \`${backup}\` LIKE \`${table}\``,
  );
  const columns = [...(await readAutomationColumns(connection, backup)).keys()];
  const names = columns.map((name) => '`' + name + '`').join(',');
  await connection.query(
    `INSERT IGNORE INTO \`${backup}\` (${names}) SELECT ${names} FROM \`${table}\``,
  );
  const different = columns
    .map((name) => `NOT (a.\`${name}\` <=> b.\`${name}\`)`)
    .join(' OR ');
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT COUNT(*) mismatches FROM \`${table}\` a LEFT JOIN \`${backup}\` b ON b.id=a.id WHERE b.id IS NULL OR ${different}`,
  );
  if (Number(rows[0]?.mismatches) !== 0)
    throw new Error(`旧任务快照数据不一致：${table}`);
  return backup;
}
