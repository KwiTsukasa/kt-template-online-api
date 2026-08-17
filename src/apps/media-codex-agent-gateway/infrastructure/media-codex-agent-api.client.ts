import type {
  MediaCodexAgentEventSink,
  MediaCodexAgentToolClient,
} from '../application/media-codex-agent-gateway.service';
import type {
  MediaCodexAgentConversationEvent,
  MediaCodexAgentSemanticEvent,
  MediaCodexAgentToolCall,
} from '../domain/media-codex-agent.contract';
import { MediaCodexAgentGatewayConfigService } from '../config/media-codex-agent-gateway-config.service';

const MAX_RESPONSE_BYTES = 64 * 1024;

export class MediaCodexAgentApiClient
  implements MediaCodexAgentToolClient, MediaCodexAgentEventSink
{
  constructor(private readonly config: MediaCodexAgentGatewayConfigService) {}

  /** 校验内部媒体治理 API 已就绪且仍使用数据库持久化。 */
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

  /** 将经过网关边界校验的类型化工具调用转发给内部 API。 */
  call(call: MediaCodexAgentToolCall) {
    return this.request(
      '/internal/media-governance/agent/tool-calls',
      'POST',
      call,
    );
  }

  /** 发布媒体 Agent 语义状态事件。 */
  async publish(event: MediaCodexAgentSemanticEvent) {
    await this.request(
      '/internal/media-governance/agent/events',
      'POST',
      event,
    );
  }

  /** 发布媒体 Agent 对话增量或完成事件。 */
  async publishConversation(event: MediaCodexAgentConversationEvent) {
    await this.request(
      '/internal/media-governance/agent/conversation-events',
      'POST',
      event,
    );
  }

  /** 使用内部密钥发起有界请求，并限制响应体大小及 JSON 格式。 */
  private async request(path: string, method: 'GET' | 'POST', body?: unknown) {
    const headers: Record<string, string> = {
      'x-kt-media-agent-secret': this.config.internalSecret(),
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
