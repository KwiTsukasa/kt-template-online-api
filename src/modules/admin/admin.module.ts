import { Module } from '@nestjs/common';
import { AdminCodexRemoteModule } from './codex-remote/admin-codex-remote.module';
import { AdminIdentityModule } from './identity/admin-identity.module';
import { AdminLlmModule } from './llm/admin-llm.module';
import { AdminMediaGovernanceModule } from './media-governance/admin-media-governance.module';
import { AdminMediaScrapeValidationModule } from './media-scrape-validation/admin-media-scrape-validation.module';
import { AdminPlatformConfigModule } from './platform-config/admin-platform-config.module';

@Module({
  imports: [
    AdminCodexRemoteModule,
    AdminIdentityModule,
    AdminLlmModule,
    AdminMediaGovernanceModule,
    AdminMediaScrapeValidationModule,
    AdminPlatformConfigModule,
  ],
})
export class AdminModule {}
