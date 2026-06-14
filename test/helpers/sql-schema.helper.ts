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
  expectTableColumns(tableName: string, columns: readonly string[]): void;
};

const parseColumnNames = (tableBlock: string) => {
  return tableBlock
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/,$/, ''))
    .flatMap((line) => {
      const match = line.match(/^`?([A-Za-z_][A-Za-z0-9_]*)`?\s+/);

      if (!match || nonColumnTokens.has(match[1].toUpperCase())) {
        return [];
      }

      return [match[1]];
    });
};

const parseSchema = (sql: string) => {
  const tables = new Map<string, Set<string>>();

  for (const match of sql.matchAll(createTableRegex)) {
    const [, tableName, tableBlock] = match;
    tables.set(tableName, new Set(parseColumnNames(tableBlock)));
  }

  return tables;
};

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
    hasTable: (tableName) => tables.has(tableName),
    expectTableColumns: (tableName, columns) => {
      const tableColumns = tables.get(tableName);

      expect(tableColumns).toBeDefined();
      expect(Array.from(tableColumns || [])).toEqual(
        expect.arrayContaining([...columns]),
      );
    },
  };
};
