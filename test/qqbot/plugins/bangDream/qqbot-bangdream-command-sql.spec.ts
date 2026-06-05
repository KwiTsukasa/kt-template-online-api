import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BANGDREAM_OPERATION_DEFS } from '@/qqbot/plugins/bangDream/commands/qqbot-bangdream-command.definitions';

describe('qqbot BangDream command init SQL', () => {
  const sql = readFileSync(join(process.cwd(), 'sql/qqbot-init.sql'), 'utf8');

  it('keeps every BangDream plugin operation available as an online command', () => {
    const sqlOperationKeys = Array.from(
      sql.matchAll(/'bangDream', '([^']+)'/g),
    ).map((match) => match[1]);
    const definedOperationKeys = BANGDREAM_OPERATION_DEFS.map(
      (operation) => operation.key,
    );

    expect([...sqlOperationKeys].sort()).toEqual(
      [...definedOperationKeys].sort(),
    );
    expect(sqlOperationKeys).toHaveLength(15);
  });

  it('overwrites dirty online command metadata on duplicate ids', () => {
    expect(sql).toContain('`code` = VALUES(`code`)');
    expect(sql).toContain('`is_deleted` = 0');
  });
});
