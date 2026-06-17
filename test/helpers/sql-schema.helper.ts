import * as fs from 'fs';
import * as path from 'path';

const createTableRegex =
  /CREATE TABLE IF NOT EXISTS\s+([A-Za-z0-9_]+)\s*\(([\s\S]*?)\)\s*ENGINE=/gi;

const nonColumnTokens = new Set([
  'CONSTRAINT',
  'FOREIGN',
  'KEY',
  'PRIMARY',
  'UNIQUE',
]);

export type SqlSchemaContract = {
  hasTable(tableName: string): boolean;
  getTableColumns(tableName: string): SqlSchemaColumn[];
  expectTableColumns(tableName: string, columns: readonly string[]): void;
};

export type SqlSchemaColumn = {
  definition: string;
  name: string;
};

/**
 * 解析Columns。
 * @param tableBlock - CREATE TABLE 语句片段；影响 parseColumns 的返回值。
 * @returns 测试断言转换后的值。
 */
const parseColumns = (tableBlock: string): SqlSchemaColumn[] => {
  return tableBlock
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/,$/, ''))
    .flatMap((line) => {
      const match = line.match(/^`?([A-Za-z_][A-Za-z0-9_]*)`?\s+/);

      if (!match || nonColumnTokens.has(match[1].toUpperCase())) {
        return [];
      }

      return [
        {
          definition: line,
          name: match[1],
        },
      ];
    });
};

/**
 * 解析Schema。
 * @param sql - SQL 文本；提取正则匹配结果。
 */
const parseSchema = (sql: string) => {
  const tables = new Map<string, SqlSchemaColumn[]>();

  for (const match of sql.matchAll(createTableRegex)) {
    const [, tableName, tableBlock] = match;
    tables.set(tableName, parseColumns(tableBlock));
  }

  return tables;
};

/**
 * 读取 测试断言资源。
 * @returns 测试断言产出的 SqlSchemaContract。
 */
export const readRefactorV3SqlSchema = (): SqlSchemaContract => {
  const schemaPath = path.resolve(
    __dirname,
    '..',
    '..',
    'sql',
    'refactor-v3',
    '00-full-schema.sql',
  );
  const tables = parseSchema(fs.readFileSync(schemaPath, 'utf8'));

  return {
    /**
     * 读取 测试回调数据。
     * @param tableName - tableName 输入；驱动 `tables.get()` 的 测试步骤。
     */
    getTableColumns: (tableName) => tables.get(tableName) || [],
    /**
     * 执行 测试回调。
     * @param tableName - tableName 输入；驱动 `tables.has()` 的 测试步骤。
     */
    hasTable: (tableName) => tables.has(tableName),
    /**
     * 执行 测试回调。
     * @param tableName - tableName 输入；驱动 `tables.get()` 的 测试步骤。
     * @param columns - 测试列表；构造测试断言。
     */
    expectTableColumns: (tableName, columns) => {
      const tableColumns = tables.get(tableName);

      expect(tableColumns).toBeDefined();
      expect((tableColumns || []).map((column) => column.name)).toEqual(
        expect.arrayContaining([...columns]),
      );
    },
  };
};
