import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  MediaCodexAgentSafeSession,
  MediaCodexAgentTurnRequest,
} from '@/apps/media-codex-agent-gateway/domain/media-codex-agent.contract';
import {
  MEDIA_CODEX_AGENT_POLICY_VERSION,
  canonicalJson,
  parseMediaCodexAgentResult,
} from '@/apps/media-codex-agent-gateway/domain/media-codex-agent.contract';

export const MEDIA_GOVERNANCE_CODEX_AGENT_GATEWAY = Symbol(
  'MEDIA_GOVERNANCE_CODEX_AGENT_GATEWAY',
);

export interface MediaGovernanceCodexAgentGateway {
  enabled(): boolean;
  session(
    taskId: string,
    query?: { afterSequence?: number; limit?: number },
  ): Promise<MediaCodexAgentSafeSession | null>;
  startTurn(
    request: MediaCodexAgentTurnRequest,
  ): Promise<MediaCodexAgentSafeSession>;
}

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

@Injectable()
export class MediaGovernanceCodexAgentGatewayClient implements MediaGovernanceCodexAgentGateway {
  constructor(private readonly config: ConfigService) {}

  /** 检查网关地址和内部密钥是否形成可用配置。 */
  enabled() {
    try {
      return Boolean(this.baseUrl() && this.secret(false));
    } catch {
      return false;
    }
  }

  /** 向 Codex Agent 网关提交一轮请求并校验返回会话身份。 */
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

  /** 拉取指定任务的安全会话投影及有界对话增量。 */
  async session(
    taskId: string,
    query: { afterSequence?: number; limit?: number } = {},
  ) {
    const baseUrl = this.baseUrl();
    if (!baseUrl) throw new Error('media-codex-agent-gateway-not-configured');
    const response = await fetch(
      `${baseUrl}/internal/media-codex-agent/tasks/${encodeURIComponent(taskId)}/session?afterSequence=${encodeURIComponent(String(query.afterSequence ?? 0))}&limit=${encodeURIComponent(String(query.limit ?? 200))}`,
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

  /** 规范化并校验 Codex Agent 网关基础地址。 */
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

  /** 解析网关会话响应，并对所有身份、状态和摘要字段执行失败关闭校验。 */
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
    let rawResult: null | Record<string, unknown> = null;
    if (
      session.result &&
      typeof session.result === 'object' &&
      !Array.isArray(session.result)
    ) {
      rawResult = session.result as Record<string, unknown>;
    }
    let result: ReturnType<typeof parseMediaCodexAgentResult> = null;
    if (rawResult) {
      result = parseMediaCodexAgentResult({
        candidateSummaries: rawResult.candidateSummaries,
        nextActionLabel: rawResult.nextActionLabel,
        planSha256: rawResult.planSha256,
        status: rawResult.status,
        summary: rawResult.summary,
      });
    }
    const sha256 = /^[a-f0-9]{64}$/;
    const safeId = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;
    const messages = this.parseMessages(session.messages, safeId);
    if (
      typeof session.taskId !== 'string' ||
      !safeId.test(session.taskId) ||
      typeof session.threadId !== 'string' ||
      !safeId.test(session.threadId)
    ) {
      throw new Error('media-codex-agent-gateway-response-invalid');
    }
    if (
      typeof session.policySha256 !== 'string' ||
      !sha256.test(session.policySha256) ||
      typeof session.capsuleSha256 !== 'string' ||
      !sha256.test(session.capsuleSha256)
    ) {
      throw new Error('media-codex-agent-gateway-response-invalid');
    }
    if (
      typeof session.checkpointSha256 !== 'string' ||
      !sha256.test(session.checkpointSha256)
    ) {
      throw new Error('media-codex-agent-gateway-response-invalid');
    }
    if (session.lastEventSequence !== undefined) {
      if (
        !Number.isSafeInteger(session.lastEventSequence) ||
        Number(session.lastEventSequence) < 0
      ) {
        throw new Error('media-codex-agent-gateway-response-invalid');
      }
    }
    if (session.conversationRevision !== undefined) {
      if (
        !Number.isSafeInteger(session.conversationRevision) ||
        Number(session.conversationRevision) < 0
      ) {
        throw new Error('media-codex-agent-gateway-response-invalid');
      }
    }
    if (
      (session.hasMoreMessages !== undefined &&
        typeof session.hasMoreMessages !== 'boolean') ||
      (session.historyComplete !== undefined &&
        typeof session.historyComplete !== 'boolean')
    ) {
      throw new Error('media-codex-agent-gateway-response-invalid');
    }
    if (
      session.lastClientMessageId !== undefined &&
      session.lastClientMessageId !== null
    ) {
      if (
        typeof session.lastClientMessageId !== 'string' ||
        !safeId.test(session.lastClientMessageId)
      ) {
        throw new Error('media-codex-agent-gateway-response-invalid');
      }
    }
    if (
      !Number.isSafeInteger(session.taskRevision) ||
      Number(session.taskRevision) < 1 ||
      session.policyVersion !== MEDIA_CODEX_AGENT_POLICY_VERSION
    ) {
      throw new Error('media-codex-agent-gateway-response-invalid');
    }
    if (
      typeof session.lastHeartbeatAt !== 'string' ||
      !Number.isFinite(Date.parse(session.lastHeartbeatAt)) ||
      typeof session.replayed !== 'boolean' ||
      !['active', 'blocked', 'closed'].includes(String(session.status))
    ) {
      throw new Error('media-codex-agent-gateway-response-invalid');
    }
    if (session.terminalKind !== undefined && session.terminalKind !== null) {
      if (
        !['completed', 'failed', 'interrupted'].includes(
          String(session.terminalKind),
        )
      ) {
        throw new Error('media-codex-agent-gateway-response-invalid');
      }
    }
    if (session.currentUnitId !== null) {
      if (
        typeof session.currentUnitId !== 'string' ||
        !safeId.test(session.currentUnitId)
      ) {
        throw new Error('media-codex-agent-gateway-response-invalid');
      }
    }
    if (session.turnId !== null) {
      if (typeof session.turnId !== 'string' || !safeId.test(session.turnId)) {
        throw new Error('media-codex-agent-gateway-response-invalid');
      }
    }
    if (session.result !== undefined && session.result !== null) {
      if (!result || canonicalJson(result) !== canonicalJson(session.result)) {
        throw new Error('media-codex-agent-gateway-response-invalid');
      }
    }
    if (!result && rawResult) {
      throw new Error('media-codex-agent-gateway-response-invalid');
    }
    return {
      capsuleSha256: session.capsuleSha256,
      checkpointSha256: session.checkpointSha256,
      conversationRevision: Number(session.conversationRevision ?? 0),
      currentUnitId: session.currentUnitId,
      hasMoreMessages: Boolean(session.hasMoreMessages),
      historyComplete: session.historyComplete !== false,
      lastClientMessageId: session.lastClientMessageId ?? null,
      lastEventSequence: Number(session.lastEventSequence ?? 0),
      lastHeartbeatAt: session.lastHeartbeatAt,
      messages,
      policySha256: session.policySha256,
      policyVersion: session.policyVersion,
      replayed: session.replayed,
      result,
      status: session.status,
      taskId: session.taskId,
      taskRevision: session.taskRevision,
      terminalKind: session.terminalKind ?? null,
      threadId: session.threadId,
      turnId: session.turnId,
    } as MediaCodexAgentSafeSession;
  }

  /** 解析并验证按序返回的对话消息，拒绝越界内容和非法结果投影。 */
  private parseMessages(value: unknown, safeId: RegExp) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 200) {
      throw new Error('media-codex-agent-gateway-response-invalid');
    }
    let previousSequence = 0;
    return value.map((candidate) => {
      if (
        !candidate ||
        typeof candidate !== 'object' ||
        Array.isArray(candidate)
      ) {
        throw new Error('media-codex-agent-gateway-response-invalid');
      }
      const message = candidate as Record<string, unknown>;
      let rawResult: null | Record<string, unknown> = null;
      if (
        message.result &&
        typeof message.result === 'object' &&
        !Array.isArray(message.result)
      ) {
        rawResult = message.result as Record<string, unknown>;
      }
      let result: ReturnType<typeof parseMediaCodexAgentResult> = null;
      if (rawResult) {
        result = parseMediaCodexAgentResult({
          candidateSummaries: rawResult.candidateSummaries,
          nextActionLabel: rawResult.nextActionLabel,
          planSha256: rawResult.planSha256,
          status: rawResult.status,
          summary: rawResult.summary,
        });
      }
      if (
        typeof message.content !== 'string' ||
        !message.content.trim() ||
        message.content.length > 8_000
      ) {
        throw new Error('media-codex-agent-gateway-response-invalid');
      }
      if (
        typeof message.messageId !== 'string' ||
        !safeId.test(message.messageId) ||
        typeof message.turnId !== 'string' ||
        !safeId.test(message.turnId)
      ) {
        throw new Error('media-codex-agent-gateway-response-invalid');
      }
      if (
        !Number.isSafeInteger(message.sequence) ||
        Number(message.sequence) <= previousSequence ||
        !['assistant', 'user'].includes(String(message.role))
      ) {
        throw new Error('media-codex-agent-gateway-response-invalid');
      }
      if (
        !['commentary', 'final_answer', 'user'].includes(
          String(message.phase),
        ) ||
        !['completed', 'streaming'].includes(String(message.status))
      ) {
        throw new Error('media-codex-agent-gateway-response-invalid');
      }
      if (
        typeof message.observedAt !== 'string' ||
        !Number.isFinite(Date.parse(message.observedAt))
      ) {
        throw new Error('media-codex-agent-gateway-response-invalid');
      }
      if (message.result !== null && message.result !== undefined && !result) {
        throw new Error('media-codex-agent-gateway-response-invalid');
      }
      previousSequence = Number(message.sequence);
      return {
        content: message.content,
        messageId: message.messageId,
        observedAt: message.observedAt,
        phase: message.phase,
        result,
        role: message.role,
        sequence: Number(message.sequence),
        status: message.status,
        turnId: message.turnId,
      };
    });
  }

  /** 读取并校验内部共享密钥，可选模式下以空值表示未配置。 */
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

  /** 将网关超时配置限制在允许区间，非法配置回退为二十秒。 */
  private timeoutMs() {
    const value = Number(
      this.config.get<string>('MEDIA_CODEX_AGENT_GATEWAY_TIMEOUT_MS') ?? 20_000,
    );
    if (Number.isSafeInteger(value) && value >= 1_000 && value <= 120_000) {
      return value;
    }
    return 20_000;
  }
}
