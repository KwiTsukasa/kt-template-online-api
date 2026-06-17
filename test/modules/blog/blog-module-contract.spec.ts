jest.mock('../../../src/modules/qqbot/core/qqbot-core.module', () => ({
  QqbotCoreModule: class QqbotCoreModule {},
}));

import { MODULE_METADATA } from '@nestjs/common/constants';
import { AppModule } from '../../../src/app.module';
import { CommonModule } from '../../../src/common';
import { AdminAuthGuardModule } from '../../../src/modules/admin/identity/auth/admin-auth-guard.module';
import { BlogArticleService } from '../../../src/modules/blog/application/blog-article.service';
import { BlogTermService } from '../../../src/modules/blog/application/blog-term.service';
import { BlogThemeConfigService } from '../../../src/modules/blog/application/blog-theme-config.service';
import { BlogArticleController } from '../../../src/modules/blog/contract/blog-article.controller';
import { BlogTermController } from '../../../src/modules/blog/contract/blog-term.controller';
import { BlogThemeConfigController } from '../../../src/modules/blog/contract/blog-theme-config.controller';
import {
  BLOG_CONTENT_CONTROLLERS,
  BLOG_CONTENT_DOMAIN_CONTRACT,
  BLOG_CONTENT_PROVIDERS,
  BlogContentModule,
} from '../../../src/modules/blog/blog-content.module';
import { WordpressMirrorModule } from '../../../src/modules/wordpress/wordpress-mirror.module';
import {
  collectControllerRoutes,
  routeKey,
} from '../../helpers/controller-route.helper';
import { readRefactorV3SqlSchema } from '../../helpers/sql-schema.helper';

/**
 * 查询 博客内容数据。
 * @param moduleClass - Nest 模块类；读取装饰器 metadata。
 * @param key - 键名；读取装饰器 metadata。
 * @returns 博客内容查询结果。
 */
const getModuleMetadata = <T>(moduleClass: unknown, key: string): T[] => {
  return Reflect.getMetadata(key, moduleClass) || [];
};

/**
 * 执行 博客内容流程。
 * @param modules - 模块列表；计算 博客布尔判断。
 * @param moduleName - 模块名称文本；构造测试断言。
 */
const expectNoModuleNamed = (modules: unknown[], moduleName: string) => {
  expect(
    modules.some(
      (moduleRef) =>
        typeof moduleRef === 'function' && moduleRef.name === moduleName,
    ),
  ).toBe(false);
};

describe('Blog content module contract', () => {
  const schema = readRefactorV3SqlSchema();

  it('keeps public and Admin-facing Blog routes compatible', () => {
    const routes = collectControllerRoutes(BLOG_CONTENT_CONTROLLERS);

    expect(routes.map(routeKey)).toEqual(
      expect.arrayContaining([
        'GET /blog/article/public/list',
        'GET /blog/article/public/detail',
        'GET /blog/article/list',
        'GET /blog/article/detail',
        'POST /blog/article/save',
        'POST /blog/article/update',
        'POST /blog/article/remove',
        'GET /blog/article/category-options',
        'GET /blog/article/tag-options',
        'POST /blog/article/import-wordpress',
        'GET /blog/category/list',
        'GET /blog/category/detail',
        'POST /blog/category/save',
        'POST /blog/category/update',
        'POST /blog/category/remove',
        'GET /blog/tag/list',
        'GET /blog/tag/detail',
        'POST /blog/tag/save',
        'POST /blog/tag/update',
        'POST /blog/tag/remove',
        'GET /blog/term/options',
        'GET /blog/theme/config',
        'POST /blog/theme/save',
        'POST /blog/theme/import-wordpress',
      ]),
    );
  });

  it('routes Blog through the new module boundary without duplicate direct controllers', () => {
    expect(getModuleMetadata(AppModule, MODULE_METADATA.IMPORTS)).toEqual(
      expect.arrayContaining([BlogContentModule]),
    );

    const appImports = getModuleMetadata(AppModule, MODULE_METADATA.IMPORTS);
    const blogImports = getModuleMetadata(
      BlogContentModule,
      MODULE_METADATA.IMPORTS,
    );
    const blogExports = getModuleMetadata(
      BlogContentModule,
      MODULE_METADATA.EXPORTS,
    );

    expectNoModuleNamed(appImports, 'BlogModule');
    expectNoModuleNamed(blogImports, 'BlogModule');
    expectNoModuleNamed(blogExports, 'BlogModule');

    expect(blogImports).toEqual(
      expect.arrayContaining([
        AdminAuthGuardModule,
        CommonModule,
        WordpressMirrorModule,
      ]),
    );
    expect(
      blogImports.some(
        (moduleRef: any) => moduleRef?.module?.name === 'TypeOrmModule',
      ),
    ).toBe(true);
    expect(
      getModuleMetadata(BlogContentModule, MODULE_METADATA.CONTROLLERS),
    ).toEqual(
      expect.arrayContaining([
        BlogArticleController,
        BlogTermController,
        BlogThemeConfigController,
      ]),
    );
    expect(
      getModuleMetadata(BlogContentModule, MODULE_METADATA.PROVIDERS),
    ).toEqual(
      expect.arrayContaining([
        BlogArticleService,
        BlogTermService,
        BlogThemeConfigService,
      ]),
    );
    expect(blogExports).toEqual(
      expect.arrayContaining([
        BlogArticleService,
        BlogTermService,
        BlogThemeConfigService,
      ]),
    );
    expect(BLOG_CONTENT_CONTROLLERS).toEqual(
      expect.arrayContaining([
        BlogArticleController,
        BlogTermController,
        BlogThemeConfigController,
      ]),
    );
    expect(BLOG_CONTENT_PROVIDERS).toEqual(
      expect.arrayContaining([
        BlogArticleService,
        BlogTermService,
        BlogThemeConfigService,
      ]),
    );
  });

  it('matches the real Batch 3 Blog content SQL schema and public surface contract', () => {
    expect(BLOG_CONTENT_DOMAIN_CONTRACT.tables).toEqual([
      'blog_post',
      'blog_taxonomy',
      'blog_term',
      'blog_post_term',
      'blog_theme_profile',
      'blog_import_job',
    ]);
    for (const table of BLOG_CONTENT_DOMAIN_CONTRACT.tables) {
      expect(schema.hasTable(table)).toBe(true);
    }

    schema.expectTableColumns('blog_post', [
      'id',
      'slug',
      'title',
      'status',
      'publish_time',
    ]);
    schema.expectTableColumns('blog_taxonomy', [
      'id',
      'taxonomy_key',
      'taxonomy_name',
    ]);
    schema.expectTableColumns('blog_term', [
      'id',
      'taxonomy_id',
      'slug',
      'term_name',
    ]);
    schema.expectTableColumns('blog_post_term', ['id', 'post_id', 'term_id']);
    schema.expectTableColumns('blog_theme_profile', [
      'id',
      'profile_key',
      'config_json',
      'enabled',
    ]);
    schema.expectTableColumns('blog_import_job', [
      'id',
      'source_key',
      'status',
      'summary_json',
    ]);

    expect(BLOG_CONTENT_DOMAIN_CONTRACT.publicArticleList).toEqual({
      route: 'GET /blog/article/public/list',
      sourceTable: 'blog_post',
      statusField: 'status',
      publishTimeField: 'publish_time',
    });
    expect(BLOG_CONTENT_DOMAIN_CONTRACT.publicArticleDetail).toEqual({
      route: 'GET /blog/article/public/detail',
      sourceTable: 'blog_post',
      lookupFields: ['id', 'slug'],
    });
    expect(BLOG_CONTENT_DOMAIN_CONTRACT.termRelation).toEqual({
      relationTable: 'blog_post_term',
      postKey: 'post_id',
      termKey: 'term_id',
      taxonomyTables: ['blog_taxonomy', 'blog_term'],
    });
    expect(BLOG_CONTENT_DOMAIN_CONTRACT.themeProfile).toEqual({
      table: 'blog_theme_profile',
      profileKey: 'profile_key',
      configField: 'config_json',
      enabledField: 'enabled',
    });
    expect(BLOG_CONTENT_DOMAIN_CONTRACT.importJob).toEqual({
      table: 'blog_import_job',
      sourceField: 'source_key',
      statusField: 'status',
      summaryField: 'summary_json',
    });
  });
});
