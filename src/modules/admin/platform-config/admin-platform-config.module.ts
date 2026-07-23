import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthGuardModule } from '@/modules/admin/identity/auth/admin-auth-guard.module';
import { ComponentController } from '@/modules/admin/platform-config/component/component.controller';
import { Component } from '@/modules/admin/platform-config/component/component.entity';
import { ComponentService } from '@/modules/admin/platform-config/component/component.service';
import { DictController } from '@/modules/admin/platform-config/dict/dict.controller';
import { DictModule } from '@/modules/admin/platform-config/dict/dict.module';
import { AdminNoticeController } from '@/modules/admin/platform-config/notice/admin-notice.controller';
import { NoticeModule } from '@/modules/admin/platform-config/notice/notice.module';
import { NetworkAgentMqttService } from '@/modules/admin/platform-config/network-management/network-agent-mqtt.service';
import { NetworkAgentState } from '@/modules/admin/platform-config/network-management/network-agent-state.entity';
import { NetworkDdnsRecord } from '@/modules/admin/platform-config/network-management/network-ddns.entity';
import { NetworkDdnsService } from '@/modules/admin/platform-config/network-management/network-ddns.service';
import { NetworkDnsPodClient } from '@/modules/admin/platform-config/network-management/network-dnspod.client';
import { NetworkEndpointHistory } from '@/modules/admin/platform-config/network-management/network-endpoint-history.entity';
import { NetworkManagementController } from '@/modules/admin/platform-config/network-management/network-management.controller';
import { NetworkManagementEventStreamService } from '@/modules/admin/platform-config/network-management/network-management-event-stream.service';
import { NetworkPortForward } from '@/modules/admin/platform-config/network-management/network-management.entity';
import { NetworkManagementService } from '@/modules/admin/platform-config/network-management/network-management.service';
import { SystemLogController } from '@/modules/admin/platform-config/system-log/system-log.controller';
import { SystemLogService } from '@/modules/admin/platform-config/system-log/system-log.service';
import { AdminTimezoneController } from '@/modules/admin/platform-config/timezone/admin-timezone.controller';
import { AdminTimezoneService } from '@/modules/admin/platform-config/timezone/admin-timezone.service';
import { AdminUser } from '@/modules/admin/identity/user/admin-user.entity';
import { AssetModule } from '@/modules/asset/asset.module';
import { QqbotCoreModule } from '@/modules/qqbot/core/qqbot-core.module';
import { QqbotPluginPlatformModule } from '@/modules/qqbot/plugin-platform/plugin-platform.module';
import { RuntimeModule } from '@/runtime/runtime.module';
import { WordpressMirrorModule } from '@/modules/wordpress/wordpress-mirror.module';
import { EnvironmentDashboardService } from './environment-dashboard/application/environment-dashboard.service';
import { EnvironmentDashboardSelfCheckService } from './environment-dashboard/application/environment-dashboard-self-check.service';
import { EnvironmentEventMaterializer } from './environment-dashboard/application/environment-event.materializer';
import { EnvironmentEventStreamService } from './environment-dashboard/application/environment-event-stream.service';
import { EnvironmentDashboardController } from './environment-dashboard/presentation/environment-dashboard.controller';
import { CaddyReadonlyAdapter } from './environment-dashboard/infrastructure/adapters/caddy-readonly.adapter';
import { EnvironmentReadonlyHttpClient } from './environment-dashboard/infrastructure/adapters/environment-readonly-http.client';
import { JenkinsReadonlyAdapter } from './environment-dashboard/infrastructure/adapters/jenkins-readonly.adapter';
import { KubernetesReadonlyAdapter } from './environment-dashboard/infrastructure/adapters/kubernetes-readonly.adapter';
import { MihomoReadonlyAdapter } from './environment-dashboard/infrastructure/adapters/mihomo-readonly.adapter';
import { TencentCloudReadonlyAdapter } from './environment-dashboard/infrastructure/adapters/tencent-cloud-readonly.adapter';
import { WireguardReadonlyAdapter } from './environment-dashboard/infrastructure/adapters/wireguard-readonly.adapter';
import { LocalDevSignalCollector } from './environment-dashboard/infrastructure/collectors/local-dev-signal.collector';
import { NasProdSignalCollector } from './environment-dashboard/infrastructure/collectors/nas-prod-signal.collector';
import { EnvironmentDashboardCacheService } from './environment-dashboard/infrastructure/environment-dashboard-cache.service';
import { EnvironmentDashboardConfigService } from './environment-dashboard/infrastructure/environment-dashboard-config.service';
import { EnvironmentEventBusService } from './environment-dashboard/infrastructure/event/environment-event-bus.service';

export const ADMIN_PLATFORM_CONFIG_DIRECT_CONTROLLERS = [
  ComponentController,
  SystemLogController,
  AdminTimezoneController,
  EnvironmentDashboardController,
  NetworkManagementController,
];

export const ADMIN_PLATFORM_CONFIG_IMPORTED_CONTROLLERS = [
  DictController,
  AdminNoticeController,
];

export const ADMIN_PLATFORM_CONFIG_CONTROLLERS = [
  ...ADMIN_PLATFORM_CONFIG_DIRECT_CONTROLLERS,
  ...ADMIN_PLATFORM_CONFIG_IMPORTED_CONTROLLERS,
];

export const ADMIN_PLATFORM_CONFIG_PROVIDERS = [
  ComponentService,
  SystemLogService,
  AdminTimezoneService,
  EnvironmentDashboardService,
  EnvironmentDashboardSelfCheckService,
  EnvironmentDashboardCacheService,
  EnvironmentDashboardConfigService,
  LocalDevSignalCollector,
  NasProdSignalCollector,
  EnvironmentReadonlyHttpClient,
  JenkinsReadonlyAdapter,
  KubernetesReadonlyAdapter,
  TencentCloudReadonlyAdapter,
  CaddyReadonlyAdapter,
  WireguardReadonlyAdapter,
  MihomoReadonlyAdapter,
  EnvironmentEventBusService,
  EnvironmentEventMaterializer,
  EnvironmentEventStreamService,
  NetworkManagementService,
  NetworkManagementEventStreamService,
  NetworkDnsPodClient,
  NetworkDdnsService,
  NetworkAgentMqttService,
];

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Component,
      AdminUser,
      NetworkPortForward,
      NetworkAgentState,
      NetworkEndpointHistory,
      NetworkDdnsRecord,
    ]),
    AdminAuthGuardModule,
    DictModule,
    NoticeModule,
    AssetModule,
    RuntimeModule,
    QqbotCoreModule,
    QqbotPluginPlatformModule,
    WordpressMirrorModule,
  ],
  controllers: ADMIN_PLATFORM_CONFIG_DIRECT_CONTROLLERS,
  providers: ADMIN_PLATFORM_CONFIG_PROVIDERS,
})
export class AdminPlatformConfigModule {}
