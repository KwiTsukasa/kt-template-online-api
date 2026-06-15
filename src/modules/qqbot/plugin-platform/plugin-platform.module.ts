import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthGuardModule } from '@/modules/admin/identity/auth/admin-auth-guard.module';
import { QqbotPluginPlatformController } from './plugin-platform.controller';
import { QqbotPluginPlatformService } from './plugin-platform.service';
import { QQBOT_PLUGIN_PLATFORM_ENTITIES } from './persistence';
import { QqbotPluginHttpClientService } from './sdk';

@Module({
  controllers: [QqbotPluginPlatformController],
  exports: [QqbotPluginHttpClientService, QqbotPluginPlatformService],
  imports: [
    AdminAuthGuardModule,
    TypeOrmModule.forFeature([...QQBOT_PLUGIN_PLATFORM_ENTITIES]),
  ],
  providers: [QqbotPluginHttpClientService, QqbotPluginPlatformService],
})
export class QqbotPluginPlatformModule {}
