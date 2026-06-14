import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BANGDREAM_OPERATION_REGISTRY } from '@/modules/qqbot/plugins/bangDream/registry/operation-registry';

type BangDreamSqlCommandRow = {
  aliases: string[];
  cooldownMs: number;
  operationKey: string;
  remark: string;
};

const BANGDREAM_SQL_ROW_PATTERN =
  /\(\d+, '[^']+', '[^']+', '(\[[^']*\])', '\[[^']*\]', 'bangDream', '([^']+)', 'plain', 'all', '\{\}', '', '[^']*', 1, 0, (\d+), '([^']*)'\)/g;

/**
 * 从初始化 SQL 中提取 BangDream 在线命令行。
 *
 * @param sql - qqbot 初始化 SQL。
 */
function getBangDreamSqlCommandRows(sql: string) {
  return Array.from(sql.matchAll(BANGDREAM_SQL_ROW_PATTERN)).map(
    (match): BangDreamSqlCommandRow => ({
      aliases: JSON.parse(match[1]) as string[],
      cooldownMs: Number(match[3]),
      operationKey: match[2],
      remark: match[4],
    }),
  );
}

describe('qqbot BangDream command init SQL', () => {
  const sql = readFileSync(join(process.cwd(), 'sql/qqbot-init.sql'), 'utf8');
  const sqlRows = getBangDreamSqlCommandRows(sql);

  it('keeps every BangDream plugin operation available as an online command', () => {
    const sqlOperationKeys = sqlRows.map((row) => row.operationKey);
    const definedOperationKeys = BANGDREAM_OPERATION_REGISTRY.map(
      (operation) => operation.key,
    );

    expect([...sqlOperationKeys].sort()).toEqual(
      [...definedOperationKeys].sort(),
    );
    expect(sqlOperationKeys).toHaveLength(15);
  });

  it('keeps online command aliases, cooldown, and remarks aligned with registry', () => {
    const rowsByKey = new Map(
      sqlRows.map((row) => [row.operationKey, row] as const),
    );

    for (const operation of BANGDREAM_OPERATION_REGISTRY) {
      const row = rowsByKey.get(operation.key);

      expect(row).toEqual(
        expect.objectContaining({
          aliases: [...operation.onlineCommand.aliases],
          cooldownMs: operation.onlineCommand.cooldownMs,
          remark: operation.onlineCommand.remark,
        }),
      );
    }
  });

  it('overwrites dirty online command metadata on duplicate ids', () => {
    expect(sql).toContain('`code` = VALUES(`code`)');
    expect(sql).toContain('`is_deleted` = 0');
  });
});
