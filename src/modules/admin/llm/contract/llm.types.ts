export type LlmProvider =
  | 'anthropic'
  | 'codex'
  | 'deepseek'
  | 'moonshot'
  | 'openai'
  | 'zhipu';

export type LlmConnectionStatus =
  | 'connected'
  | 'disabled'
  | 'error'
  | 'untested';

export type LlmMessageRole = 'assistant' | 'user';

export type LlmConversationScene = 'general' | 'media-governance';

export type LlmMessageStatus =
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'streaming';

export interface LlmProviderCatalogItem {
  defaultBaseUrl: string;
  label: string;
  protocol: 'anthropic' | 'codex-gateway' | 'openai-compatible';
  provider: LlmProvider;
  requiresApiKey: boolean;
}

export const LLM_PROVIDER_CATALOG: Record<LlmProvider, LlmProviderCatalogItem> =
  {
    anthropic: {
      defaultBaseUrl: 'https://api.anthropic.com/v1',
      label: 'Anthropic',
      protocol: 'anthropic',
      provider: 'anthropic',
      requiresApiKey: true,
    },
    codex: {
      defaultBaseUrl: 'http://127.0.0.1:48087/internal/llm-codex',
      label: '本地 Codex',
      protocol: 'codex-gateway',
      provider: 'codex',
      requiresApiKey: false,
    },
    deepseek: {
      defaultBaseUrl: 'https://api.deepseek.com',
      label: 'DeepSeek',
      protocol: 'openai-compatible',
      provider: 'deepseek',
      requiresApiKey: true,
    },
    moonshot: {
      defaultBaseUrl: 'https://api.moonshot.cn/v1',
      label: 'Moonshot / Kimi',
      protocol: 'openai-compatible',
      provider: 'moonshot',
      requiresApiKey: true,
    },
    openai: {
      defaultBaseUrl: 'https://api.openai.com/v1',
      label: 'OpenAI',
      protocol: 'openai-compatible',
      provider: 'openai',
      requiresApiKey: true,
    },
    zhipu: {
      defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      label: '智谱 GLM',
      protocol: 'openai-compatible',
      provider: 'zhipu',
      requiresApiKey: true,
    },
  };

export interface LlmAdapterConfig {
  apiKey: string;
  baseUrl: string;
  provider: LlmProvider;
}

export interface LlmModelCapabilityOption {
  id: string;
  label: string;
}

export interface LlmModelItem {
  defaultReasoningEffort: null | string;
  defaultServiceTier: null | string;
  id: string;
  label: string;
  reasoningEfforts: LlmModelCapabilityOption[];
  serviceTiers: LlmModelCapabilityOption[];
}

export interface LlmModelDiscoveryResult {
  fetchedAt: string;
  items: LlmModelItem[];
  provider: LlmProvider;
}

export interface LlmAdapterMessage {
  content: string;
  role: LlmMessageRole;
}

export interface LlmTokenUsage {
  completionTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  promptTokens?: number;
  totalTokens?: number;
}

export type LlmNormalizedStreamEvent =
  | {
      model: string;
      providerThreadId?: string;
      type: 'start';
    }
  | {
      content: string;
      type: 'reasoning-delta' | 'text-delta';
    }
  | {
      finishReason?: null | string;
      metadata?: Record<string, unknown>;
      model: string;
      providerThreadId?: string;
      type: 'done';
      usage?: LlmTokenUsage;
    };

export interface LlmStreamRequest {
  clientMessageId: string;
  config: LlmAdapterConfig;
  context?: {
    conversationTurnId: string;
    conversationId: string;
    scene: Exclude<LlmConversationScene, 'general'>;
    sceneRefId: string;
  };
  messages: LlmAdapterMessage[];
  model: string;
  providerThreadId?: null | string;
  reasoningEffort?: string;
  serviceTier?: string;
  signal: AbortSignal;
}
