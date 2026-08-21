import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LlmCodexChatService } from './application/llm-codex-chat.service';
import { MediaCodexAgentGatewayConfigService } from './config/media-codex-agent-gateway-config.service';
import { MediaCodexAgentApiClient } from './infrastructure/media-codex-agent-api.client';
import { LlmCodexChatController } from './presentation/llm-codex-chat.controller';
import { LlmCodexInternalGuard } from './presentation/llm-codex-internal.guard';

@Module({
  controllers: [LlmCodexChatController],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `.env.${process.env.NODE_ENV || 'development'}`,
    }),
  ],
  providers: [
    MediaCodexAgentGatewayConfigService,
    LlmCodexChatService,
    LlmCodexInternalGuard,
    {
      inject: [MediaCodexAgentGatewayConfigService],
      provide: MediaCodexAgentApiClient,
      useFactory: (config: MediaCodexAgentGatewayConfigService) =>
        new MediaCodexAgentApiClient(config),
    },
    ConfigService,
  ],
})
export class MediaCodexAgentGatewayModule {}
