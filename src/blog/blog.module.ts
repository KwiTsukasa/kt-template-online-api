import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthGuardModule } from '@/admin/auth/admin-auth-guard.module';
import { CommonModule } from '@/common';
import { WordpressModule } from '@/wordpress/wordpress.module';
import { BlogArticleController } from './blog-article.controller';
import { BlogArticle } from './blog-article.entity';
import { BlogArticleService } from './blog-article.service';
import { BlogThemeConfigController } from './blog-theme-config.controller';
import { BlogThemeConfig } from './blog-theme-config.entity';
import { BlogThemeConfigService } from './blog-theme-config.service';
import { BlogTermController } from './blog-term.controller';
import { BlogTerm } from './blog-term.entity';
import { BlogTermService } from './blog-term.service';

@Module({
  imports: [
    AdminAuthGuardModule,
    CommonModule,
    WordpressModule,
    TypeOrmModule.forFeature([BlogArticle, BlogTerm, BlogThemeConfig]),
  ],
  controllers: [
    BlogArticleController,
    BlogTermController,
    BlogThemeConfigController,
  ],
  providers: [BlogArticleService, BlogTermService, BlogThemeConfigService],
  exports: [BlogArticleService, BlogTermService, BlogThemeConfigService],
})
export class BlogModule {}
