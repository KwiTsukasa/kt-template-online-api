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
import { NetworkAgentMqttService } from '@/modules/admin/platform-config/network-management/infrastructure/integration/network-agent-mqtt.service';
import { NetworkAgentState } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-agent-state.entity';
import { NetworkDdnsRecord } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-ddns.entity';
import { NetworkDdnsService } from '@/modules/admin/platform-config/network-management/application/network-ddns.service';
import { NetworkDnsPodClient } from '@/modules/admin/platform-config/network-management/infrastructure/integration/network-dnspod.client';
import { NetworkEndpointHistory } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-endpoint-history.entity';
import { NetworkManagementController } from '@/modules/admin/platform-config/network-management/presentation/network-management.controller';
import { NetworkManagementEventStreamService } from '@/modules/admin/platform-config/network-management/application/network-management-event-stream.service';
import { NetworkOpenRedirectController } from '@/modules/admin/platform-config/network-management/presentation/network-open-redirect.controller';
import { NetworkOpenRedirectService } from '@/modules/admin/platform-config/network-management/application/network-open-redirect.service';
import { NetworkPortForward } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-management.entity';
import { NetworkPortForwardGroup } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-port-forward-group.entity';
import { NetworkPortForwardGroupController } from '@/modules/admin/platform-config/network-management/presentation/network-port-forward-group.controller';
import { NetworkPortForwardGroupService } from '@/modules/admin/platform-config/network-management/application/network-port-forward-group.service';
import { NetworkManagementService } from '@/modules/admin/platform-config/network-management/application/network-management.service';
import { NetworkStunMessageSourceAdapter } from '@/modules/admin/platform-config/network-management/infrastructure/integration/network-stun-message-source.adapter';
import { NetworkTcpNatmapMessageSourceAdapter } from '@/modules/admin/platform-config/network-management/infrastructure/integration/network-tcp-natmap-message-source.adapter';
import { NetworkTcpReleasePolicyService } from '@/modules/admin/platform-config/network-management/application/network-tcp-release-policy.service';
import { SystemLogController } from '@/modules/admin/platform-config/system-log/system-log.controller';
import { SystemLogService } from '@/modules/admin/platform-config/system-log/system-log.service';
import { AdminTimezoneController } from '@/modules/admin/platform-config/timezone/admin-timezone.controller';
import { AdminTimezoneService } from '@/modules/admin/platform-config/timezone/admin-timezone.service';
import { AdminUser } from '@/modules/admin/identity/user/admin-user.entity';
import { AssetModule } from '@/modules/asset/asset.module';
import { MessageManagementModule } from '@/modules/message-management/message-management.module';
import { BotAdapterCoreModule } from '@/modules/bot-adapter/core/bot-adapter-core.module';
import { PluginPlatformModule } from '@/modules/plugin-platform/plugin-platform.module';
import { RuntimeModule } from '@/runtime/runtime.module';
import { EnvironmentDashboardService } from './environment-dashboard/application/environment-dashboard.service';
import { EnvironmentDashboardSelfCheckService } from './environment-dashboard/application/environment-dashboard-self-check.service';
import { EnvironmentEventMaterializer } from './environment-dashboard/application/environment-event.materializer';
import { EnvironmentEventStreamService } from './environment-dashboard/application/environment-event-stream.service';
import { EnvironmentDashboardController } from './environment-dashboard/presentation/environment-dashboard.controller';
import { CaddyReadonlyAdapter } from './environment-dashboard/infrastructure/adapters/caddy-readonly.adapter';
import { HomeAssistantReadonlyAdapter } from './environment-dashboard/infrastructure/adapters/home-assistant-readonly.adapter';
import { EnvironmentReadonlyHttpClient } from './environment-dashboard/infrastructure/adapters/environment-readonly-http.client';
import { JenkinsReadonlyAdapter } from './environment-dashboard/infrastructure/adapters/jenkins-readonly.adapter';
import { KubernetesReadonlyAdapter } from './environment-dashboard/infrastructure/adapters/kubernetes-readonly.adapter';
import { MihomoReadonlyAdapter } from './environment-dashboard/infrastructure/adapters/mihomo-readonly.adapter';
import { SunshineReadonlyAdapter } from './environment-dashboard/infrastructure/adapters/sunshine-readonly.adapter';
import { TencentCloudReadonlyAdapter } from './environment-dashboard/infrastructure/adapters/tencent-cloud-readonly.adapter';
import { WireguardReadonlyAdapter } from './environment-dashboard/infrastructure/adapters/wireguard-readonly.adapter';
import { LocalDevSignalCollector } from './environment-dashboard/infrastructure/collectors/local-dev-signal.collector';
import { NasProdSignalCollector } from './environment-dashboard/infrastructure/collectors/nas-prod-signal.collector';
import { EnvironmentDashboardCacheService } from './environment-dashboard/infrastructure/environment-dashboard-cache.service';
import { EnvironmentDashboardConfigService } from './environment-dashboard/infrastructure/environment-dashboard-config.service';
import { EnvironmentEventBusService } from './environment-dashboard/infrastructure/event/environment-event-bus.service';
import { MobileHomeService } from './mobile-home/application/mobile-home.service';
import { MobileHomeController } from './mobile-home/presentation/mobile-home.controller';

export const ADMIN_PLATFORM_CONFIG_DIRECT_CONTROLLERS = [
  ComponentController,
  SystemLogController,
  AdminTimezoneController,
  EnvironmentDashboardController,
  MobileHomeController,
  NetworkManagementController,
  NetworkPortForwardGroupController,
  NetworkOpenRedirectController,
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
  MobileHomeService,
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
  HomeAssistantReadonlyAdapter,
  WireguardReadonlyAdapter,
  MihomoReadonlyAdapter,
  SunshineReadonlyAdapter,
  EnvironmentEventBusService,
  EnvironmentEventMaterializer,
  EnvironmentEventStreamService,
  NetworkManagementService,
  NetworkPortForwardGroupService,
  NetworkManagementEventStreamService,
  NetworkDnsPodClient,
  NetworkDdnsService,
  NetworkStunMessageSourceAdapter,
  NetworkTcpNatmapMessageSourceAdapter,
  NetworkTcpReleasePolicyService,
  NetworkAgentMqttService,
  NetworkOpenRedirectService,
];

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Component,
      AdminUser,
      NetworkPortForward,
      NetworkPortForwardGroup,
      NetworkAgentState,
      NetworkEndpointHistory,
      NetworkDdnsRecord,
    ]),
    AdminAuthGuardModule,
    DictModule,
    NoticeModule,
    AssetModule,
    MessageManagementModule,
    RuntimeModule,
    BotAdapterCoreModule,
    PluginPlatformModule,
  ],
  controllers: ADMIN_PLATFORM_CONFIG_DIRECT_CONTROLLERS,
  providers: ADMIN_PLATFORM_CONFIG_PROVIDERS,
})
export class AdminPlatformConfigModule {}
