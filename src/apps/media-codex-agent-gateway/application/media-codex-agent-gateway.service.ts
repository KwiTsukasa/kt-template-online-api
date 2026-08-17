import { randomUUID } from 'node:crypto';
import {
  MEDIA_CODEX_AGENT_SCHEMA_VERSION,
  canonicalJson,
  parseMediaCodexAgentResult,
  type MediaCodexAgentConversationEvent,
  type MediaCodexAgentConversationMessage,
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
  type CodexAppServerThreadState,
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
  publishConversation(event: MediaCodexAgentConversationEvent): Promise<void>;
}

export class MediaCodexAgentGatewayService {
  private readonly conversationDeltas = new Map<
    string,
    {
      content: string;
      message: MediaCodexAgentConversationMessage;
      record: MediaCodexAgentSessionRecord;
      timer: NodeJS.Timeout;
    }
  >();
  private readonly conversationEventSequences = new Map<string, number>();
  private readonly conversationPublishQueues = new Map<string, Promise<void>>();
  private readonly hotMessages = new Map<
    string,
    MediaCodexAgentConversationMessage
  >();
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

  /**
   * 通过在任务级串行锁内启动或安全重放一个媒体治理回合。
   * @param request - 用于通过在任务级串行锁内启动或安全重放一个媒体治理回合的当前 HTTP 请求，包含 `taskId` 字段。
   * @returns 通过在任务级串行锁内启动或安全重放一个媒体治理回合。
   */
  startTurn(request: MediaCodexAgentTurnRequest) {
    return this.withTaskLock(request.taskId, () =>
      this.startTurnLocked(request),
    );
  }

  /**
   * 同时确认 App Server 与内部事件接收端处于就绪状态。
   * @returns 包含 `apiCallbackReady`、`appServerReady` 字段的同时确认 App Server 与内部事件接收端处于就绪状态。
   */
  async health() {
    await Promise.all([this.appServer.initialize(), this.eventSink.health()]);
    return {
      apiCallbackReady: true as const,
      appServerReady: true as const,
    };
  }

  /**
   * 通过在任务级串行锁内查询指定消息序列之后的安全会话投影。
   * @param taskId - 用于精确定位任务的标识。
   * @param afterSequence - 只返回该消息序列号之后内容的排他下界；省略时从首条消息开始；省略时默认采用 `0`。
   * @param limit - 允许返回或处理的通过在任务级串行锁内查询指定消息序列之后的安全会话最大数量；省略时默认采用 `200`。
   * @returns 通过在任务级串行锁内查询指定消息序列之后的安全会话。
   */
  session(taskId: string, afterSequence = 0, limit = 200) {
    return this.withTaskLock(taskId, () =>
      this.sessionLocked(taskId, afterSequence, limit),
    );
  }

  /**
   * 恢复官方线程消息并修复已完成但结果尚未落盘的会话状态。
   * @param taskId - 用于精确定位任务的标识。
   * @param afterSequence - 只返回该消息序列号之后内容的排他下界；省略时从首条消息开始。
   * @param limit - 允许返回或处理的官方线程消息并修复已完成但结果尚未落盘的会话状态最大数量。
   * @returns 官方线程消息并修复已完成但结果尚未落盘的会话状态；无法解析或未命中时为 `null`。
   */
  private async sessionLocked(
    taskId: string,
    afterSequence: number,
    limit: number,
  ) {
    let record = this.store.load(taskId);
    if (!record) return null;
    if (afterSequence > 0) {
      return this.projectSession(record, afterSequence, limit);
    }
    const policy = buildMediaCodexAgentPolicy(taskId, this.policyPaths);
    const resumed = await this.appServer.resumeThread(record.threadId, policy);
    record = this.mergeOfficialMessages(record, resumed.messages ?? []);
    if (
      resumed.lastTurn?.id === record.turnId &&
      resumed.lastTurn.status === 'completed' &&
      resumed.lastTurn.result &&
      !record.result
    ) {
      record = this.store.save({
        ...withoutCheckpoint(record),
        lastHeartbeatAt: new Date().toISOString(),
        result: resumed.lastTurn.result,
      });
    }
    if (
      record.status === 'blocked' &&
      record.terminalKind === 'completed' &&
      !record.result &&
      record.turnId
    ) {
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
    return this.projectSession(record, afterSequence, limit);
  }

  /**
   * 合并尚未落盘的热消息，并返回调用方请求的分页会话视图。
   * @param record - 用于媒体 Codex Agent 回合会话的领域对象，包含 `turnId` 字段。
   * @param afterSequence - 只返回该消息序列号之后内容的排他下界；省略时从首条消息开始。
   * @param limit - 允许返回或处理的媒体 Codex Agent 回合会话最大数量。
   * @returns 包含 `messages` 字段的媒体 Codex Agent 回合会话。
   */
  private projectSession(
    record: MediaCodexAgentSessionRecord,
    afterSequence: number,
    limit: number,
  ) {
    const projected = this.store.project(record, false, afterSequence, limit);
    const hot = [...this.hotMessages.values()].filter(
      (message) =>
        message.turnId === record.turnId && message.sequence > afterSequence,
    );
    if (hot.length === 0) return projected;
    return {
      ...projected,
      messages: [...(projected.messages ?? []), ...hot],
    };
  }

  /**
   * 执行回放、恢复和策略边界检查后创建新回合并发布起始事件。
   * @param request - 用于回放、恢复和策略边界检查后创建新回合并发布起始事件的当前 HTTP 请求，包含 `taskId`、`taskRevision`、`replayKey`、`recoveryMode` 字段。
   * @returns 回放、恢复和策略边界检查后创建新回合并发布起始事件。
   * @throws 当 `existing.capsule.policySha256 !== policy.policySha256 || existing.capsu…` 成立时拒绝当前输入并抛出 `Error`；当 `request.taskRevision < existing.taskRevision` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `existing.status === 'active'` 成立时拒绝当前输入并抛出 `Error`；当 `request.recoveryMode && (!existing || existing.status !== 'blocked' ||…` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `!lastTurn || lastTurn.id !== existing.turnId` 成立时拒绝当前输入并抛出 `Error`；当 `existing.terminalKind !== 'failed' && !['failed', 'interrupted'].includ…` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `['failed', 'interrupted'].includes(lastTurn.status)` 成立时拒绝当前输入并抛出 `Error`。
   */
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
    let resumedThread: CodexAppServerThreadState | null = null;
    if (existing) {
      resumedThread = await this.appServer.resumeThread(
        existing.threadId,
        policy,
      );
    }
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
    const clientMessageId =
      request.clientMessageId ?? `media-user-${randomUUID()}`;
    const turn = await this.appServer.startTurn(
      thread.threadId,
      prompt,
      policy,
      clientMessageId,
    );
    const replayKeys = [...(existing?.consumedReplayKeys ?? [])];
    if (existing?.currentReplayKey) {
      replayKeys.push(existing.currentReplayKey);
    }
    const consumedReplayKeys = replayKeys.slice(-64);
    const merged = this.mergeMessageLists(
      existing?.messages ?? [],
      thread.messages ?? [],
      existing?.conversationRevision ?? 0,
    );
    const userMessage: MediaCodexAgentConversationMessage = {
      content: request.operatorCommand.trim(),
      messageId: clientMessageId,
      observedAt: new Date().toISOString(),
      phase: 'user',
      result: null,
      role: 'user',
      sequence: merged.conversationRevision + 1,
      status: 'completed',
      turnId: turn.turnId,
    };
    let record = this.store.save({
      acceptedPlanSha256: null,
      capsule,
      consumedReplayKeys,
      conversationRevision: userMessage.sequence,
      currentReplayKey: request.replayKey,
      lastClientMessageId: clientMessageId,
      lastEventSequence: existing?.lastEventSequence ?? 0,
      lastHeartbeatAt: new Date().toISOString(),
      messages: [...merged.messages, userMessage],
      result: null,
      schemaVersion: MEDIA_CODEX_AGENT_SCHEMA_VERSION,
      status: 'active',
      taskId: request.taskId,
      taskRevision: request.taskRevision,
      terminalKind: null,
      threadId: thread.threadId,
      turnId: turn.turnId,
    });
    const mappedNewThread = !existing || existing.threadId !== thread.threadId;
    if (mappedNewThread) {
      record = await this.publish(
        record,
        'agent-thread-mapped',
        'Agent 会话已绑定',
      );
    }
    await this.publishConversation(record, 'message-completed', userMessage);
    const turnStartedMessage: MediaCodexAgentConversationMessage = {
      content: 'Agent 正在处理本回合消息',
      messageId: turn.turnId,
      observedAt: new Date().toISOString(),
      phase: 'commentary',
      result: null,
      role: 'assistant',
      sequence: record.conversationRevision + 1,
      status: 'streaming',
      turnId: turn.turnId,
    };
    await this.publishConversation(record, 'turn-started', turnStartedMessage);
    if (mappedNewThread) {
      record = await this.publish(
        record,
        'agent-turn-started',
        'Agent 正在核对当前治理单元',
      );
    }
    return this.store.project(record, false);
  }

  /**
   * 校验 App Server 工具调用的会话身份，并转发后持久化已接受计划摘要。
   * @param request - 用于App Server 工具调用的执行结果的当前 HTTP 请求，包含 `threadId`、`turnId`、`arguments`、`tool` 字段。
   * @returns App Server 工具调用的执行。
   * @throws 当 `!record || record.status !== 'active' || record.turnId !== request.turn…` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `!result || typeof result !== 'object' || Array.isArray(result)` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `resultValue.accepted !== true || typeof resultValue.planSha256 !== 'str…` 成立时拒绝当前输入并抛出 `Error`。
   */
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
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        throw new Error('agent-sealed-plan-not-accepted');
      }
      const resultValue = result as Record<string, unknown>;
      if (
        resultValue.accepted !== true ||
        typeof resultValue.planSha256 !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(resultValue.planSha256)
      ) {
        throw new Error('agent-sealed-plan-not-accepted');
      }
      this.store.save({
        ...withoutCheckpoint(record),
        acceptedPlanSha256: resultValue.planSha256,
        lastHeartbeatAt: new Date().toISOString(),
      });
    }
    return result;
  }

  /**
   * 通过筛选受支持的 App Server 通知，绑定任务会话后进入任务级串行处理。
   * @param notification - 用于通过筛选受支持的 App Server 通知，绑定任务会话后进入任务级串行处理的领域对象，包含 `method`、`params` 字段。
   */
  private async handleNotification(notification: CodexAppServerNotification) {
    if (
      notification.method !== 'item/agentMessage/delta' &&
      notification.method !== 'item/started' &&
      notification.method !== 'item/completed' &&
      notification.method !== 'turn/completed' &&
      notification.method !== 'turn/started'
    ) {
      return;
    }
    const threadId = notification.params.threadId;
    const turn = notification.params.turn;
    const isItemNotification =
      notification.method === 'item/completed' ||
      notification.method === 'item/started' ||
      notification.method === 'item/agentMessage/delta';
    let turnId: unknown = null;
    if (isItemNotification) {
      turnId = notification.params.turnId;
    } else if (turn && typeof turn === 'object' && !Array.isArray(turn)) {
      turnId = (turn as Record<string, unknown>).id;
    }
    if (typeof threadId !== 'string' || typeof turnId !== 'string') {
      return;
    }
    const record = this.store.findByThreadId(threadId);
    if (!record || turnId !== record.turnId) return;
    await this.withTaskLock(record.taskId, () =>
      this.handleNotificationLocked(notification, record.taskId, turnId),
    );
  }

  /**
   * 将消息增量、消息完成和回合终态归并到同一持久化会话。
   * @param notification - 用于将消息增量、消息完成和回合终态归并到同一持久化会话的领域对象，包含 `method`、`params` 字段。
   * @param taskId - 用于精确定位任务的标识。
   * @param turnId - 用于精确定位回合的标识。
   */
  private async handleNotificationLocked(
    notification: CodexAppServerNotification,
    taskId: string,
    turnId: string,
  ) {
    const record = this.store.load(taskId);
    if (!record || record.turnId !== turnId) return;
    if (notification.method === 'item/started') {
      const item = notification.params.item;
      if (!item || typeof item !== 'object' || Array.isArray(item)) return;
      const itemValue = item as Record<string, unknown>;
      if (
        itemValue.type !== 'agentMessage' ||
        typeof itemValue.id !== 'string'
      ) {
        return;
      }
      let content = '正在生成回复';
      let phase: MediaCodexAgentConversationMessage['phase'] = 'commentary';
      if (itemValue.phase === 'final_answer') {
        content = '正在生成治理结论';
        phase = 'final_answer';
      }
      this.hotMessages.set(itemValue.id, {
        content,
        messageId: itemValue.id,
        observedAt: new Date().toISOString(),
        phase,
        result: null,
        role: 'assistant',
        sequence: record.conversationRevision + 1,
        status: 'streaming',
        turnId,
      });
      return;
    }
    if (notification.method === 'item/agentMessage/delta') {
      const itemId = notification.params.itemId;
      const delta = notification.params.delta;
      if (typeof itemId !== 'string' || typeof delta !== 'string' || !delta) {
        return;
      }
      const existingMessage = this.hotMessages.get(itemId);
      const exposeDelta = existingMessage?.phase === 'commentary';
      let content = '正在生成治理结论';
      if (exposeDelta) {
        let previousContent = existingMessage?.content ?? '';
        if (previousContent === '正在生成回复') previousContent = '';
        content = `${previousContent}${delta}`;
      }
      const message: MediaCodexAgentConversationMessage = {
        content,
        messageId: itemId,
        observedAt: new Date().toISOString(),
        phase: existingMessage?.phase ?? 'commentary',
        result: null,
        role: 'assistant',
        sequence: record.conversationRevision + 1,
        status: 'streaming',
        turnId,
      };
      this.hotMessages.set(itemId, message);
      let publishedContent = '正在生成治理结论';
      if (exposeDelta) publishedContent = delta;
      this.enqueueConversationDelta(record, message, publishedContent);
      return;
    }
    if (notification.method === 'item/completed') {
      const item = notification.params.item;
      if (!item || typeof item !== 'object' || Array.isArray(item)) return;
      const itemValue = item as Record<string, unknown>;
      if (
        itemValue.type !== 'agentMessage' ||
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
      if (typeof itemValue.id !== 'string') return;
      await this.flushConversationDelta(record.threadId, itemValue.id);
      const existingMessage = record.messages.find(
        (message) => message.messageId === itemValue.id,
      );
      let revision = record.conversationRevision + 1;
      if (existingMessage) revision = record.conversationRevision;
      let content = itemValue.text.trim();
      if (itemValue.phase === 'final_answer') {
        content = '治理结论未通过结构化校验';
      }
      if (result?.summary) content = result.summary;
      let phase: MediaCodexAgentConversationMessage['phase'] = 'commentary';
      if (itemValue.phase === 'final_answer') phase = 'final_answer';
      const message: MediaCodexAgentConversationMessage = {
        content,
        messageId: itemValue.id,
        observedAt: new Date().toISOString(),
        phase,
        result,
        role: 'assistant',
        sequence: existingMessage?.sequence ?? revision,
        status: 'completed',
        turnId,
      };
      if (!message.content) return;
      this.hotMessages.delete(itemValue.id);
      const refreshed = this.store.save({
        ...withoutCheckpoint(record),
        conversationRevision: revision,
        lastHeartbeatAt: message.observedAt,
        messages: this.replaceMessage(record.messages, message),
        result: result ?? record.result,
      });
      await this.publishConversation(refreshed, 'message-completed', message);
      return;
    }
    const turn = notification.params.turn;
    let turnValue: Record<string, unknown> = {};
    if (turn && typeof turn === 'object' && !Array.isArray(turn)) {
      turnValue = turn as Record<string, unknown>;
    }
    await this.flushTurnConversationDeltas(record.threadId, turnId);
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
    for (const [messageId, message] of this.hotMessages) {
      if (message.turnId === turnId) this.hotMessages.delete(messageId);
    }
    const latest = this.store.load(record.taskId) ?? record;
    const completed =
      turnValue.status === 'completed' && this.hasConsistentResult(latest);
    let terminalKind: MediaCodexAgentSessionRecord['terminalKind'] = 'failed';
    if (completed) {
      terminalKind = 'completed';
    } else if (turnValue.status === 'interrupted') {
      terminalKind = 'interrupted';
    }
    const refreshed = this.store.save({
      ...withoutCheckpoint(latest),
      lastHeartbeatAt: new Date().toISOString(),
      status: 'blocked',
      terminalKind,
    });
    if (completed && refreshed.result?.status === 'conversation-response') {
      const message = [...refreshed.messages]
        .reverse()
        .find(
          (candidate) =>
            candidate.turnId === turnId && candidate.role === 'assistant',
        );
      if (message) {
        await this.publishConversation(refreshed, 'turn-completed', message);
      }
      return;
    }
    let eventType: MediaCodexAgentSemanticEvent['type'] = 'agent-blocked';
    let summary = 'Agent 回合异常结束，未重放动作';
    if (completed) {
      eventType = 'agent-turn-completed';
      summary = 'Agent 回合已完成，等待密封结果验收';
    } else if (turnValue.status === 'completed') {
      summary = 'Agent 结构化结果缺失或与密封计划不一致，可安全重试';
    }
    await this.publish(refreshed, eventType, summary);
  }

  /**
   * 将 App Server 官方消息归并到当前会话，并仅在内容变化时保存。
   * @param record - 用于官方消息集合的领域对象，包含 `messages`、`conversationRevision` 字段。
   * @param messages - 按原有顺序参与官方消息集合筛选、合并或汇总的集合。
   * @returns 官方消息集合。
   */
  private mergeOfficialMessages(
    record: MediaCodexAgentSessionRecord,
    messages: Array<Omit<MediaCodexAgentConversationMessage, 'sequence'>>,
  ) {
    const merged = this.mergeMessageLists(
      record.messages,
      messages,
      record.conversationRevision,
    );
    if (
      merged.conversationRevision === record.conversationRevision &&
      canonicalJson(merged.messages) === canonicalJson(record.messages)
    ) {
      return record;
    }
    return this.store.save({
      ...withoutCheckpoint(record),
      conversationRevision: merged.conversationRevision,
      messages: merged.messages,
    });
  }

  /**
   * 按消息标识合并官方历史，保留既有序列并为新消息连续编号。
   * @param existing - 决定按消息标识合并官方历史，保留既有序列并为新消息连续编号内容、边界或目标的 `existing` 值。
   * @param official - 决定按消息标识合并官方历史，保留既有序列并为新消息连续编号内容、边界或目标的 `official` 值。
   * @param initialRevision - 决定按消息标识合并官方历史，保留既有序列并为新消息连续编号内容、边界或目标的 `initialRevision` 值。
   * @returns 包含 `conversationRevision`、`messages` 字段的按消息标识合并官方历史，保留既有序列并为新消息连续编号。
   */
  private mergeMessageLists(
    existing: MediaCodexAgentConversationMessage[],
    official: Array<Omit<MediaCodexAgentConversationMessage, 'sequence'>>,
    initialRevision: number,
  ) {
    let conversationRevision = initialRevision;
    let messages = [...existing];
    for (const message of official) {
      const current = messages.find(
        (candidate) => candidate.messageId === message.messageId,
      );
      if (current) {
        messages = this.replaceMessage(messages, {
          ...message,
          sequence: current.sequence,
        });
        continue;
      }
      conversationRevision += 1;
      messages.push({ ...message, sequence: conversationRevision });
    }
    messages.sort((left, right) => left.sequence - right.sequence);
    return { conversationRevision, messages };
  }

  /**
   * 按消息标识替换现有消息，未命中时将新消息追加到列表。
   * @param messages - 按原有顺序参与replace消息筛选、合并或汇总的集合。
   * @param message - 包含正文、发送目标与账号身份的待处理消息，包含 `messageId` 字段。
   * @returns replace消息。
   */
  private replaceMessage(
    messages: MediaCodexAgentConversationMessage[],
    message: MediaCodexAgentConversationMessage,
  ) {
    const index = messages.findIndex(
      (candidate) => candidate.messageId === message.messageId,
    );
    if (index === -1) return [...messages, message];
    const next = [...messages];
    next.splice(index, 1, message);
    return next;
  }

  /**
   * 按线程串行发布对话事件，确保事件序列单调递增且队列可回收。
   * @param record - 用于按线程串行发布对话事件，确保事件序列单调递增且队列可回收的领域对象，包含 `threadId`、`capsule`、`conversationRevision`、`taskId` 字段。
   * @param changeType - 决定按线程串行发布对话事件，确保事件序列单调递增且队列可回收内容、边界或目标的 `changeType` 值。
   * @param message - 包含正文、发送目标与账号身份的待处理消息，包含 `messageId`、`observedAt`、`phase`、`result` 字段。
   * @param content - 决定按线程串行发布对话事件，确保事件序列单调递增且队列可回收内容、边界或目标的 `content` 值；省略时默认采用 `message.content`。
   */
  private async publishConversation(
    record: MediaCodexAgentSessionRecord,
    changeType: MediaCodexAgentConversationEvent['changeType'],
    message: MediaCodexAgentConversationMessage,
    content = message.content,
  ) {
    const previous =
      this.conversationPublishQueues.get(record.threadId) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(async () => {
        const lastSequence =
          this.conversationEventSequences.get(record.threadId) ?? 0;
        const eventSequence = Math.max(lastSequence + 1, Date.now() * 1_000);
        this.conversationEventSequences.set(record.threadId, eventSequence);
        await this.eventSink.publishConversation({
          capsuleSha256: record.capsule.capsuleSha256,
          changeType,
          content,
          conversationRevision: record.conversationRevision,
          eventSequence,
          messageId: message.messageId,
          observedAt: message.observedAt,
          phase: message.phase,
          policySha256: record.capsule.policySha256,
          result: message.result,
          role: message.role,
          status: message.status,
          taskId: record.taskId,
          taskRevision: record.taskRevision,
          threadId: record.threadId,
          turnId: message.turnId,
        });
      });
    this.conversationPublishQueues.set(record.threadId, current);
    try {
      await current;
    } finally {
      if (this.conversationPublishQueues.get(record.threadId) === current) {
        this.conversationPublishQueues.delete(record.threadId);
      }
    }
  }

  /**
   * 在短窗口内合并同一消息的增量，降低事件发布频率。
   * @param record - 用于在短窗口内合并同一消息的增量，降低事件发布频率的领域对象，包含 `threadId` 字段。
   * @param message - 包含正文、发送目标与账号身份的待处理消息，包含 `messageId`、`phase` 字段。
   * @param content - 决定在短窗口内合并同一消息的增量，降低事件发布频率内容、边界或目标的 `content` 值。
   */
  private enqueueConversationDelta(
    record: MediaCodexAgentSessionRecord,
    message: MediaCodexAgentConversationMessage,
    content: string,
  ) {
    const key = `${record.threadId}:${message.messageId}`;
    const pending = this.conversationDeltas.get(key);
    if (pending) {
      if (message.phase === 'commentary') {
        pending.content = `${pending.content}${content}`;
      } else {
        pending.content = '正在生成治理结论';
      }
      pending.message = message;
      pending.record = record;
      return;
    }
    const timer = setTimeout(() => {
      void this.flushConversationDelta(
        record.threadId,
        message.messageId,
      ).catch(() => undefined);
    }, 75);
    this.conversationDeltas.set(key, {
      content,
      message,
      record,
      timer,
    });
  }

  /**
   * 立即发布并移除指定线程消息的待发送增量。
   * @param threadId - 用于精确定位线程的标识。
   * @param messageId - 用于精确定位消息的标识。
   * @returns 立即发布并移除指定线程消息的待发送增量。
   */
  private flushConversationDelta(threadId: string, messageId: string) {
    const key = `${threadId}:${messageId}`;
    const pending = this.conversationDeltas.get(key);
    if (!pending) return Promise.resolve();
    clearTimeout(pending.timer);
    this.conversationDeltas.delete(key);
    return this.publishConversation(
      pending.record,
      'assistant-delta',
      pending.message,
      pending.content,
    );
  }

  /**
   * 通过在回合终态处理前依次排空该回合的所有对话增量。
   * @param threadId - 用于精确定位线程的标识。
   * @param turnId - 用于精确定位回合的标识。
   */
  private async flushTurnConversationDeltas(threadId: string, turnId: string) {
    const pending = [...this.conversationDeltas.entries()].filter(
      ([key, value]) =>
        key.startsWith(`${threadId}:`) && value.message.turnId === turnId,
    );
    for (const [, value] of pending) {
      await this.flushConversationDelta(threadId, value.message.messageId);
    }
  }

  /**
   * 根据已接受密封计划的摘要关系，判断结构化结果是否与计划一致。
   * @param record - 用于根据已接受密封计划的摘要关系，判断结构化结果是否与计划一致的领域对象，包含 `result`、`acceptedPlanSha256` 字段。
   * @returns 满足根据已接受密封计划的摘要关系，判断结构化结果是否与计划一致约束时为 `true`；不满足、未命中或显式失败分支为 `false`；无法解析或未命中时为 `null`。
   */
  private hasConsistentResult(record: MediaCodexAgentSessionRecord) {
    if (!record.result) return false;
    if (record.result.status === 'plan-submitted') {
      return (
        record.acceptedPlanSha256 !== null &&
        record.result.planSha256 === record.acceptedPlanSha256
      );
    }
    return (
      record.acceptedPlanSha256 === null && record.result.planSha256 === null
    );
  }

  /**
   * 发布语义事件并将成功使用的事件序列持久化到会话检查点。
   * @param record - 用于语义事件并将成功使用的事件序列持久化到会话检查点的领域对象，包含 `lastEventSequence`、`result`、`capsule`、`status` 字段。
   * @param type - 决定语义事件并将成功使用的事件序列持久化到会话检查点内容、边界或目标的 `type` 值。
   * @param summary - 决定语义事件并将成功使用的事件序列持久化到会话检查点内容、边界或目标的 `summary` 值。
   * @returns 语义事件并将成功使用的事件序列持久化到会话检查点。
   */
  private async publish(
    record: MediaCodexAgentSessionRecord,
    type: MediaCodexAgentSemanticEvent['type'],
    summary: string,
  ) {
    const sequence = record.lastEventSequence + 1;
    let planSha256: MediaCodexAgentSemanticEvent['planSha256'] = null;
    if (type === 'agent-turn-completed') {
      planSha256 = record.result?.planSha256 ?? null;
    }
    await this.eventSink.publish({
      capsuleSha256: record.capsule.capsuleSha256,
      eventId: `media-agent-${Date.now()}-${sequence}-${randomUUID()}`,
      observedAt: new Date().toISOString(),
      planSha256,
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

  /**
   * 将同一任务的异步工作串行化，并在当前工作结束后回收锁条目。
   * @param taskId - 用于精确定位任务的标识。
   * @param work - 在当前锁、事务或错误边界内执行的受控回调。
   * @returns 任务Lock。
   */
  private withTaskLock<T>(taskId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(taskId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(work);
    this.locks.set(taskId, current);
    return current.finally(() => {
      if (this.locks.get(taskId) === current) this.locks.delete(taskId);
    });
  }
}

/**
 * 移除会话的派生检查点摘要，供下一次持久化重新计算。
 * @param record - 决定会话的派生检查点摘要，供下一次持久化重新计算内容、边界或目标的 `record` 值。
 * @returns 会话的派生检查点摘要，供下一次持久化重新计算。
 */
function withoutCheckpoint(record: MediaCodexAgentSessionRecord) {
  const { checkpointSha256, ...unsigned } = record;
  void checkpointSha256;
  return unsigned;
}
