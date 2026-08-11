import type {
  MediaCodexAgentEventSink,
  MediaCodexAgentToolClient,
} from '../application/media-codex-agent-gateway.service';
import type {
  MediaCodexAgentSemanticEvent,
  MediaCodexAgentToolCall,
} from '../domain/media-codex-agent.contract';
import { MediaCodexAgentGatewayConfigService } from '../config/media-codex-agent-gateway-config.service';

const MAX_RESPONSE_BYTES = 64 * 1024;

export class MediaCodexAgentApiClient
  implements MediaCodexAgentToolClient, MediaCodexAgentEventSink
{
  constructor(private readonly config: MediaCodexAgentGatewayConfigService) {}

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

  call(call: MediaCodexAgentToolCall) {
    return this.request(
      '/internal/media-governance/agent/tool-calls',
      'POST',
      call,
    );
  }

  async publish(event: MediaCodexAgentSemanticEvent) {
    await this.request(
      '/internal/media-governance/agent/events',
      'POST',
      event,
    );
  }

  private async request(path: string, method: 'GET' | 'POST', body?: unknown) {
    const response = await fetch(`${this.config.apiBaseUrl()}${path}`, {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        'x-kt-media-agent-secret': this.config.internalSecret(),
      },
      method,
      signal: AbortSignal.timeout(this.config.timeoutMs()),
    });
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
