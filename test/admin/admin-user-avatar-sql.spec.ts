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
  const refactorSeedSql = readFileSync(
    join(process.cwd(), 'sql/refactor-v3/01-seed-core.sql'),
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

  it('seeds the renamed administrator and removes the fake workspace menu', () => {
    expect(initSql).toContain("'kwitsukasa', '123456', 'KwiTsukasa'");
    expect(initSql).toContain("'/analytics', 'Asia/Shanghai'");
    expect(initSql).toContain("'Analytics', '/analytics'");
    expect(initSql).not.toContain("'vben', '123456'");
    expect(initSql).not.toContain("'jack', '123456'");
    expect(initSql).not.toContain("'Workspace'");
    expect(initSql).not.toContain("'/workspace'");
    expect(initSql).toContain('`username` = VALUES(`username`)');
    expect(initSql).not.toContain('`password` = VALUES(`password`)');
    expect(refactorSeedSql).not.toContain('password = VALUES(password)');
  });
});
