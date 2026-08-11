import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MediaCodexAgentGatewayService } from './application/media-codex-agent-gateway.service';
import { MediaCodexAgentGatewayConfigService } from './config/media-codex-agent-gateway-config.service';
import {
  CodexAppServerClient,
  UnixWebSocketRpcTransport,
} from './infrastructure/codex-app-server.client';
import { MediaCodexAgentApiClient } from './infrastructure/media-codex-agent-api.client';
import { MediaCodexAgentSessionStore } from './infrastructure/media-codex-agent-session.store';
import { MediaCodexAgentController } from './presentation/media-codex-agent.controller';
import { MediaCodexAgentInternalGuard } from './presentation/media-codex-agent-internal.guard';

@Module({
  controllers: [MediaCodexAgentController],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `.env.${process.env.NODE_ENV || 'development'}`,
    }),
  ],
  providers: [
    MediaCodexAgentGatewayConfigService,
    MediaCodexAgentInternalGuard,
    {
      inject: [MediaCodexAgentGatewayConfigService],
      provide: MediaCodexAgentSessionStore,
      useFactory: (config: MediaCodexAgentGatewayConfigService) =>
        new MediaCodexAgentSessionStore(config.stateRoot()),
    },
    {
      inject: [MediaCodexAgentGatewayConfigService],
      provide: UnixWebSocketRpcTransport,
      useFactory: (config: MediaCodexAgentGatewayConfigService) =>
        new UnixWebSocketRpcTransport(
          config.appServerSocketPath(),
          config.timeoutMs(),
        ),
    },
    {
      inject: [UnixWebSocketRpcTransport],
      provide: CodexAppServerClient,
      useFactory: (transport: UnixWebSocketRpcTransport) =>
        new CodexAppServerClient(transport),
    },
    {
      inject: [MediaCodexAgentGatewayConfigService],
      provide: MediaCodexAgentApiClient,
      useFactory: (config: MediaCodexAgentGatewayConfigService) =>
        new MediaCodexAgentApiClient(config),
    },
    {
      inject: [
        MediaCodexAgentSessionStore,
        CodexAppServerClient,
        MediaCodexAgentApiClient,
        MediaCodexAgentGatewayConfigService,
      ],
      provide: MediaCodexAgentGatewayService,
      useFactory: (
        store: MediaCodexAgentSessionStore,
        appServer: CodexAppServerClient,
        apiClient: MediaCodexAgentApiClient,
        config: MediaCodexAgentGatewayConfigService,
      ) =>
        new MediaCodexAgentGatewayService(
          store,
          appServer,
          apiClient,
          apiClient,
          {
            cleanCwd: config.cleanCwd(),
            evidenceRoot: config.evidenceRoot(),
          },
        ),
    },
    ConfigService,
  ],
})
export class MediaCodexAgentGatewayModule {}
