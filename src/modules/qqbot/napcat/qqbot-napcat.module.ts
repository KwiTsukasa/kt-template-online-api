import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthGuardModule } from '@/modules/admin/identity/auth/admin-auth-guard.module';
import { QQBOT_ACCOUNT_NAPCAT_RUNTIME_PORT } from '@/modules/qqbot/core/application/account/qqbot-account-napcat-runtime.port';
import { QqbotCoreModule } from '@/modules/qqbot/core/qqbot-core.module';
import { QqbotNapcatAccountRuntimeService } from './application/account-runtime/qqbot-napcat-account-runtime.service';
import { QqbotNapcatLoginService } from './application/login/qqbot-napcat-login.service';
import { QqbotNapcatWatchdogService } from './application/login/qqbot-napcat-watchdog.service';
import { NapcatConfigWriterService } from './application/runtime/napcat-config-writer.service';
import { NapcatLoginEventService } from './application/runtime/napcat-login-event.service';
import { NapcatRuntimeProfileInspectorService } from './application/runtime/napcat-runtime-profile-inspector.service';
import { NapcatRuntimeProfileService } from './application/runtime/napcat-runtime-profile.service';
import { NapcatSessionBehaviorService } from './application/runtime/napcat-session-behavior.service';
import { QqbotNapcatLoginController } from './contract/qqbot-napcat-login.controller';
import { QqbotNapcatRuntimeController } from './contract/qqbot-napcat-runtime.controller';
import { NapcatRuntimeProfileInspectionScriptService } from './infrastructure/integration/container/napcat-runtime-profile-inspection-script.service';
import { QqbotNapcatContainerService } from './infrastructure/integration/container/qqbot-napcat-container.service';
import { NapcatDeviceIdentityService } from './infrastructure/integration/device/napcat-device-identity.service';
import { NAPCAT_RUNTIME_ENTITIES } from './infrastructure/persistence';
import { NapcatLoginStateStoreService } from './infrastructure/persistence/napcat-login-state-store.service';

export const QQBOT_NAPCAT_ENTITIES = [...NAPCAT_RUNTIME_ENTITIES];

export const QQBOT_NAPCAT_CONTROLLERS = [
  QqbotNapcatLoginController,
  QqbotNapcatRuntimeController,
];

export const QQBOT_NAPCAT_PROVIDERS = [
  NapcatConfigWriterService,
  NapcatDeviceIdentityService,
  NapcatLoginStateStoreService,
  NapcatLoginEventService,
  NapcatRuntimeProfileInspectorService,
  NapcatRuntimeProfileInspectionScriptService,
  NapcatRuntimeProfileService,
  NapcatSessionBehaviorService,
  QqbotNapcatAccountRuntimeService,
  QqbotNapcatContainerService,
  QqbotNapcatLoginService,
  QqbotNapcatWatchdogService,
  {
    provide: QQBOT_ACCOUNT_NAPCAT_RUNTIME_PORT,
    useExisting: QqbotNapcatAccountRuntimeService,
  },
];

export const QQBOT_NAPCAT_EXPORTS = [
  NapcatDeviceIdentityService,
  NapcatLoginEventService,
  NapcatLoginStateStoreService,
  NapcatSessionBehaviorService,
  QQBOT_ACCOUNT_NAPCAT_RUNTIME_PORT,
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
