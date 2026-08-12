import { randomUUID } from 'node:crypto';
import {
  MEDIA_CODEX_AGENT_SCHEMA_VERSION,
  parseMediaCodexAgentResult,
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
    return this.withTaskLock(taskId, () => this.sessionLocked(taskId));
  }

  private async sessionLocked(taskId: string) {
    let record = this.store.load(taskId);
    if (!record) return null;
    if (
      record.status === 'blocked' &&
      record.terminalKind === 'completed' &&
      !record.result &&
      record.turnId
    ) {
      const policy = buildMediaCodexAgentPolicy(taskId, this.policyPaths);
      const resumed = await this.appServer.resumeThread(
        record.threadId,
        policy,
      );
      if (
        resumed.lastTurn?.id === record.turnId &&
        resumed.lastTurn.status === 'completed' &&
        resumed.lastTurn.result
      ) {
        record = this.store.save({
          ...withoutCheckpoint(record),
          lastHeartbeatAt: new Date().toISOString(),
          result: resumed.lastTurn.result,
        });
      }
      if (!this.hasConsistentResult(record)) {
        record = this.store.save({
          ...withoutCheckpoint(record),
          lastHeartbeatAt: new Date().toISOString(),
          terminalKind: 'failed',
        });
        try {
          record = await this.publish(
            record,
            'agent-blocked',
            'Agent 结构化结果缺失或与密封计划不一致，可安全重试',
          );
        } catch {
          record = this.store.load(taskId) ?? record;
        }
      }
    }
    return this.store.project(record, false);
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

    if (
      request.recoveryMode &&
      (!existing || existing.status !== 'blocked' || !existing.turnId)
    ) {
      throw new Error('agent-retry-session-not-blocked');
    }
    const resumedThread = existing
      ? await this.appServer.resumeThread(existing.threadId, policy)
      : null;
    if (
      existing?.turnId &&
      resumedThread?.lastTurn &&
      resumedThread.lastTurn.id === existing.turnId &&
      resumedThread.lastTurn.status === 'inProgress'
    ) {
      return this.store.project(existing, true);
    }
    let thread = resumedThread;
    if (existing?.turnId) {
      const lastTurn = resumedThread?.lastTurn;
      if (!lastTurn || lastTurn.id !== existing.turnId) {
        throw new Error('agent-recovery-ambiguous');
      }
      if (request.recoveryMode === 'restart-failed-turn') {
        if (
          existing.terminalKind !== 'failed' &&
          !['failed', 'interrupted'].includes(lastTurn.status)
        ) {
          throw new Error('agent-retry-not-failed');
        }
        thread = await this.appServer.startThread(policy);
      } else if (['failed', 'interrupted'].includes(lastTurn.status)) {
        throw new Error('agent-recovery-ambiguous');
      }
    }
    thread ??= await this.appServer.startThread(policy);

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
      acceptedPlanSha256: null,
      capsule,
      consumedReplayKeys,
      currentReplayKey: request.replayKey,
      lastEventSequence: existing?.lastEventSequence ?? 0,
      lastHeartbeatAt: new Date().toISOString(),
      result: null,
      schemaVersion: MEDIA_CODEX_AGENT_SCHEMA_VERSION,
      status: 'active',
      taskId: request.taskId,
      taskRevision: request.taskRevision,
      terminalKind: null,
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
    const result = await this.toolClient.call(call);
    if (call.tool === 'plan.submit.sealed') {
      if (
        !result ||
        typeof result !== 'object' ||
        Array.isArray(result) ||
        (result as Record<string, unknown>).accepted !== true ||
        typeof (result as Record<string, unknown>).planSha256 !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(
          String((result as Record<string, unknown>).planSha256),
        )
      ) {
        throw new Error('agent-sealed-plan-not-accepted');
      }
      this.store.save({
        ...withoutCheckpoint(record),
        acceptedPlanSha256: String(
          (result as Record<string, unknown>).planSha256,
        ),
        lastHeartbeatAt: new Date().toISOString(),
      });
    }
    return result;
  }

  private async handleNotification(notification: CodexAppServerNotification) {
    if (
      notification.method !== 'item/completed' &&
      notification.method !== 'turn/completed' &&
      notification.method !== 'turn/started'
    ) {
      return;
    }
    const threadId = notification.params.threadId;
    const turn = notification.params.turn;
    const turnId =
      notification.method === 'item/completed'
        ? notification.params.turnId
        : turn && typeof turn === 'object' && !Array.isArray(turn)
          ? (turn as Record<string, unknown>).id
          : null;
    if (typeof threadId !== 'string' || typeof turnId !== 'string') {
      return;
    }
    const record = this.store.findByThreadId(threadId);
    if (!record || turnId !== record.turnId) return;
    if (notification.method === 'item/completed') {
      const item = notification.params.item;
      if (!item || typeof item !== 'object' || Array.isArray(item)) return;
      const itemValue = item as Record<string, unknown>;
      if (
        itemValue.type !== 'agentMessage' ||
        itemValue.phase !== 'final_answer' ||
        typeof itemValue.text !== 'string'
      ) {
        return;
      }
      let result = null;
      try {
        result = parseMediaCodexAgentResult(JSON.parse(itemValue.text));
      } catch {
        result = null;
      }
      if (result) {
        this.store.save({
          ...withoutCheckpoint(record),
          lastHeartbeatAt: new Date().toISOString(),
          result,
        });
      }
      return;
    }
    const turnValue = turn as Record<string, unknown>;
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
    const latest = this.store.load(record.taskId) ?? record;
    const completed =
      turnValue.status === 'completed' &&
      this.hasConsistentResult(latest) &&
      latest.result?.status !== 'blocked';
    const refreshed = this.store.save({
      ...withoutCheckpoint(latest),
      lastHeartbeatAt: new Date().toISOString(),
      status: 'blocked',
      terminalKind: completed
        ? 'completed'
        : turnValue.status === 'interrupted'
          ? 'interrupted'
          : 'failed',
    });
    await this.publish(
      refreshed,
      completed ? 'agent-turn-completed' : 'agent-blocked',
      completed
        ? 'Agent 回合已完成，等待密封结果验收'
        : turnValue.status === 'completed'
          ? 'Agent 结构化结果缺失或与密封计划不一致，可安全重试'
          : 'Agent 回合异常结束，未重放动作',
    );
  }

  private hasConsistentResult(record: MediaCodexAgentSessionRecord) {
    if (!record.result) return false;
    return record.result.status === 'plan-submitted'
      ? record.acceptedPlanSha256 !== null &&
          record.result.planSha256 === record.acceptedPlanSha256
      : record.acceptedPlanSha256 === null && record.result.planSha256 === null;
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
      planSha256:
        type === 'agent-turn-completed'
          ? (record.result?.planSha256 ?? null)
          : null,
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
