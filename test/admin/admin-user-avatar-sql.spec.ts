import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('admin user avatar sql', () => {
  const avatarSql = readFileSync(
    join(process.cwd(), 'sql/admin-user-avatar.sql'),
    'utf8',
  );
  const initSql = readFileSync(
    join(process.cwd(), 'sql/vben-admin-init.sql'),
    'utf8',
  );

  it('adds avatar column for existing databases', () => {
    expect(avatarSql).toContain("COLUMN_NAME = 'avatar'");
    expect(avatarSql).toContain('ALTER TABLE `admin_user` ADD COLUMN `avatar`');
    expect(avatarSql).toContain('varchar(1024)');
  });

  it('keeps init sql aligned without resetting existing avatars', () => {
    expect(initSql).toContain('`avatar` varchar(1024) NOT NULL DEFAULT');
    expect(initSql).toContain("COLUMN_NAME = 'avatar'");
    expect(initSql).toContain(
      "INSERT INTO `admin_user` (`id`, `username`, `password`, `real_name`, `avatar`, `dept_id`, `home_path`, `timezone`, `status`)",
    );
    expect(initSql).not.toContain('`avatar` = VALUES(`avatar`)');
  });
});
