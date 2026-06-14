import { Module } from '@nestjs/common';
import { AdminIdentityModule } from './identity/admin-identity.module';
import { AdminPlatformConfigModule } from './platform-config/admin-platform-config.module';

@Module({
  imports: [AdminIdentityModule, AdminPlatformConfigModule],
})
export class AdminModule {}
