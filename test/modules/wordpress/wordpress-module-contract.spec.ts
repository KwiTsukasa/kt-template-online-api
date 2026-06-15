jest.mock('../../../src/modules/qqbot/core/qqbot-core.module', () => ({
  QqbotCoreModule: class QqbotCoreModule {},
}));

import { MODULE_METADATA } from '@nestjs/common/constants';
import { AppModule } from '../../../src/app.module';
import { AdminAuthGuardModule } from '../../../src/modules/admin/identity/auth/admin-auth-guard.module';
import { AdminIdentityModule } from '../../../src/modules/admin/identity/admin-identity.module';
import { WordpressService } from '../../../src/modules/wordpress/application/wordpress.service';
import { WordpressArticleController } from '../../../src/modules/wordpress/contract/wordpress-article.controller';
import { WordpressAuthController } from '../../../src/modules/wordpress/contract/wordpress-auth.controller';
import { WordpressCategoryController } from '../../../src/modules/wordpress/contract/wordpress-category.controller';
import { WordpressTagController } from '../../../src/modules/wordpress/contract/wordpress-tag.controller';
import { WordpressThemeController } from '../../../src/modules/wordpress/contract/wordpress-theme.controller';
import {
  WORDPRESS_MIRROR_CONTROLLERS,
  WORDPRESS_MIRROR_DOMAIN_CONTRACT,
  WORDPRESS_MIRROR_PROVIDERS,
  WordpressMirrorModule,
} from '../../../src/modules/wordpress/wordpress-mirror.module';
import {
  collectControllerRoutes,
  routeKey,
} from '../../helpers/controller-route.helper';
import { readRefactorV3SqlSchema } from '../../helpers/sql-schema.helper';

const getModuleMetadata = <T>(moduleClass: unknown, key: string): T[] => {
  return Reflect.getMetadata(key, moduleClass) || [];
};

const expectNoModuleNamed = (modules: unknown[], moduleName: string) => {
  expect(
    modules.some(
      (moduleRef) =>
        typeof moduleRef === 'function' && moduleRef.name === moduleName,
    ),
  ).toBe(false);
};

describe('WordPress mirror module contract', () => {
  const schema = readRefactorV3SqlSchema();

  it('keeps public and Admin-facing WordPress routes compatible', () => {
    const routes = collectControllerRoutes(WORDPRESS_MIRROR_CONTROLLERS);

    expect(routes.map(routeKey)).toEqual(
      expect.arrayContaining([
        'POST /wordpress/auth/login',
        'POST /wordpress/auth/logout',
        'GET /wordpress/auth/check',
        'GET /wordpress/article/public/list',
        'GET /wordpress/article/public/detail',
        'GET /wordpress/article/list',
        'GET /wordpress/article/detail',
        'POST /wordpress/article/save',
        'POST /wordpress/article/update',
        'POST /wordpress/article/remove',
        'GET /wordpress/tag/list',
        'GET /wordpress/tag/detail',
        'POST /wordpress/tag/save',
        'POST /wordpress/tag/update',
        'POST /wordpress/tag/remove',
        'GET /wordpress/category/list',
        'GET /wordpress/category/detail',
        'POST /wordpress/category/save',
        'POST /wordpress/category/update',
        'POST /wordpress/category/remove',
        'GET /wordpress/theme/config',
      ]),
    );
  });

  it('routes WordPress through the new module boundary without duplicate direct controllers', () => {
    expect(getModuleMetadata(AppModule, MODULE_METADATA.IMPORTS)).toEqual(
      expect.arrayContaining([WordpressMirrorModule]),
    );
    expect(
      getModuleMetadata(AdminIdentityModule, MODULE_METADATA.IMPORTS),
    ).toEqual(expect.arrayContaining([WordpressMirrorModule]));

    const appImports = getModuleMetadata(AppModule, MODULE_METADATA.IMPORTS);
    const identityImports = getModuleMetadata(
      AdminIdentityModule,
      MODULE_METADATA.IMPORTS,
    );
    const wordpressImports = getModuleMetadata(
      WordpressMirrorModule,
      MODULE_METADATA.IMPORTS,
    );
    const wordpressExports = getModuleMetadata(
      WordpressMirrorModule,
      MODULE_METADATA.EXPORTS,
    );

    expectNoModuleNamed(appImports, 'WordpressModule');
    expectNoModuleNamed(identityImports, 'WordpressModule');
    expectNoModuleNamed(wordpressImports, 'WordpressModule');
    expectNoModuleNamed(wordpressExports, 'WordpressModule');

    expect(wordpressImports).toEqual(
      expect.arrayContaining([AdminAuthGuardModule]),
    );
    expect(
      getModuleMetadata(WordpressMirrorModule, MODULE_METADATA.CONTROLLERS),
    ).toEqual(
      expect.arrayContaining([
        WordpressAuthController,
        WordpressArticleController,
        WordpressTagController,
        WordpressCategoryController,
        WordpressThemeController,
      ]),
    );
    expect(
      getModuleMetadata(WordpressMirrorModule, MODULE_METADATA.PROVIDERS),
    ).toEqual(expect.arrayContaining([WordpressService]));
    expect(wordpressExports).toEqual(expect.arrayContaining([WordpressService]));
    expect(WORDPRESS_MIRROR_CONTROLLERS).toEqual(
      expect.arrayContaining([
        WordpressAuthController,
        WordpressArticleController,
        WordpressTagController,
        WordpressCategoryController,
        WordpressThemeController,
      ]),
    );
    expect(WORDPRESS_MIRROR_PROVIDERS).toEqual(
      expect.arrayContaining([WordpressService]),
    );
  });

  it('matches the real Batch 3 WordPress mirror SQL schema and sync job contract', () => {
    expect(WORDPRESS_MIRROR_DOMAIN_CONTRACT.tables).toEqual([
      'wordpress_site',
      'wordpress_auth_session',
      'wordpress_remote_post',
      'wordpress_remote_term',
      'wordpress_sync_job',
      'wordpress_sync_mapping',
    ]);
    for (const table of WORDPRESS_MIRROR_DOMAIN_CONTRACT.tables) {
      expect(schema.hasTable(table)).toBe(true);
    }

    schema.expectTableColumns('wordpress_site', [
      'id',
      'site_key',
      'base_url',
      'status',
    ]);
    schema.expectTableColumns('wordpress_auth_session', [
      'id',
      'site_id',
      'status',
      'expires_at',
      'safe_summary',
    ]);
    schema.expectTableColumns('wordpress_remote_post', [
      'id',
      'site_id',
      'remote_id',
      'slug',
      'status',
      'raw_payload',
    ]);
    schema.expectTableColumns('wordpress_remote_term', [
      'id',
      'site_id',
      'remote_id',
      'taxonomy_key',
      'slug',
      'raw_payload',
    ]);
    schema.expectTableColumns('wordpress_sync_job', [
      'id',
      'site_id',
      'job_type',
      'status',
      'started_at',
      'finished_at',
      'summary_json',
    ]);
    schema.expectTableColumns('wordpress_sync_mapping', [
      'id',
      'site_id',
      'remote_type',
      'remote_id',
      'local_type',
      'local_id',
    ]);

    expect(WORDPRESS_MIRROR_DOMAIN_CONTRACT.remotePostMapping).toEqual({
      remoteTable: 'wordpress_remote_post',
      mappingTable: 'wordpress_sync_mapping',
      remoteType: 'post',
      localType: 'blog_post',
      remoteKeys: ['site_id', 'remote_id'],
      localKey: 'local_id',
    });
    expect(WORDPRESS_MIRROR_DOMAIN_CONTRACT.remoteTermMapping).toEqual({
      remoteTable: 'wordpress_remote_term',
      mappingTable: 'wordpress_sync_mapping',
      remoteType: 'term',
      localType: 'blog_term',
      remoteKeys: ['site_id', 'taxonomy_key', 'remote_id'],
      localKey: 'local_id',
    });
    expect(WORDPRESS_MIRROR_DOMAIN_CONTRACT.syncJob).toEqual({
      table: 'wordpress_sync_job',
      jobTypeField: 'job_type',
      statusField: 'status',
      startedAtField: 'started_at',
      finishedAtField: 'finished_at',
      summaryField: 'summary_json',
    });
  });
});
