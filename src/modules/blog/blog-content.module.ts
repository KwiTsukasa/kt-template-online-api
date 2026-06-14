import { Module } from '@nestjs/common';
import { BlogArticleController } from '@/blog/blog-article.controller';
import { BlogArticleService } from '@/blog/blog-article.service';
import { BlogModule } from '@/blog/blog.module';
import { BlogTermController } from '@/blog/blog-term.controller';
import { BlogTermService } from '@/blog/blog-term.service';
import { BlogThemeConfigController } from '@/blog/blog-theme-config.controller';
import { BlogThemeConfigService } from '@/blog/blog-theme-config.service';

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
  imports: [BlogModule],
  exports: [BlogModule],
})
export class BlogContentModule {}
