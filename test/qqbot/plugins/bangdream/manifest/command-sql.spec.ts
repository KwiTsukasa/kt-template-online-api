import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseQqbotPluginManifest } from '@/modules/qqbot/plugin-platform/domain/manifest';

type BangDreamSqlCommandRow = {
  aliases: string[];
  cooldownMs: number;
  operationKey: string;
  remark?: string;
};

const BANGDREAM_FULL_SQL_ROW_PATTERN =
  /\(\d+, '[^']+', '[^']+', '(\[[^']*\])', '\[[^']*\]', 'bangdream', '([^']+)', 'plain', 'all', '\{\}', '', '[^']*', 1, 0, (\d+), '([^']*)'\)/g;

const BANGDREAM_REFACTOR_V3_SQL_ROW_PATTERN =
  /\(\s*\d+,\s*'([^']+)',\s*'[^']+',\s*'[^']+',\s*'[^']+',\s*'(\[[^']*\])',\s*'bangdream',\s*1,\s*(\d+)\s*\)/g;

const pluginRoot = join(
  process.cwd(),
  'src/modules/qqbot/plugins/bangdream',
);

const manifest = parseQqbotPluginManifest(
  JSON.parse(readFileSync(join(pluginRoot, 'plugin.json'), 'utf8')) as Record<
    string,
    unknown
  >,
  { pluginRoot },
);

/**
 * 从完整初始化 SQL 中提取 BangDream 在线命令行。
 *
 * @param sql - qqbot 初始化 SQL。
 */
function getBangDreamFullSqlCommandRows(sql: string) {
  return Array.from(sql.matchAll(BANGDREAM_FULL_SQL_ROW_PATTERN)).map(
    (match): BangDreamSqlCommandRow => ({
      aliases: JSON.parse(match[1]) as string[],
      cooldownMs: Number(match[3]),
      operationKey: match[2],
      remark: match[4],
    }),
  );
}

function getBangDreamRefactorV3SqlCommandRows(sql: string) {
  return Array.from(sql.matchAll(BANGDREAM_REFACTOR_V3_SQL_ROW_PATTERN)).map(
    (match): BangDreamSqlCommandRow => ({
      aliases: JSON.parse(match[2]) as string[],
      cooldownMs: Number(match[3]) * 1000,
      operationKey: match[1],
    }),
  );
}

function expectSqlRowsMatchManifest(
  sqlRows: BangDreamSqlCommandRow[],
  options: {
    requireRemark?: boolean;
  } = {},
) {
    const sqlOperationKeys = sqlRows.map((row) => row.operationKey);
    const definedOperationKeys = manifest.operations.map(
      (operation) => operation.key,
    );

    expect([...sqlOperationKeys].sort()).toEqual(
      [...definedOperationKeys].sort(),
    );
    expect(sqlOperationKeys).toHaveLength(15);

    const rowsByKey = new Map(
      sqlRows.map((row) => [row.operationKey, row] as const),
    );

    for (const operation of manifest.operations) {
      const row = rowsByKey.get(operation.key);

      expect(row).toEqual(
        expect.objectContaining({
          aliases: [...operation.aliases],
        }),
      );
      expect(row?.cooldownMs).toBeGreaterThan(0);
      if (options.requireRemark) {
        expect(row?.remark).not.toHaveLength(0);
      }
    }
}

describe('qqbot BangDream command init SQL', () => {
  const sql = readFileSync(join(process.cwd(), 'sql/qqbot-init.sql'), 'utf8');
  const sqlRows = getBangDreamFullSqlCommandRows(sql);

  it('keeps every BangDream manifest operation available as an online command', () => {
    expectSqlRowsMatchManifest(sqlRows, { requireRemark: true });
  });

  it('overwrites dirty online command metadata on duplicate ids', () => {
    expect(sql).toContain('`code` = VALUES(`code`)');
    expect(sql).toContain('`is_deleted` = 0');
  });
});

describe('refactor v3 BangDream command seed SQL', () => {
  const sql = readFileSync(
    join(process.cwd(), 'sql/refactor-v3/01-seed-core.sql'),
    'utf8',
  );
  const sqlRows = getBangDreamRefactorV3SqlCommandRows(sql);

  it('keeps fresh-schema BangDream seed aligned with the manifest', () => {
    expectSqlRowsMatchManifest(sqlRows);
  });

  it('reactivates dirty command rows on duplicate keys', () => {
    expect(sql).toContain('is_deleted = 0');
  });
});
