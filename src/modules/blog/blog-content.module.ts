import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '@/common';
import { AdminAuthGuardModule } from '@/modules/admin/identity/auth/admin-auth-guard.module';
import { AssetModule } from '@/modules/asset/asset.module';
import { BlogArticleService } from './application/blog-article.service';
import {
  BLOG_LEGACY_ASSET_DNS_RESOLVER,
  BLOG_LEGACY_ASSET_MANIFEST_STORE,
  BLOG_LEGACY_ASSET_RAW_HTTP_REQUEST,
  BlogLegacyAssetHttpFetcher,
  BlogLegacyAssetManifestFileStore,
  BlogLegacyAssetMigrationService,
  defaultBlogLegacyAssetDnsResolver,
  defaultBlogLegacyAssetRawHttpRequest,
} from './application/blog-legacy-asset-migration.service';
import { BlogTermService } from './application/blog-term.service';
import { BlogThemeConfigService } from './application/blog-theme-config.service';
import { BlogArticleController } from './contract/blog-article.controller';
import { BlogPublicAssetController } from './contract/blog-public-asset.controller';
import { BlogTermController } from './contract/blog-term.controller';
import { BlogThemeConfigController } from './contract/blog-theme-config.controller';
import { BlogArticle } from './infrastructure/persistence/blog-article.entity';
import { BlogTerm } from './infrastructure/persistence/blog-term.entity';
import { BlogThemeConfig } from './infrastructure/persistence/blog-theme-config.entity';

export const BLOG_CONTENT_CONTROLLERS = [
  BlogArticleController,
  BlogTermController,
  BlogThemeConfigController,
  BlogPublicAssetController,
];

export const BLOG_CONTENT_PROVIDERS = [
  BlogArticleService,
  BlogLegacyAssetMigrationService,
  BlogTermService,
  BlogThemeConfigService,
];

const BLOG_LEGACY_ASSET_INFRASTRUCTURE_PROVIDERS = [
  BlogLegacyAssetHttpFetcher,
  BlogLegacyAssetManifestFileStore,
  {
    provide: BLOG_LEGACY_ASSET_DNS_RESOLVER,
    useValue: defaultBlogLegacyAssetDnsResolver,
  },
  {
    provide: BLOG_LEGACY_ASSET_RAW_HTTP_REQUEST,
    useValue: defaultBlogLegacyAssetRawHttpRequest,
  },
  {
    provide: BLOG_LEGACY_ASSET_MANIFEST_STORE,
    useExisting: BlogLegacyAssetManifestFileStore,
  },
];

export const BLOG_CONTENT_DOMAIN_CONTRACT = {
  tables: [
    'blog_post',
    'blog_taxonomy',
    'blog_term',
    'blog_post_term',
    'blog_theme_profile',
  ],
  publicArticleList: {
    route: 'GET /blog/article/public/list',
    sourceTable: 'blog_post',
    statusField: 'status',
    publishTimeField: 'publish_time',
  },
  publicArticleDetail: {
    route: 'GET /blog/article/public/detail',
    sourceTable: 'blog_post',
    lookupFields: ['id', 'slug'],
  },
  termRelation: {
    relationTable: 'blog_post_term',
    postKey: 'post_id',
    termKey: 'term_id',
    taxonomyTables: ['blog_taxonomy', 'blog_term'],
  },
  themeProfile: {
    table: 'blog_theme_profile',
    profileKey: 'profile_key',
    configField: 'config_json',
    enabledField: 'enabled',
  },
} as const;

@Module({
  imports: [
    AdminAuthGuardModule,
    AssetModule,
    CommonModule,
    TypeOrmModule.forFeature([BlogArticle, BlogTerm, BlogThemeConfig]),
  ],
  controllers: BLOG_CONTENT_CONTROLLERS,
  providers: [
    ...BLOG_CONTENT_PROVIDERS,
    ...BLOG_LEGACY_ASSET_INFRASTRUCTURE_PROVIDERS,
  ],
  exports: BLOG_CONTENT_PROVIDERS,
})
export class BlogContentModule {}
