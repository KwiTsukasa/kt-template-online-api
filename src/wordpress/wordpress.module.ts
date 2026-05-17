import { Module } from '@nestjs/common';
import { AdminAuthGuardModule } from '@/admin/auth/admin-auth-guard.module';
import { ToolsService } from '@/common';
import { WordpressArticleController } from './wordpress-article.controller';
import { WordpressAuthController } from './wordpress-auth.controller';
import { WordpressCategoryController } from './wordpress-category.controller';
import { WordpressService } from './wordpress.service';
import { WordpressTagController } from './wordpress-tag.controller';

@Module({
  imports: [AdminAuthGuardModule],
  controllers: [
    WordpressAuthController,
    WordpressArticleController,
    WordpressTagController,
    WordpressCategoryController,
  ],
  providers: [ToolsService, WordpressService],
})
export class WordpressModule {}
