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

const parseSchema = (sql: string) => {
  const tables = new Map<string, SqlSchemaColumn[]>();

  for (const match of sql.matchAll(createTableRegex)) {
    const [, tableName, tableBlock] = match;
    tables.set(tableName, parseColumns(tableBlock));
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
    getTableColumns: (tableName) => tables.get(tableName) || [],
    hasTable: (tableName) => tables.has(tableName),
    expectTableColumns: (tableName, columns) => {
      const tableColumns = tables.get(tableName);

      expect(tableColumns).toBeDefined();
      expect((tableColumns || []).map((column) => column.name)).toEqual(
        expect.arrayContaining([...columns]),
      );
    },
  };
};
