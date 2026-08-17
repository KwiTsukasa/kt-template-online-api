import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import * as path from 'node:path';
import {
  MEDIA_CODEX_AGENT_SCHEMA_VERSION,
  canonicalJson,
  parseMediaCodexAgentResult,
  sha256Json,
  type MediaCodexAgentBoundaryCapsule,
  type MediaCodexAgentConversationMessage,
  type MediaCodexAgentResult,
  type MediaCodexAgentSafeSession,
} from '../domain/media-codex-agent.contract';

export interface MediaCodexAgentSessionRecord {
  acceptedPlanSha256: null | string;
  capsule: MediaCodexAgentBoundaryCapsule;
  checkpointSha256: string;
  consumedReplayKeys: string[];
  conversationRevision: number;
  currentReplayKey: string;
  lastClientMessageId: null | string;
  lastEventSequence: number;
  lastHeartbeatAt: string;
  messages: MediaCodexAgentConversationMessage[];
  result: MediaCodexAgentResult | null;
  schemaVersion: typeof MEDIA_CODEX_AGENT_SCHEMA_VERSION;
  status: 'active' | 'blocked' | 'closed';
  taskId: string;
  taskRevision: number;
  terminalKind: 'completed' | 'failed' | 'interrupted' | null;
  threadId: string;
  turnId: null | string;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export class MediaCodexAgentSessionStore {
  readonly sessionsRoot: string;

  constructor(stateRoot: string) {
    if (
      !stateRoot.startsWith('/') ||
      path.posix.normalize(stateRoot) !== stateRoot
    ) {
      throw new Error('agent-state-root-invalid');
    }
    this.sessionsRoot = path.posix.join(stateRoot, 'task-sessions');
    mkdirSync(this.sessionsRoot, { mode: 0o700, recursive: true });
    if (lstatSync(this.sessionsRoot).isSymbolicLink()) {
      throw new Error('agent-state-root-symbolic-link');
    }
  }

  /**
   * 从受管文件读取指定任务会话，并在返回前校验完整检查点。
   * @param taskId - 用于精确定位任务的标识。
   * @returns `load` 对应；无法解析或未命中时为 `null`。
   * @throws 当 `lstatSync(file).isSymbolicLink()` 成立时拒绝当前输入并抛出 `Error`。
   */
  load(taskId: string): MediaCodexAgentSessionRecord | null {
    const file = this.sessionPath(taskId);
    if (!existsSync(file)) return null;
    if (lstatSync(file).isSymbolicLink()) {
      throw new Error('agent-session-symbolic-link');
    }
    const record = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    return this.validateRecord(record, taskId);
  }

  /**
   * 遍历受管会话并按 App Server 线程标识查找唯一任务记录。
   * @param threadId - 用于精确定位线程的标识。
   * @returns 受管会话并按 App Server 线程标识查找唯一任务记录；无法解析或未命中时为 `null`。
   */
  findByThreadId(threadId: string): MediaCodexAgentSessionRecord | null {
    if (!SAFE_ID_PATTERN.test(threadId)) return null;
    for (const fileName of readdirSync(this.sessionsRoot)) {
      if (!fileName.endsWith('.json')) continue;
      const taskId = fileName.slice(0, -5);
      const record = this.load(taskId);
      if (record?.threadId === threadId) return record;
    }
    return null;
  }

  /**
   * 计算检查点摘要并通过临时文件、文件同步和目录同步原子保存会话。
   * @param input - 用于检查点摘要并通过临时文件、文件同步和目录同步原子保存会话的结构化输入，包含 `taskId` 字段。
   * @returns 检查点摘要并通过临时文件、文件同步和目录同步原子保存会话。
   * @throws 当 `existsSync(target) && lstatSync(target).isSymbolicLink()` 成立时拒绝当前输入并抛出 `Error`。
   */
  save(
    input: Omit<MediaCodexAgentSessionRecord, 'checkpointSha256'>,
  ): MediaCodexAgentSessionRecord {
    const checkpointSha256 = sha256Json(input);
    const record: MediaCodexAgentSessionRecord = {
      ...input,
      checkpointSha256,
    };
    this.validateRecord(record, input.taskId);
    const target = this.sessionPath(input.taskId);
    if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
      throw new Error('agent-session-symbolic-link');
    }
    const temporary = path.posix.join(
      this.sessionsRoot,
      `.${input.taskId}.${process.pid}.${Date.now()}.tmp`,
    );
    const descriptor = openSync(temporary, 'wx', 0o600);
    try {
      writeFileSync(descriptor, `${JSON.stringify(record)}\n`, 'utf8');
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, target);
    const directoryDescriptor = openSync(this.sessionsRoot, 'r');
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
    return record;
  }

  /**
   * 将内部会话投影为分页、安全且不暴露策略正文的查询结果。
   * @param record - 用于将内部会话投影为分页、安全且不暴露策略正文的查询结果的领域对象，包含 `messages`、`capsule`、`checkpointSha256`、`conversationRevision` 字段。
   * @param replayed - 决定将内部会话投影为分页、安全且不暴露策略正文的查询结果内容、边界或目标的 `replayed` 值。
   * @param afterSequence - 只返回该消息序列号之后内容的排他下界；省略时从首条消息开始；省略时默认采用 `0`。
   * @param limit - 允许返回或处理的将内部会话投影为分页、安全且不暴露策略正文的查询结果最大数量；省略时默认采用 `200`。
   * @returns 包含 `capsuleSha256`、`checkpointSha256`、`conversationRevision`、`currentUnitId`、`hasMoreMessages` 字段的将内部会话投影为分页、安全且不暴露策略正文的查询。
   */
  project(
    record: MediaCodexAgentSessionRecord,
    replayed: boolean,
    afterSequence = 0,
    limit = 200,
  ) {
    const remaining = record.messages.filter(
      (message) => message.sequence > afterSequence,
    );
    const messages = remaining.slice(0, limit);
    return {
      capsuleSha256: record.capsule.capsuleSha256,
      checkpointSha256: record.checkpointSha256,
      conversationRevision: record.conversationRevision,
      currentUnitId: record.capsule.currentUnitId,
      hasMoreMessages: remaining.length > messages.length,
      historyComplete: true,
      lastClientMessageId: record.lastClientMessageId,
      lastEventSequence: record.lastEventSequence,
      lastHeartbeatAt: record.lastHeartbeatAt,
      messages,
      policySha256: record.capsule.policySha256,
      policyVersion: record.capsule.policyVersion,
      replayed,
      result: record.result,
      status: record.status,
      taskId: record.taskId,
      taskRevision: record.taskRevision,
      terminalKind: record.terminalKind,
      threadId: record.threadId,
      turnId: record.turnId,
    } satisfies MediaCodexAgentSafeSession;
  }

  /**
   * 将安全任务标识映射到受管会话文件路径。
   * @param taskId - 用于精确定位任务的标识。
   * @returns 将安全任务标识映射到受管会话文件路径。
   * @throws 当 `!SAFE_ID_PATTERN.test(taskId)` 成立时拒绝当前输入并抛出 `Error`。
   */
  private sessionPath(taskId: string) {
    if (!SAFE_ID_PATTERN.test(taskId)) throw new Error('task-id-invalid');
    return path.posix.join(this.sessionsRoot, `${taskId}.json`);
  }

  /**
   * 校验持久化会话的身份、序列、结果和检查点摘要，并补齐兼容默认值。
   * @param value - 参与记录比较、格式化或输出的候选值。
   * @param expectedTaskId - 用于精确定位expected任务的标识。
   * @returns 包含 `acceptedPlanSha256`、`conversationRevision`、`lastClientMessageId`、`lastEventSequence`、`messages` 字段的记录；无法解析或未命中时为 `null`。
   * @throws 当 `!value || typeof value !== 'object' || Array.isArray(value)` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `record.schemaVersion !== MEDIA_CODEX_AGENT_SCHEMA_VERSION || record.tas…` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `!['active', 'blocked', 'closed'].includes(record.status)` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `record.terminalKind !== undefined && record.terminalKind !== null && ![…` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `!Array.isArray(record.consumedReplayKeys) || record.consumedReplayKeys.…` 成立时拒绝当前输入并抛出 `Error`；当 `!SAFE_ID_PATTERN.test(record.currentReplayKey)` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `record.lastClientMessageId !== undefined && record.lastClientMessageId…` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `record.conversationRevision !== undefined && (!Number.isSafeInteger(rec…` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `record.messages !== undefined && !this.validMessages( record.messages,…` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `record.lastEventSequence !== undefined && (!Number.isSafeInteger(record…` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `record.turnId !== null && !SAFE_ID_PATTERN.test(record.turnId)` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `record.acceptedPlanSha256 !== undefined && record.acceptedPlanSha256 !=…` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `record.result !== undefined && record.result !== null && (!parsedResult…` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `!SHA256_PATTERN.test(record.capsule?.capsuleSha256 ?? '')` 成立时拒绝当前输入并抛出 `Error`；当 `checkpointSha256 !== sha256Json(unsigned)` 成立时拒绝当前输入并抛出 `Error`。
   */
  private validateRecord(
    value: unknown,
    expectedTaskId: string,
  ): MediaCodexAgentSessionRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('agent-session-record-invalid');
    }
    const record = value as Omit<
      MediaCodexAgentSessionRecord,
      | 'acceptedPlanSha256'
      | 'conversationRevision'
      | 'lastClientMessageId'
      | 'lastEventSequence'
      | 'messages'
      | 'result'
    > & {
      acceptedPlanSha256?: null | string;
      conversationRevision?: number;
      lastClientMessageId?: null | string;
      lastEventSequence?: number;
      messages?: MediaCodexAgentConversationMessage[];
      result?: MediaCodexAgentResult | null;
    };
    const { checkpointSha256, ...unsigned } = record;
    let parsedResult: MediaCodexAgentResult | null = null;
    if (record.result) {
      parsedResult = parseMediaCodexAgentResult({
        candidateSummaries: record.result.candidateSummaries,
        nextActionLabel: record.result.nextActionLabel,
        planSha256: record.result.planSha256,
        status: record.result.status,
        summary: record.result.summary,
      });
    }
    if (
      record.schemaVersion !== MEDIA_CODEX_AGENT_SCHEMA_VERSION ||
      record.taskId !== expectedTaskId ||
      !SAFE_ID_PATTERN.test(record.threadId) ||
      !Number.isSafeInteger(record.taskRevision) ||
      record.taskRevision < 1
    ) {
      throw new Error('agent-session-record-invalid');
    }
    if (!['active', 'blocked', 'closed'].includes(record.status)) {
      throw new Error('agent-session-record-invalid');
    }
    if (
      record.terminalKind !== undefined &&
      record.terminalKind !== null &&
      !['completed', 'failed', 'interrupted'].includes(record.terminalKind)
    ) {
      throw new Error('agent-session-record-invalid');
    }
    if (
      !Array.isArray(record.consumedReplayKeys) ||
      record.consumedReplayKeys.length > 64 ||
      record.consumedReplayKeys.some((key) => !SAFE_ID_PATTERN.test(key))
    ) {
      throw new Error('agent-session-record-invalid');
    }
    if (!SAFE_ID_PATTERN.test(record.currentReplayKey)) {
      throw new Error('agent-session-record-invalid');
    }
    if (
      record.lastClientMessageId !== undefined &&
      record.lastClientMessageId !== null &&
      !SAFE_ID_PATTERN.test(record.lastClientMessageId)
    ) {
      throw new Error('agent-session-record-invalid');
    }
    if (
      record.conversationRevision !== undefined &&
      (!Number.isSafeInteger(record.conversationRevision) ||
        record.conversationRevision < 0)
    ) {
      throw new Error('agent-session-record-invalid');
    }
    if (
      record.messages !== undefined &&
      !this.validMessages(
        record.messages,
        record.conversationRevision ?? record.messages.length,
      )
    ) {
      throw new Error('agent-session-record-invalid');
    }
    if (
      record.lastEventSequence !== undefined &&
      (!Number.isSafeInteger(record.lastEventSequence) ||
        record.lastEventSequence < 0)
    ) {
      throw new Error('agent-session-record-invalid');
    }
    if (record.turnId !== null && !SAFE_ID_PATTERN.test(record.turnId)) {
      throw new Error('agent-session-record-invalid');
    }
    if (
      record.acceptedPlanSha256 !== undefined &&
      record.acceptedPlanSha256 !== null &&
      !SHA256_PATTERN.test(record.acceptedPlanSha256)
    ) {
      throw new Error('agent-session-record-invalid');
    }
    if (
      record.result !== undefined &&
      record.result !== null &&
      (!parsedResult ||
        canonicalJson(parsedResult) !== canonicalJson(record.result))
    ) {
      throw new Error('agent-session-record-invalid');
    }
    if (!SHA256_PATTERN.test(record.capsule?.capsuleSha256 ?? '')) {
      throw new Error('agent-session-record-invalid');
    }
    if (checkpointSha256 !== sha256Json(unsigned)) {
      throw new Error('agent-session-record-invalid');
    }
    return {
      ...record,
      acceptedPlanSha256: record.acceptedPlanSha256 ?? null,
      conversationRevision: record.conversationRevision ?? 0,
      lastClientMessageId: record.lastClientMessageId ?? null,
      lastEventSequence: record.lastEventSequence ?? 0,
      messages: record.messages ?? [],
      result: record.result ?? null,
      terminalKind: record.terminalKind ?? null,
    } as MediaCodexAgentSessionRecord;
  }

  /**
   * 按体积、连续序列、角色状态、时间和结构化结果规则校验消息历史。
   * @param messages - 按原有顺序参与按体积、连续序列、角色状态、时间和结构化结果规则校验消息历史筛选、合并或汇总的集合。
   * @param conversationRevision - 决定按体积、连续序列、角色状态、时间和结构化结果规则校验消息历史内容、边界或目标的 `conversationRevision` 值。
   * @returns 满足按体积、连续序列、角色状态、时间和结构化结果规则校验消息历史约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private validMessages(
    messages: MediaCodexAgentConversationMessage[],
    conversationRevision: number,
  ) {
    if (
      !Array.isArray(messages) ||
      messages.length > 2_000 ||
      Buffer.byteLength(JSON.stringify(messages)) > 4 * 1024 * 1024
    ) {
      return false;
    }
    let previousSequence = 0;
    for (const message of messages) {
      if (
        !message ||
        typeof message !== 'object' ||
        !SAFE_ID_PATTERN.test(message.messageId)
      ) {
        return false;
      }
      if (!SAFE_ID_PATTERN.test(message.turnId)) return false;
      if (
        !['assistant', 'user'].includes(message.role) ||
        !['commentary', 'final_answer', 'user'].includes(message.phase) ||
        !['completed', 'streaming'].includes(message.status)
      ) {
        return false;
      }
      if (
        !Number.isSafeInteger(message.sequence) ||
        message.sequence !== previousSequence + 1
      ) {
        return false;
      }
      if (
        typeof message.content !== 'string' ||
        !message.content.trim() ||
        message.content.length > 8_000
      ) {
        return false;
      }
      if (!Number.isFinite(Date.parse(message.observedAt))) return false;
      if (message.result !== null && !this.validResult(message.result)) {
        return false;
      }
      previousSequence = message.sequence;
    }
    return previousSequence === conversationRevision;
  }

  /**
   * 重新解析单条结构化结果，确保派生候选和原始持久化内容完全一致。
   * @param result - 用于重新解析单条结构化结果，确保派生候选和原始持久化内容完全一致的领域对象，包含 `candidateSummaries`、`nextActionLabel`、`planSha256`、`status` 字段。
   * @returns 满足重新解析单条结构化结果，确保派生候选和原始持久化内容完全一致约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private validResult(result: MediaCodexAgentResult) {
    const parsed = parseMediaCodexAgentResult({
      candidateSummaries: result.candidateSummaries,
      nextActionLabel: result.nextActionLabel,
      planSha256: result.planSha256,
      status: result.status,
      summary: result.summary,
    });
    return Boolean(parsed && canonicalJson(parsed) === canonicalJson(result));
  }
}
