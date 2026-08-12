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
  type MediaCodexAgentResult,
  type MediaCodexAgentSafeSession,
} from '../domain/media-codex-agent.contract';

export interface MediaCodexAgentSessionRecord {
  acceptedPlanSha256: null | string;
  capsule: MediaCodexAgentBoundaryCapsule;
  checkpointSha256: string;
  consumedReplayKeys: string[];
  currentReplayKey: string;
  lastEventSequence: number;
  lastHeartbeatAt: string;
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

  load(taskId: string): MediaCodexAgentSessionRecord | null {
    const file = this.sessionPath(taskId);
    if (!existsSync(file)) return null;
    if (lstatSync(file).isSymbolicLink()) {
      throw new Error('agent-session-symbolic-link');
    }
    const record = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    return this.validateRecord(record, taskId);
  }

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

  project(record: MediaCodexAgentSessionRecord, replayed: boolean) {
    return {
      capsuleSha256: record.capsule.capsuleSha256,
      checkpointSha256: record.checkpointSha256,
      currentUnitId: record.capsule.currentUnitId,
      lastEventSequence: record.lastEventSequence,
      lastHeartbeatAt: record.lastHeartbeatAt,
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

  private sessionPath(taskId: string) {
    if (!SAFE_ID_PATTERN.test(taskId)) throw new Error('task-id-invalid');
    return path.posix.join(this.sessionsRoot, `${taskId}.json`);
  }

  private validateRecord(
    value: unknown,
    expectedTaskId: string,
  ): MediaCodexAgentSessionRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('agent-session-record-invalid');
    }
    const record = value as Omit<
      MediaCodexAgentSessionRecord,
      'acceptedPlanSha256' | 'lastEventSequence' | 'result'
    > & {
      acceptedPlanSha256?: null | string;
      lastEventSequence?: number;
      result?: MediaCodexAgentResult | null;
    };
    const { checkpointSha256, ...unsigned } = record;
    const parsedResult = record.result
      ? parseMediaCodexAgentResult({
          candidateSummaries: record.result.candidateSummaries,
          nextActionLabel: record.result.nextActionLabel,
          planSha256: record.result.planSha256,
          status: record.result.status,
          summary: record.result.summary,
        })
      : null;
    if (
      record.schemaVersion !== MEDIA_CODEX_AGENT_SCHEMA_VERSION ||
      record.taskId !== expectedTaskId ||
      !SAFE_ID_PATTERN.test(record.threadId) ||
      !Number.isSafeInteger(record.taskRevision) ||
      record.taskRevision < 1 ||
      !['active', 'blocked', 'closed'].includes(record.status) ||
      (record.terminalKind !== undefined &&
        record.terminalKind !== null &&
        !['completed', 'failed', 'interrupted'].includes(
          record.terminalKind,
        )) ||
      !Array.isArray(record.consumedReplayKeys) ||
      record.consumedReplayKeys.length > 64 ||
      record.consumedReplayKeys.some((key) => !SAFE_ID_PATTERN.test(key)) ||
      !SAFE_ID_PATTERN.test(record.currentReplayKey) ||
      (record.lastEventSequence !== undefined &&
        (!Number.isSafeInteger(record.lastEventSequence) ||
          record.lastEventSequence < 0)) ||
      (record.turnId !== null && !SAFE_ID_PATTERN.test(record.turnId)) ||
      (record.acceptedPlanSha256 !== undefined &&
        record.acceptedPlanSha256 !== null &&
        !SHA256_PATTERN.test(record.acceptedPlanSha256)) ||
      (record.result !== undefined &&
        record.result !== null &&
        (!parsedResult ||
          canonicalJson(parsedResult) !== canonicalJson(record.result))) ||
      !SHA256_PATTERN.test(record.capsule?.capsuleSha256 ?? '') ||
      checkpointSha256 !== sha256Json(unsigned)
    ) {
      throw new Error('agent-session-record-invalid');
    }
    return {
      ...record,
      acceptedPlanSha256: record.acceptedPlanSha256 ?? null,
      lastEventSequence: record.lastEventSequence ?? 0,
      result: record.result ?? null,
      terminalKind: record.terminalKind ?? null,
    } as MediaCodexAgentSessionRecord;
  }
}
