import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('blog-init.sql', () => {
  const sql = readFileSync(join(process.cwd(), 'sql/blog-init.sql'), 'utf8');

  it('creates the local blog tables needed when DB_SYNC is disabled', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS `blog_article`');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS `blog_term`');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS `blog_theme_config`');
  });

  it('keeps article content and term relation columns aligned with entities', () => {
    [
      '`content_markdown` mediumtext',
      '`content_html` mediumtext',
      '`category_items` text',
      '`tag_items` text',
      '`publish_time` datetime',
      '`is_deleted` tinyint(1)',
    ].forEach((column) => {
      expect(sql).toContain(column);
    });
  });

  it('keeps theme config columns aligned with BlogThemeConfig entity', () => {
    expect(sql).toContain('`id` varchar(64) NOT NULL');
    expect(sql).toContain('`config` longtext NOT NULL');
    expect(sql).toContain("`source` varchar(255) NOT NULL DEFAULT 'local'");
  });
});
