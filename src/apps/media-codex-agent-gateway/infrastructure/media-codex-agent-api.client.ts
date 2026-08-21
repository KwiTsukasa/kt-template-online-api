import type {
  MediaCodexAgentToolCall,
  MediaGovernanceLlmConversationContextRequest,
  MediaGovernanceLlmConversationContextResponse,
  MediaGovernanceLlmConversationResultEvent,
  MediaGovernanceLlmProviderThreadBindRequest,
} from '../domain/media-codex-agent.contract';
import { MediaCodexAgentGatewayConfigService } from '../config/media-codex-agent-gateway-config.service';
import { LLM_CODEX_INTERNAL_HEADER } from '../domain/llm-codex-runtime.contract';

const MAX_RESPONSE_BYTES = 64 * 1024;

export class MediaCodexAgentApiClient {
  constructor(private readonly config: MediaCodexAgentGatewayConfigService) {}

  /**
   * 根据内部健康响应确认媒体治理 API 已就绪且仍使用数据库持久化。
   * @returns 包含 `persistenceMode`、`status` 字段的根据内部健康响应确认媒体治理 API 已就绪且仍使用数据库持久化。
   * @throws 当 `!value || typeof value !== 'object' || Array.isArray(value) || (value a…` 成立时拒绝当前输入并抛出 `Error`。
   */
  async health() {
    const value = await this.request(
      '/internal/media-governance/agent/health',
      'GET',
    );
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      (value as Record<string, unknown>).status !== 'ready' ||
      (value as Record<string, unknown>).persistenceMode !== 'database'
    ) {
      throw new Error('media-codex-agent-api-health-invalid');
    }
    return {
      persistenceMode: 'database' as const,
      status: 'ready' as const,
    };
  }

  /**
   * 将经过网关边界校验的类型化工具调用转发给内部 API。
   * @param call - 决定将经过网关边界校验的类型化工具调用转发给内部 API内容、边界或目标的 `call` 值。
   * @returns 将经过网关边界校验的类型化工具调用转发给内部 API。
   */
  call(call: MediaCodexAgentToolCall) {
    return this.request(
      '/internal/media-governance/agent/tool-calls',
      'POST',
      call,
    );
  }

  /**
   * 从 API 读取已绑定 LLM 对话的当前媒体任务边界。
   * @param input - 对话、任务、模型和本轮用户消息。
   * @returns App Server 媒体治理回合请求。
   */
  async conversationContext(
    input: MediaGovernanceLlmConversationContextRequest,
  ): Promise<MediaGovernanceLlmConversationContextResponse> {
    return (await this.request(
      '/internal/media-governance/agent/llm-conversations/context',
      'POST',
      input,
    )) as MediaGovernanceLlmConversationContextResponse;
  }

  /**
   * 把 LLM 对话最终结构化结果回写到绑定的媒体任务。
   * @param event - 对话、任务和严格结果。
   */
  async publishConversationResult(
    event: MediaGovernanceLlmConversationResultEvent,
  ) {
    await this.request(
      '/internal/media-governance/agent/llm-conversations/result',
      'POST',
      event,
    );
  }

  /**
   * 在 App Server turn 启动前通过 API 原子确认 provider thread，避免依赖 SSE start 消费时序。
   * @param input - 对话、任务、旧线程比较值与实际 App Server 线程。
   * @returns API 返回的权威对话身份。
   */
  bindProviderThread(input: MediaGovernanceLlmProviderThreadBindRequest) {
    return this.request(
      '/internal/media-governance/agent/llm-conversations/provider-thread',
      'POST',
      input,
    );
  }

  /**
   * 使用内部密钥发起有界请求，并限制响应体大小及 JSON 格式。
   * @param path - 必须保持在受控根目录内的路径。
   * @param method - 决定`request` 对应结果内容、边界或目标的 `method` 值。
   * @param body - 用于`request` 对应结果的结构化输入；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns `request` 对应；无法解析或未命中时为 `null`。
   * @throws 当 `!response.ok || Buffer.byteLength(text) > MAX_RESPONSE_BYTES` 成立时拒绝当前输入并抛出 `Error`；当 `JSON.parse` 调用失败时拒绝当前输入并抛出 `Error`。
   */
  private async request(path: string, method: 'GET' | 'POST', body?: unknown) {
    const headers: Record<string, string> = {
      [LLM_CODEX_INTERNAL_HEADER]: this.config.internalSecret(),
    };
    const request: RequestInit = {
      headers,
      method,
      signal: AbortSignal.timeout(this.config.timeoutMs()),
    };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      request.body = JSON.stringify(body);
    }
    const response = await fetch(`${this.config.apiBaseUrl()}${path}`, request);
    const text = await response.text();
    if (!response.ok || Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
      throw new Error('media-codex-agent-api-request-failed');
    }
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error('media-codex-agent-api-response-invalid');
    }
  }
}
