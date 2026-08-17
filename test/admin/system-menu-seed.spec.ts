import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Admin 系统菜单种子', () => {
  it('不再写入已退役的模板和 KtTable 演示菜单', () => {
    const sql = readFileSync(
      join(process.cwd(), 'sql/vben-admin-init.sql'),
      'utf8',
    );

    expect(sql).not.toMatch(
      /SystemKtTableDemo|system\/ktTableDemo|system\.ktTableDemo|VbenDocument|VbenGithub|\/vben-admin|_core\/about|demos\.vben/iu,
    );
    expect(sql).toMatch(/DELETE FROM `admin_menu`[\s\S]*2041700000000100009/iu);
  });
});
