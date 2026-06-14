import { Module } from '@nestjs/common';
import { WordpressArticleController } from '@/wordpress/wordpress-article.controller';
import { WordpressAuthController } from '@/wordpress/wordpress-auth.controller';
import { WordpressCategoryController } from '@/wordpress/wordpress-category.controller';
import { WordpressModule } from '@/wordpress/wordpress.module';
import { WordpressService } from '@/wordpress/wordpress.service';
import { WordpressTagController } from '@/wordpress/wordpress-tag.controller';
import { WordpressThemeController } from '@/wordpress/wordpress-theme.controller';

export const WORDPRESS_MIRROR_CONTROLLERS = [
  WordpressAuthController,
  WordpressArticleController,
  WordpressTagController,
  WordpressCategoryController,
  WordpressThemeController,
];

export const WORDPRESS_MIRROR_PROVIDERS = [WordpressService];

export const WORDPRESS_MIRROR_DOMAIN_CONTRACT = {
  tables: [
    'wordpress_site',
    'wordpress_auth_session',
    'wordpress_remote_post',
    'wordpress_remote_term',
    'wordpress_sync_job',
    'wordpress_sync_mapping',
  ],
  remotePostMapping: {
    remoteTable: 'wordpress_remote_post',
    mappingTable: 'wordpress_sync_mapping',
    remoteType: 'post',
    localType: 'blog_post',
    remoteKeys: ['site_id', 'remote_id'],
    localKey: 'local_id',
  },
  remoteTermMapping: {
    remoteTable: 'wordpress_remote_term',
    mappingTable: 'wordpress_sync_mapping',
    remoteType: 'term',
    localType: 'blog_term',
    remoteKeys: ['site_id', 'taxonomy_key', 'remote_id'],
    localKey: 'local_id',
  },
  syncJob: {
    table: 'wordpress_sync_job',
    jobTypeField: 'job_type',
    statusField: 'status',
    startedAtField: 'started_at',
    finishedAtField: 'finished_at',
    summaryField: 'summary_json',
  },
} as const;

@Module({
  imports: [WordpressModule],
  exports: [WordpressModule],
})
export class WordpressMirrorModule {}
