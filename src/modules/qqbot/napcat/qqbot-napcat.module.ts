import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthGuardModule } from '@/modules/admin/identity/auth/admin-auth-guard.module';
import { QqbotCoreModule } from '@/modules/qqbot/core/qqbot-core.module';
import { QqbotNapcatLoginService } from './application/login/qqbot-napcat-login.service';
import { QqbotNapcatWatchdogService } from './application/login/qqbot-napcat-watchdog.service';
import { QqbotNapcatLoginController } from './contract/qqbot-napcat-login.controller';
import { QqbotNapcatContainerService } from './infrastructure/integration/container/qqbot-napcat-container.service';
import { NapcatDeviceIdentityService } from './infrastructure/integration/device/napcat-device-identity.service';
import {
  NAPCAT_RUNTIME_ENTITIES,
} from './infrastructure/persistence';
import { NapcatLoginStateStoreService } from './infrastructure/persistence/napcat-login-state-store.service';

export const QQBOT_NAPCAT_ENTITIES = [...NAPCAT_RUNTIME_ENTITIES];

export const QQBOT_NAPCAT_CONTROLLERS = [QqbotNapcatLoginController];

export const QQBOT_NAPCAT_PROVIDERS = [
  NapcatDeviceIdentityService,
  NapcatLoginStateStoreService,
  QqbotNapcatContainerService,
  QqbotNapcatLoginService,
  QqbotNapcatWatchdogService,
];

export const QQBOT_NAPCAT_EXPORTS = [
  NapcatDeviceIdentityService,
  NapcatLoginStateStoreService,
  QqbotNapcatContainerService,
  QqbotNapcatLoginService,
];

@Module({
  imports: [
    ConfigModule,
    AdminAuthGuardModule,
    forwardRef(() => QqbotCoreModule),
    TypeOrmModule.forFeature(QQBOT_NAPCAT_ENTITIES),
  ],
  controllers: QQBOT_NAPCAT_CONTROLLERS,
  providers: QQBOT_NAPCAT_PROVIDERS,
  exports: [TypeOrmModule, ...QQBOT_NAPCAT_EXPORTS],
})
export class QqbotNapcatModule {}
