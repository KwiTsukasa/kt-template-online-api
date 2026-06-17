import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = join(__dirname, '..', '..');

/**
 * 读取 测试断言资源。
 * @param relativePath - 相对文件路径；读取本地文件内容。
 */
function readSql(relativePath: string) {
  return readFileSync(join(projectRoot, relativePath), 'utf8');
}

describe('system notice SQL', () => {
  it('keeps the notice table and menu in the full admin initializer', () => {
    const sql = readSql('sql/vben-admin-init.sql');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS `admin_notice`');
    expect(sql).toContain("'SystemNotice'");
    expect(sql).toContain("'System:Notice:List'");
  });

  it('grants system notice permissions only to the super role', () => {
    const sql = readSql('sql/system-notice-menu.sql');

    expect(sql).toContain("role.`role_code` = 'super'");
    expect(sql).not.toContain("role.`role_code` IN ('super', 'admin')");
  });

  it('does not keep the legacy manual create notice button in menu scripts', () => {
    const initSql = readSql('sql/vben-admin-init.sql');
    const fixMenuSql = readSql('sql/fix-admin-menu-meta.sql');

    expect(initSql).not.toContain('SystemNoticeCreate');
    expect(fixMenuSql).not.toContain('SystemNoticeCreate');
  });

  it('uses existing locale keys for notice menu button titles', () => {
    const noticeSql = readSql('sql/system-notice-menu.sql');
    const initSql = readSql('sql/vben-admin-init.sql');
    const fixMenuSql = readSql('sql/fix-admin-menu-meta.sql');

    for (const sql of [noticeSql, initSql, fixMenuSql]) {
      expect(sql).not.toContain('system.notice.handle');
      expect(sql).toContain('system.notice.markHandled');
    }
  });

  it('adds active dedupe uniqueness and runtime indexes for existing notice tables', () => {
    const sql = readSql('sql/system-notice-menu.sql');

    expect(sql).toContain('active_dedupe_key');
    expect(sql).toContain('uk_admin_notice_active_dedupe_key');
    expect(sql).toContain('idx_admin_notice_source_event');
    expect(sql).toContain('idx_admin_notice_last_seen');
    expect(sql).toContain('INFORMATION_SCHEMA.STATISTICS');
  });
});
