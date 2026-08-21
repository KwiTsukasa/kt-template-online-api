export const LLM_CODEX_GATEWAY_CONTROLLER_PATH = 'internal/llm-codex';
export const LLM_CODEX_INTERNAL_HEADER = 'x-kt-llm-gateway-secret';
export const LLM_CODEX_PERMISSION_PROFILE = 'llm-codex';
export const LLM_CODEX_NETWORK_ACCESS = true;

export interface LlmCodexModelCapabilityOption {
  id: string;
  label: string;
}

export interface LlmCodexModelItem {
  defaultReasoningEffort: null | string;
  defaultServiceTier: null | string;
  id: string;
  label: string;
  reasoningEfforts: LlmCodexModelCapabilityOption[];
  serviceTiers: LlmCodexModelCapabilityOption[];
}

export interface LlmCodexModelsResponse {
  items: LlmCodexModelItem[];
}
