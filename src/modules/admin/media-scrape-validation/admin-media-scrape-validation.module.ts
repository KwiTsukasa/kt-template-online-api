import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthGuardModule } from '@/modules/admin/identity/auth/admin-auth-guard.module';
import { MediaGovernancePermissionGuard } from '@/modules/admin/media-governance/presentation/media-governance-permission.guard';
import {
  MediaGovernanceTaskEntity,
  MediaGovernanceUnitEntity,
} from '@/modules/admin/media-governance/infrastructure/persistence/media-governance.entities';
import {
  MEDIA_SCRAPE_VALIDATION_SINK,
  MediaScrapeValidationService,
} from './application/media-scrape-validation.service';
import { MediaScrapeValidationEntity } from './infrastructure/persistence/media-scrape-validation.entity';
import {
  MediaScrapeValidationController,
  MediaScrapeValidationInternalController,
} from './presentation/media-scrape-validation.controller';
import { MediaScrapeValidationInternalGuard } from './presentation/media-scrape-validation-internal.guard';

@Module({
  controllers: [
    MediaScrapeValidationController,
    MediaScrapeValidationInternalController,
  ],
  exports: [MEDIA_SCRAPE_VALIDATION_SINK, MediaScrapeValidationService],
  imports: [
    AdminAuthGuardModule,
    ConfigModule,
    TypeOrmModule.forFeature([
      MediaGovernanceTaskEntity,
      MediaGovernanceUnitEntity,
      MediaScrapeValidationEntity,
    ]),
  ],
  providers: [
    MediaGovernancePermissionGuard,
    MediaScrapeValidationInternalGuard,
    MediaScrapeValidationService,
    {
      provide: MEDIA_SCRAPE_VALIDATION_SINK,
      useExisting: MediaScrapeValidationService,
    },
  ],
})
export class AdminMediaScrapeValidationModule {}
