import { randomUUID } from 'node:crypto';
import {
  MEDIA_CODEX_AGENT_SCHEMA_VERSION,
  type MediaCodexAgentSemanticEvent,
  type MediaCodexAgentToolCall,
  type MediaCodexAgentTurnRequest,
} from '../domain/media-codex-agent.contract';
import {
  buildMediaCodexAgentCapsule,
  buildMediaCodexAgentPolicy,
  buildMediaCodexAgentTurnPrompt,
  prepareMediaCodexAgentDirectories,
  validateMediaCodexAgentToolCall,
  type MediaCodexAgentPolicyPaths,
} from '../domain/media-codex-agent.policy';
import {
  type CodexAppServerAdapter,
  type CodexAppServerNotification,
  type CodexAppServerToolRequest,
} from '../infrastructure/codex-app-server.client';
import {
  MediaCodexAgentSessionStore,
  type MediaCodexAgentSessionRecord,
} from '../infrastructure/media-codex-agent-session.store';

export interface MediaCodexAgentToolClient {
  call(call: MediaCodexAgentToolCall): Promise<unknown>;
}

export interface MediaCodexAgentEventSink {
  health(): Promise<unknown>;
  publish(event: MediaCodexAgentSemanticEvent): Promise<void>;
}

export class MediaCodexAgentGatewayService {
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly store: MediaCodexAgentSessionStore,
    private readonly appServer: CodexAppServerAdapter,
    private readonly toolClient: MediaCodexAgentToolClient,
    private readonly eventSink: MediaCodexAgentEventSink,
    private readonly policyPaths: MediaCodexAgentPolicyPaths = {},
  ) {
    this.appServer.onToolCall((request) => this.handleToolCall(request));
    this.appServer.onNotification((notification) =>
      this.handleNotification(notification),
    );
  }

  startTurn(request: MediaCodexAgentTurnRequest) {
    return this.withTaskLock(request.taskId, () =>
      this.startTurnLocked(request),
    );
  }

  async health() {
    await Promise.all([this.appServer.initialize(), this.eventSink.health()]);
    return {
      apiCallbackReady: true as const,
      appServerReady: true as const,
    };
  }

  session(taskId: string) {
    const record = this.store.load(taskId);
    return record ? this.store.project(record, false) : null;
  }

  private async startTurnLocked(request: MediaCodexAgentTurnRequest) {
    await this.eventSink.health();
    const policy = buildMediaCodexAgentPolicy(request.taskId, this.policyPaths);
    const capsule = buildMediaCodexAgentCapsule(request, policy);
    prepareMediaCodexAgentDirectories(policy);
    const existing = this.store.load(request.taskId);
    if (existing) {
      if (
        existing.capsule.policySha256 !== policy.policySha256 ||
        existing.capsule.policyVersion !== policy.policyVersion
      ) {
        throw new Error('agent-policy-version-changed');
      }
      if (request.taskRevision < existing.taskRevision) {
        throw new Error('agent-task-revision-stale');
      }
      if (
        existing.currentReplayKey === request.replayKey ||
        existing.consumedReplayKeys.includes(request.replayKey)
      ) {
        return this.store.project(existing, true);
      }
      if (existing.status === 'active') {
        throw new Error('agent-session-active');
      }
    }

    const thread = existing
      ? await this.appServer.resumeThread(existing.threadId, policy)
      : await this.appServer.startThread(policy);
    if (
      existing?.turnId &&
      thread.lastTurn &&
      thread.lastTurn.id === existing.turnId &&
      thread.lastTurn.status === 'inProgress'
    ) {
      return this.store.project(existing, true);
    }
    if (
      existing?.turnId &&
      (!thread.lastTurn ||
        (thread.lastTurn.id === existing.turnId &&
          ['failed', 'interrupted'].includes(thread.lastTurn.status)))
    ) {
      throw new Error('agent-recovery-ambiguous');
    }

    const prompt = buildMediaCodexAgentTurnPrompt(request, capsule, policy);
    const turn = await this.appServer.startTurn(
      thread.threadId,
      prompt,
      policy,
    );
    const consumedReplayKeys = [
      ...(existing?.consumedReplayKeys ?? []),
      ...(existing?.currentReplayKey ? [existing.currentReplayKey] : []),
    ].slice(-64);
    let record = this.store.save({
      capsule,
      consumedReplayKeys,
      currentReplayKey: request.replayKey,
      lastEventSequence: existing?.lastEventSequence ?? 0,
      lastHeartbeatAt: new Date().toISOString(),
      schemaVersion: MEDIA_CODEX_AGENT_SCHEMA_VERSION,
      status: 'active',
      taskId: request.taskId,
      taskRevision: request.taskRevision,
      threadId: thread.threadId,
      turnId: turn.turnId,
    });
    record = await this.publish(
      record,
      'agent-thread-mapped',
      'Agent 会话已绑定',
    );
    record = await this.publish(
      record,
      'agent-turn-started',
      'Agent 正在核对当前治理单元',
    );
    return this.store.project(record, false);
  }

  private async handleToolCall(request: CodexAppServerToolRequest) {
    const record = this.store.findByThreadId(request.threadId);
    if (
      !record ||
      record.status !== 'active' ||
      record.turnId !== request.turnId
    ) {
      throw new Error('agent-tool-session-mismatch');
    }
    const policy = buildMediaCodexAgentPolicy(record.taskId, this.policyPaths);
    const call = validateMediaCodexAgentToolCall(
      {
        arguments: request.arguments,
        capsuleSha256: record.capsule.capsuleSha256,
        manifestSha256: record.capsule.manifestSha256,
        policySha256: record.capsule.policySha256,
        taskId: record.taskId,
        taskRevision: record.taskRevision,
        tool: request.tool,
      },
      record.capsule,
      policy,
    );
    return this.toolClient.call(call);
  }

  private async handleNotification(notification: CodexAppServerNotification) {
    if (
      notification.method !== 'turn/completed' &&
      notification.method !== 'turn/started'
    ) {
      return;
    }
    const threadId = notification.params.threadId;
    const turn = notification.params.turn;
    if (
      typeof threadId !== 'string' ||
      !turn ||
      typeof turn !== 'object' ||
      Array.isArray(turn)
    ) {
      return;
    }
    const turnValue = turn as Record<string, unknown>;
    const record = this.store.findByThreadId(threadId);
    if (!record || turnValue.id !== record.turnId) return;
    if (notification.method === 'turn/started') {
      const refreshed = this.store.save({
        ...withoutCheckpoint(record),
        lastHeartbeatAt: new Date().toISOString(),
      });
      await this.publish(
        refreshed,
        'agent-heartbeat',
        'Agent 正在分析已声明证据',
      );
      return;
    }
    const status = turnValue.status;
    const refreshed = this.store.save({
      ...withoutCheckpoint(record),
      lastHeartbeatAt: new Date().toISOString(),
      status: 'blocked',
    });
    await this.publish(
      refreshed,
      status === 'completed' ? 'agent-turn-completed' : 'agent-blocked',
      status === 'completed'
        ? 'Agent 回合已完成，等待密封结果验收'
        : 'Agent 回合异常结束，未重放动作',
    );
  }

  private async publish(
    record: MediaCodexAgentSessionRecord,
    type: MediaCodexAgentSemanticEvent['type'],
    summary: string,
  ) {
    const sequence = record.lastEventSequence + 1;
    await this.eventSink.publish({
      capsuleSha256: record.capsule.capsuleSha256,
      eventId: `media-agent-${Date.now()}-${sequence}-${randomUUID()}`,
      observedAt: new Date().toISOString(),
      policySha256: record.capsule.policySha256,
      sequence,
      status: record.status,
      summary,
      taskId: record.taskId,
      taskRevision: record.taskRevision,
      threadId: record.threadId,
      turnId: record.turnId,
      type,
    });
    return this.store.save({
      ...withoutCheckpoint(record),
      lastEventSequence: sequence,
    });
  }

  private withTaskLock<T>(taskId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(taskId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(work);
    this.locks.set(taskId, current);
    return current.finally(() => {
      if (this.locks.get(taskId) === current) this.locks.delete(taskId);
    });
  }
}

function withoutCheckpoint(record: MediaCodexAgentSessionRecord) {
  const { checkpointSha256, ...unsigned } = record;
  void checkpointSha256;
  return unsigned;
}
