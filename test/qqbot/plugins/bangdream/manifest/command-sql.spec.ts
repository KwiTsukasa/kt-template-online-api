import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseQqbotPluginManifest } from '@/modules/qqbot/plugin-platform/domain/manifest';

type BangDreamSqlCommandRow = {
  aliases: string[];
  cooldownMs: number;
  name?: string;
  operationKey: string;
  remark?: string;
};

const BANGDREAM_FULL_SQL_ROW_PATTERN =
  /\(\d+, '[^']+', '[^']+', '(\[[^']*\])', '\[[^']*\]', 'bangdream', '([^']+)', 'plain', 'all', '\{\}', '', '[^']*', 1, 0, (\d+), '([^']*)'\)/g;

const BANGDREAM_REFACTOR_V3_SQL_ROW_PATTERN =
  /\(\s*\d+,\s*'([^']+)',\s*'[^']+',\s*'[^']+',\s*'([^']*)',\s*'(\[[^']*\])',\s*'bangdream',\s*1,\s*(\d+)\s*\)/g;

const pluginRoot = join(process.cwd(), 'src/modules/qqbot/plugins/bangdream');

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
 * @param sql - SQL 文本；提取正则匹配结果。
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

/**
 * 查询 BangDream 插件数据。
 * @param sql - SQL 文本；提取正则匹配结果。
 */
function getBangDreamRefactorV3SqlCommandRows(sql: string) {
  return Array.from(sql.matchAll(BANGDREAM_REFACTOR_V3_SQL_ROW_PATTERN)).map(
    (match): BangDreamSqlCommandRow => ({
      aliases: JSON.parse(match[3]) as string[],
      cooldownMs: Number(match[4]) * 1000,
      name: match[2],
      operationKey: match[1],
    }),
  );
}

/**
 * 执行 BangDream 插件流程。
 * @param sqlRows - BangDream列表；转换 BangDream列表项。
 * @param options - BangDream列表；使用 `aliasSource`、`requireRemark` 字段生成结果。
 */
function expectSqlRowsMatchManifest(
  sqlRows: BangDreamSqlCommandRow[],
  options: {
    aliasSource?: 'manifest' | 'plugin-manifest-only';
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

    if (options.aliasSource === 'plugin-manifest-only') {
      expect(row?.aliases).toEqual([]);
      expect(row?.name).toBe('');
    } else {
      expect(row).toEqual(
        expect.objectContaining({
          aliases: [...operation.aliases],
        }),
      );
    }
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
    expectSqlRowsMatchManifest(sqlRows, {
      aliasSource: 'plugin-manifest-only',
    });
    for (const operation of manifest.operations) {
      expect(sql).not.toContain(JSON.stringify(operation.aliases));
    }
  });

  it('reactivates dirty command rows on duplicate keys', () => {
    expect(sql).toContain('is_deleted = 0');
  });
});
