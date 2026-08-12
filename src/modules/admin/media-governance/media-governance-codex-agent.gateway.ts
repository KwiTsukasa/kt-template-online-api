import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  MediaCodexAgentSafeSession,
  MediaCodexAgentTurnRequest,
} from '@/apps/media-codex-agent-gateway/domain/media-codex-agent.contract';
import { MEDIA_CODEX_AGENT_POLICY_VERSION } from '@/apps/media-codex-agent-gateway/domain/media-codex-agent.contract';

export const MEDIA_GOVERNANCE_CODEX_AGENT_GATEWAY = Symbol(
  'MEDIA_GOVERNANCE_CODEX_AGENT_GATEWAY',
);

export interface MediaGovernanceCodexAgentGateway {
  enabled(): boolean;
  session(taskId: string): Promise<MediaCodexAgentSafeSession | null>;
  startTurn(
    request: MediaCodexAgentTurnRequest,
  ): Promise<MediaCodexAgentSafeSession>;
}

const MAX_RESPONSE_BYTES = 64 * 1024;

@Injectable()
export class MediaGovernanceCodexAgentGatewayClient implements MediaGovernanceCodexAgentGateway {
  constructor(private readonly config: ConfigService) {}

  enabled() {
    try {
      return Boolean(this.baseUrl() && this.secret(false));
    } catch {
      return false;
    }
  }

  async startTurn(request: MediaCodexAgentTurnRequest) {
    const baseUrl = this.baseUrl();
    if (!baseUrl) throw new Error('media-codex-agent-gateway-not-configured');
    const response = await fetch(
      `${baseUrl}/internal/media-codex-agent/tasks/${encodeURIComponent(request.taskId)}/turns`,
      {
        body: JSON.stringify(request),
        headers: {
          'content-type': 'application/json',
          'x-kt-media-agent-secret': this.secret(true),
        },
        method: 'POST',
        signal: AbortSignal.timeout(this.timeoutMs()),
      },
    );
    const text = await response.text();
    if (!response.ok || Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
      throw new Error('media-codex-agent-gateway-request-failed');
    }
    const value = this.parseSafeSession(text);
    if (
      value.taskId !== request.taskId ||
      value.taskRevision !== request.taskRevision
    ) {
      throw new Error('media-codex-agent-gateway-identity-mismatch');
    }
    return value;
  }

  async session(taskId: string) {
    const baseUrl = this.baseUrl();
    if (!baseUrl) throw new Error('media-codex-agent-gateway-not-configured');
    const response = await fetch(
      `${baseUrl}/internal/media-codex-agent/tasks/${encodeURIComponent(taskId)}/session`,
      {
        headers: {
          'x-kt-media-agent-secret': this.secret(true),
        },
        method: 'GET',
        signal: AbortSignal.timeout(this.timeoutMs()),
      },
    );
    if (response.status === 404) return null;
    const text = await response.text();
    if (!response.ok || Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
      throw new Error('media-codex-agent-gateway-request-failed');
    }
    const value = this.parseSafeSession(text);
    if (value.taskId !== taskId) {
      throw new Error('media-codex-agent-gateway-identity-mismatch');
    }
    return value;
  }

  private baseUrl() {
    const value = String(
      this.config.get<string>('MEDIA_CODEX_AGENT_GATEWAY_BASE_URL') ?? '',
    ).trim();
    if (!value) return '';
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      throw new Error('media-codex-agent-gateway-url-invalid');
    }
    return url.toString().replace(/\/$/, '');
  }

  private parseSafeSession(text: string): MediaCodexAgentSafeSession {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error('media-codex-agent-gateway-response-invalid');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('media-codex-agent-gateway-response-invalid');
    }
    const session = value as Record<string, unknown>;
    const sha256 = /^[a-f0-9]{64}$/;
    const safeId = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;
    if (
      typeof session.taskId !== 'string' ||
      !safeId.test(session.taskId) ||
      typeof session.threadId !== 'string' ||
      !safeId.test(session.threadId) ||
      typeof session.policySha256 !== 'string' ||
      !sha256.test(session.policySha256) ||
      typeof session.capsuleSha256 !== 'string' ||
      !sha256.test(session.capsuleSha256) ||
      typeof session.checkpointSha256 !== 'string' ||
      !sha256.test(session.checkpointSha256) ||
      (session.lastEventSequence !== undefined &&
        (!Number.isSafeInteger(session.lastEventSequence) ||
          Number(session.lastEventSequence) < 0)) ||
      !Number.isSafeInteger(session.taskRevision) ||
      Number(session.taskRevision) < 1 ||
      session.policyVersion !== MEDIA_CODEX_AGENT_POLICY_VERSION ||
      typeof session.lastHeartbeatAt !== 'string' ||
      !Number.isFinite(Date.parse(session.lastHeartbeatAt)) ||
      typeof session.replayed !== 'boolean' ||
      !['active', 'blocked', 'closed'].includes(String(session.status)) ||
      (session.terminalKind !== undefined &&
        session.terminalKind !== null &&
        !['completed', 'failed', 'interrupted'].includes(
          String(session.terminalKind),
        )) ||
      (session.currentUnitId !== null &&
        (typeof session.currentUnitId !== 'string' ||
          !safeId.test(session.currentUnitId))) ||
      (session.turnId !== null &&
        (typeof session.turnId !== 'string' || !safeId.test(session.turnId)))
    ) {
      throw new Error('media-codex-agent-gateway-response-invalid');
    }
    return {
      capsuleSha256: session.capsuleSha256,
      checkpointSha256: session.checkpointSha256,
      currentUnitId: session.currentUnitId,
      lastEventSequence: Number(session.lastEventSequence ?? 0),
      lastHeartbeatAt: session.lastHeartbeatAt,
      policySha256: session.policySha256,
      policyVersion: session.policyVersion,
      replayed: session.replayed,
      status: session.status,
      taskId: session.taskId,
      taskRevision: session.taskRevision,
      terminalKind: session.terminalKind ?? null,
      threadId: session.threadId,
      turnId: session.turnId,
    } as MediaCodexAgentSafeSession;
  }

  private secret(required: boolean) {
    const value = String(
      this.config.get<string>('MEDIA_CODEX_AGENT_INTERNAL_SECRET') ?? '',
    ).trim();
    if (value.length < 32 || value.length > 512) {
      if (!required) return '';
      throw new Error('media-codex-agent-internal-secret-invalid');
    }
    return value;
  }

  private timeoutMs() {
    const value = Number(
      this.config.get<string>('MEDIA_CODEX_AGENT_GATEWAY_TIMEOUT_MS') ?? 20_000,
    );
    return Number.isSafeInteger(value) && value >= 1_000 && value <= 120_000
      ? value
      : 20_000;
  }
}
