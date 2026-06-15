import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '@/common';
import { AdminAuthGuardModule } from '@/modules/admin/identity/auth/admin-auth-guard.module';
import { WordpressMirrorModule } from '@/modules/wordpress/wordpress-mirror.module';
import { BlogArticleService } from './application/blog-article.service';
import { BlogTermService } from './application/blog-term.service';
import { BlogThemeConfigService } from './application/blog-theme-config.service';
import { BlogArticleController } from './contract/blog-article.controller';
import { BlogTermController } from './contract/blog-term.controller';
import { BlogThemeConfigController } from './contract/blog-theme-config.controller';
import { BlogArticle } from './infrastructure/persistence/blog-article.entity';
import { BlogTerm } from './infrastructure/persistence/blog-term.entity';
import { BlogThemeConfig } from './infrastructure/persistence/blog-theme-config.entity';

export const BLOG_CONTENT_CONTROLLERS = [
  BlogArticleController,
  BlogTermController,
  BlogThemeConfigController,
];

export const BLOG_CONTENT_PROVIDERS = [
  BlogArticleService,
  BlogTermService,
  BlogThemeConfigService,
];

export const BLOG_CONTENT_DOMAIN_CONTRACT = {
  tables: [
    'blog_post',
    'blog_taxonomy',
    'blog_term',
    'blog_post_term',
    'blog_theme_profile',
    'blog_import_job',
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
  importJob: {
    table: 'blog_import_job',
    sourceField: 'source_key',
    statusField: 'status',
    summaryField: 'summary_json',
  },
} as const;

@Module({
  imports: [
    AdminAuthGuardModule,
    CommonModule,
    WordpressMirrorModule,
    TypeOrmModule.forFeature([BlogArticle, BlogTerm, BlogThemeConfig]),
  ],
  controllers: BLOG_CONTENT_CONTROLLERS,
  providers: BLOG_CONTENT_PROVIDERS,
  exports: BLOG_CONTENT_PROVIDERS,
})
export class BlogContentModule {}
