import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('profile-menu.sql', () => {
  const sql = readFileSync(join(process.cwd(), 'sql/profile-menu.sql'), 'utf8');
  const initSql = readFileSync(
    join(process.cwd(), 'sql/vben-admin-init.sql'),
    'utf8',
  );

  it('adds the hidden profile route menu to existing databases', () => {
    expect(sql).toContain("'Profile'");
    expect(sql).toContain("'/profile'");
    expect(sql).toContain("'_core/profile/index'");
    expect(sql).toContain('"hideInMenu":true');
    expect(sql).toContain('"title":"page.auth.profile"');
  });

  it('keeps the full admin init script aligned with the profile menu', () => {
    expect(initSql).toContain(
      "'Profile', '/profile', '_core/profile/index'",
    );
    expect(initSql).toContain(
      '(2041700000000010003, 2041700000000100011)',
    );
  });

  it('grants the profile menu to all active roles without deleting existing role menus', () => {
    expect(sql).toContain('INSERT IGNORE INTO `admin_role_menu`');
    expect(sql).toContain("menu.`name` = 'Profile'");
    expect(sql).not.toMatch(/DELETE\s+FROM\s+`admin_role_menu`/i);
  });
});
