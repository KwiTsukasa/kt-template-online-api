import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthGuardModule } from '@/modules/admin/identity/auth/admin-auth-guard.module';
import { LlmConfigService } from './application/llm-config.service';
import { LlmConversationService } from './application/llm-conversation.service';
import { AnthropicAdapter } from './infrastructure/integration/anthropic.adapter';
import { CodexGatewayAdapter } from './infrastructure/integration/codex-gateway.adapter';
import {
  LLM_PROVIDER_ADAPTERS,
  LlmProviderAdapterRegistry,
} from './infrastructure/integration/llm-provider.adapter';
import { OpenAiCompatibleAdapter } from './infrastructure/integration/openai-compatible.adapter';
import {
  AdminLlmConfigEntity,
  AdminLlmConversationEntity,
  AdminLlmMessageEntity,
} from './infrastructure/persistence/llm.entities';
import { LlmController } from './presentation/llm.controller';

@Module({
  controllers: [LlmController],
  exports: [LlmConfigService, LlmConversationService],
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      AdminLlmConfigEntity,
      AdminLlmConversationEntity,
      AdminLlmMessageEntity,
    ]),
    AdminAuthGuardModule,
  ],
  providers: [
    LlmConfigService,
    LlmConversationService,
    OpenAiCompatibleAdapter,
    AnthropicAdapter,
    CodexGatewayAdapter,
    {
      inject: [OpenAiCompatibleAdapter, AnthropicAdapter, CodexGatewayAdapter],
      provide: LLM_PROVIDER_ADAPTERS,
      useFactory: (
        openAiCompatible: OpenAiCompatibleAdapter,
        anthropic: AnthropicAdapter,
        codex: CodexGatewayAdapter,
      ) => [openAiCompatible, anthropic, codex],
    },
    LlmProviderAdapterRegistry,
  ],
})
export class AdminLlmModule {}
