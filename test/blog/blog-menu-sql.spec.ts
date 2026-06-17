import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('blog-menu.sql', () => {
  const sql = readFileSync(join(process.cwd(), 'sql/blog-menu.sql'), 'utf8');

  /**
   * 执行 博客内容流程。
   * @param name - 名称文本；影响 expectMenuRoute 的返回值。
   * @param path - 路由或文件路径；影响 expectMenuRoute 的返回值。
   * @param component - component 输入；影响 expectMenuRoute 的返回值。
   * @param authCode - authCode 输入；影响 expectMenuRoute 的返回值。
   */
  function expectMenuRoute(
    name: string,
    path: string,
    component: string,
    authCode: string,
  ) {
    expect(sql).toContain(
      `'${name}', '${path}', '${component}', NULL, '${authCode}', 'menu'`,
    );
  }

  it('adds local blog admin menus and action permissions', () => {
    [
      'Blog',
      'BlogArticle',
      'BlogArticleCreate',
      'BlogArticleEdit',
      'BlogArticleDelete',
      'BlogArticleImport',
      'BlogCategory',
      'BlogTag',
      'BlogTheme',
      'BlogThemeSave',
      'BlogThemeImport',
    ].forEach((name) => {
      expect(sql).toContain(`'${name}'`);
    });
  });

  it('keeps database menu routes aligned with admin route components', () => {
    expect(sql).toContain(
      "'Blog', '/blog', NULL, '/blog/article', NULL, 'catalog'",
    );
    expectMenuRoute(
      'BlogArticle',
      '/blog/article',
      '/blog/article/list',
      'Blog:Article:List',
    );
    expectMenuRoute(
      'BlogCategory',
      '/blog/category',
      '/blog/category/list',
      'Blog:Category:List',
    );
    expectMenuRoute('BlogTag', '/blog/tag', '/blog/tag/list', 'Blog:Tag:List');
    expectMenuRoute(
      'BlogTheme',
      '/blog/theme',
      '/blog/theme/config',
      'Blog:Theme:List',
    );
  });

  it('grants blog menus to admin roles without deleting existing role menus', () => {
    expect(sql).toContain('INSERT IGNORE INTO `admin_role_menu`');
    expect(sql).toContain("menu.`name` LIKE 'Blog%'");
    expect(sql).toContain("role.`role_code` IN ('super', 'admin')");
    expect(sql).not.toMatch(/DELETE\s+FROM\s+`admin_role_menu`/i);
  });
});
