import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthGuardModule } from '@/admin/auth/admin-auth-guard.module';
import { QqbotPluginPlatformController } from './plugin-platform.controller';
import { QqbotPluginPlatformService } from './plugin-platform.service';
import { QQBOT_PLUGIN_PLATFORM_ENTITIES } from './persistence';

@Module({
  controllers: [QqbotPluginPlatformController],
  exports: [QqbotPluginPlatformService],
  imports: [
    AdminAuthGuardModule,
    TypeOrmModule.forFeature([...QQBOT_PLUGIN_PLATFORM_ENTITIES]),
  ],
  providers: [QqbotPluginPlatformService],
})
export class QqbotPluginPlatformModule {}
