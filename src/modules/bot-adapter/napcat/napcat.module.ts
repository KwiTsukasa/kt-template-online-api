import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthGuardModule } from '@/modules/admin/identity/auth/admin-auth-guard.module';
import { BotProtocolModule } from '@/modules/bot';
import { BOT_ACCOUNT_NAPCAT_RUNTIME_PORT } from '@/modules/bot-adapter/core/application/account/bot-account-napcat-runtime.port';
import { BotAdapterCoreModule } from '@/modules/bot-adapter/core/bot-adapter-core.module';
import { NapcatAccountRuntimeService } from './application/account-runtime/napcat-account-runtime.service';
import { NapcatLoginService } from './application/login/napcat-login.service';
import { NapcatWatchdogService } from './application/login/napcat-watchdog.service';
import { NapcatConfigWriterService } from './application/runtime/napcat-config-writer.service';
import { NapcatRuntimeProfileInspectorService } from './application/runtime/napcat-runtime-profile-inspector.service';
import { NapcatRuntimeProfileService } from './application/runtime/napcat-runtime-profile.service';
import { NapcatSessionBehaviorService } from './application/runtime/napcat-session-behavior.service';
import { NapcatLoginController } from './contract/napcat-login.controller';
import { NapcatRuntimeController } from './contract/napcat-runtime.controller';
import {
  NapcatWebuiGatewayAuditService,
  NapcatWebuiGatewayService,
} from './webui-gateway/application/napcat-webui-gateway.service';
import { NapcatWebuiGatewayController } from './webui-gateway/contract/napcat-webui-gateway.controller';
import { NapcatWebuiGatewayClient } from './webui-gateway/infrastructure/napcat-webui-gateway.client';
import { NapcatRuntimeProfileInspectionScriptService } from './infrastructure/integration/container/napcat-runtime-profile-inspection-script.service';
import { NapcatContainerService } from './infrastructure/integration/container/napcat-container.service';
import { NapcatDeviceIdentityService } from './infrastructure/integration/device/napcat-device-identity.service';
import { NAPCAT_RUNTIME_ENTITIES } from './infrastructure/persistence';
import { NapcatLoginStateStoreService } from './infrastructure/persistence/napcat-login-state-store.service';
import { NapcatBotProtocolAdapter } from './infrastructure/napcat-bot-protocol.adapter';

export const NAPCAT_ENTITIES = [...NAPCAT_RUNTIME_ENTITIES];

export const NAPCAT_CONTROLLERS = [
  NapcatLoginController,
  NapcatRuntimeController,
  NapcatWebuiGatewayController,
];

export const NAPCAT_PROVIDERS = [
  NapcatConfigWriterService,
  NapcatDeviceIdentityService,
  NapcatLoginStateStoreService,
  NapcatRuntimeProfileInspectorService,
  NapcatRuntimeProfileInspectionScriptService,
  NapcatRuntimeProfileService,
  NapcatSessionBehaviorService,
  NapcatWebuiGatewayAuditService,
  NapcatAccountRuntimeService,
  NapcatContainerService,
  NapcatWebuiGatewayClient,
  NapcatWebuiGatewayService,
  NapcatLoginService,
  NapcatWatchdogService,
  NapcatBotProtocolAdapter,
  {
    provide: BOT_ACCOUNT_NAPCAT_RUNTIME_PORT,
    useExisting: NapcatAccountRuntimeService,
  },
];

export const NAPCAT_EXPORTS = [
  NapcatDeviceIdentityService,
  NapcatLoginStateStoreService,
  NapcatSessionBehaviorService,
  BOT_ACCOUNT_NAPCAT_RUNTIME_PORT,
  NapcatLoginService,
];

@Module({
  imports: [
    ConfigModule,
    AdminAuthGuardModule,
    BotProtocolModule,
    forwardRef(() => BotAdapterCoreModule),
    TypeOrmModule.forFeature(NAPCAT_ENTITIES),
  ],
  controllers: NAPCAT_CONTROLLERS,
  providers: NAPCAT_PROVIDERS,
  exports: [TypeOrmModule, ...NAPCAT_EXPORTS],
})
export class NapcatModule {}
