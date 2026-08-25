import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AdminAuthGuardModule } from '@/modules/admin/identity/auth/admin-auth-guard.module';
import { CodexRemoteService } from './application/codex-remote.service';
import { CodexRemoteController } from './presentation/codex-remote.controller';

@Module({
  controllers: [CodexRemoteController],
  imports: [ConfigModule, AdminAuthGuardModule],
  providers: [CodexRemoteService],
})
export class AdminCodexRemoteModule {}

