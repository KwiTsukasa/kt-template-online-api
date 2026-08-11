import { Module } from '@nestjs/common';
import { AdminIdentityModule } from './identity/admin-identity.module';
import { AdminMediaGovernanceModule } from './media-governance/admin-media-governance.module';
import { AdminPlatformConfigModule } from './platform-config/admin-platform-config.module';

@Module({
  imports: [
    AdminIdentityModule,
    AdminMediaGovernanceModule,
    AdminPlatformConfigModule,
  ],
})
export class AdminModule {}
