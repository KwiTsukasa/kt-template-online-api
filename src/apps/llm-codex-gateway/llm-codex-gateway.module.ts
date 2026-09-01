import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LlmCodexChatService } from './application/llm-codex-chat.service';
import { LlmCodexGatewayConfigService } from './config/llm-codex-gateway-config.service';
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
    LlmCodexGatewayConfigService,
    LlmCodexChatService,
    LlmCodexInternalGuard,
    ConfigService,
  ],
})
export class LlmCodexGatewayModule {}
