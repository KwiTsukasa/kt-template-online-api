import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('blog-menu.sql', () => {
  const sqlFiles = [
    readFileSync(join(process.cwd(), 'sql/blog-menu.sql'), 'utf8'),
    readFileSync(join(process.cwd(), 'sql/vben-admin-init.sql'), 'utf8'),
  ];

  /**
   * 断言博客菜单种子和全量初始化 SQL 同步包含同一段菜单配置。
   * @param snippet - SQL 片段；同时约束增量菜单脚本和全量初始化脚本。
   */
  function expectAllSqlToContain(snippet: string) {
    sqlFiles.forEach((sql) => {
      expect(sql).toContain(snippet);
    });
  }

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
    expectAllSqlToContain(
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
      'BlogArticlePreview',
      'BlogArticlePreviewButton',
      'BlogCategory',
      'BlogTag',
      'BlogTheme',
      'BlogThemeSave',
      'BlogThemeImport',
    ].forEach((name) => {
      expectAllSqlToContain(`'${name}'`);
    });
  });

  it('keeps database menu routes aligned with admin route components', () => {
    expectAllSqlToContain(
      "'Blog', '/blog', NULL, '/blog/article', NULL, 'catalog'",
    );
    expectMenuRoute(
      'BlogArticle',
      '/blog/article',
      '/blog/article/list',
      'Blog:Article:List',
    );
    expectAllSqlToContain(
      "'BlogArticlePreview', '/blog/article/:articleId/preview', '/blog/article/preview/index', NULL, 'Blog:Article:Preview', 'menu'",
    );
    expectAllSqlToContain(
      `'BlogArticlePreviewButton', NULL, NULL, NULL, 'Blog:Article:Preview', 'button'`,
    );
    expectAllSqlToContain('"hideInMenu":true');
    expectAllSqlToContain('"activePath":"/blog/article"');
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
    const blogMenuSql = sqlFiles[0] || '';
    expect(blogMenuSql).toContain('INSERT IGNORE INTO `admin_role_menu`');
    expect(blogMenuSql).toContain("menu.`name` LIKE 'Blog%'");
    expect(blogMenuSql).toContain("role.`role_code` IN ('super', 'admin')");
    expect(blogMenuSql).not.toMatch(/DELETE\s+FROM\s+`admin_role_menu`/i);
  });
});
