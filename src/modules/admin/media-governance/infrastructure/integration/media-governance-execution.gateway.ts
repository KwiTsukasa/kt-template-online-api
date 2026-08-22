import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MEDIA_GOVERNANCE_EXECUTOR_ACTIONS,
  type buildMediaGovernanceExecutionEnvelope,
} from '@/modules/admin/media-governance/contract/media-governance-executor.contract';
import {
  MEDIA_GOVERNANCE_EXECUTOR_EVENT_TYPES,
  type MediaGovernanceExecutorEventDto,
} from '@/modules/admin/media-governance/contract/media-governance.dto';

export const MEDIA_GOVERNANCE_EXECUTION_GATEWAY = Symbol(
  'MEDIA_GOVERNANCE_EXECUTION_GATEWAY',
);

export type MediaGovernanceExecutionEnvelope = ReturnType<
  typeof buildMediaGovernanceExecutionEnvelope
>;

export type MediaGovernanceExecutionDispatch = {
  executionId: string;
  replayed: boolean;
  runId: string;
  sealedInputSha256: string;
  status: 'queued' | 'running';
};

export type MediaGovernanceExecutionControl = {
  command: 'cancel' | 'pause' | 'resume';
  controlId: string;
  replayed: boolean;
  runId: string;
  status: 'accepted';
};

export type MediaGovernanceExecutionStatus = {
  activeState: string;
  exitCode: number;
  result: string;
  runId: string;
  runnerId: null | string;
  sealedInputSha256: string;
  status: 'exited' | 'lost' | 'queued' | 'running';
  subState: string;
  taskId: string;
  manifestSha256?: string;
  pendingEvents?: MediaGovernanceExecutorEventDto[];
  terminalEvent?: MediaGovernanceExecutorEventDto;
};

export interface MediaGovernanceExecutionGateway {
  control(input: {
    command: 'cancel' | 'pause' | 'resume';
    controlId: string;
    runId: string;
    sealedInputSha256: string;
    taskId: string;
  }): Promise<MediaGovernanceExecutionControl>;
  dispatch(
    envelope: MediaGovernanceExecutionEnvelope,
  ): Promise<MediaGovernanceExecutionDispatch>;
  enabled(): boolean;
  status(input: {
    afterSequence: number;
    runId: string;
    sealedInputSha256: string;
    taskId: string;
  }): Promise<MediaGovernanceExecutionStatus>;
}

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const TERMINAL_EVENT_KEYS = new Set([
  'acceptance',
  'action',
  'evidenceSha256',
  'eventType',
  'manifest',
  'manifestSha256',
  'metadata',
  'observedAt',
  'payloadFiles',
  'progress',
  'runId',
  'sequence',
  'sourceHealth',
  'sourceHealthReason',
  'sourceId',
  'summary',
  'taskId',
  'taskRevision',
]);

/**
 * 校验 executor 从权威游标之后返回的连续非终态事件页，拒绝身份、字段或序号漂移。
 * @param value - 状态响应中的候选待补投事件集合。
 * @param input - 本次状态查询绑定的运行、任务与已确认序号。
 * @returns 通过字段闭包、运行身份和连续序号检查的事件数组。
 * @throws 当事件页超限、含终态、存在未知字段或身份与序号不连续时抛出。
 */
function parsePendingEvents(
  value: unknown,
  input: {
    afterSequence: number;
    runId: string;
    taskId: string;
  },
): MediaGovernanceExecutorEventDto[] {
  if (!Array.isArray(value) || value.length > 256) {
    throw new Error('media-governance-executor-identity-mismatch');
  }
  const pendingEvents: MediaGovernanceExecutorEventDto[] = [];
  value.forEach((candidate, index) => {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate)
    ) {
      throw new Error('media-governance-executor-identity-mismatch');
    }
    const event = candidate as Record<string, unknown>;
    const keysInvalid = Object.keys(event).some(
      (key) => !TERMINAL_EVENT_KEYS.has(key),
    );
    const eventType = String(event.eventType ?? '');
    const typeInvalid =
      !MEDIA_GOVERNANCE_EXECUTOR_EVENT_TYPES.includes(
        eventType as (typeof MEDIA_GOVERNANCE_EXECUTOR_EVENT_TYPES)[number],
      ) || ['run-failed', 'run-succeeded'].includes(eventType);
    const identityInvalid =
      !MEDIA_GOVERNANCE_EXECUTOR_ACTIONS.includes(
        event.action as (typeof MEDIA_GOVERNANCE_EXECUTOR_ACTIONS)[number],
      ) ||
      event.runId !== input.runId ||
      event.taskId !== input.taskId ||
      !Number.isSafeInteger(event.taskRevision) ||
      Number(event.taskRevision) < 1;
    const sequenceInvalid = event.sequence !== input.afterSequence + index + 1;
    const observationInvalid =
      typeof event.observedAt !== 'string' ||
      Number.isNaN(Date.parse(event.observedAt));
    const summaryInvalid =
      typeof event.summary !== 'string' ||
      event.summary.length < 1 ||
      event.summary.length > 400;
    const contractInvalid = keysInvalid || typeInvalid || identityInvalid;
    const contentInvalid =
      sequenceInvalid || observationInvalid || summaryInvalid;
    if (contractInvalid || contentInvalid) {
      throw new Error('media-governance-executor-identity-mismatch');
    }
    pendingEvents.push(event as unknown as MediaGovernanceExecutorEventDto);
  });
  return pendingEvents;
}

@Injectable()
export class MediaGovernanceExecutionGatewayClient implements MediaGovernanceExecutionGateway {
  constructor(private readonly config: ConfigService) {}

  /**
   * 按当前运行态启动执行器地址和共享密钥是否形成可用配置。
   * @returns 满足执行器地址和共享密钥是否形成可用配置约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  enabled() {
    try {
      return Boolean(this.baseUrl() && this.secret(false));
    } catch {
      return false;
    }
  }

  /**
   * 提交密封执行信封，并校验执行器返回的运行身份。
   * @param envelope - 用于`dispatch` 对应结果的领域对象，包含 `runId`、`sealedInputSha256` 字段。
   * @returns `dispatch` 对应。
   * @throws 当 `!baseUrl` 成立时拒绝当前输入并抛出 `Error`；当 `!response.ok || Buffer.byteLength(text) > MAX_RESPONSE_BYTES` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `result.runId !== envelope.runId || result.sealedInputSha256 !== envelop…` 成立时拒绝当前输入并抛出 `Error`。
   */
  async dispatch(envelope: MediaGovernanceExecutionEnvelope) {
    const baseUrl = this.baseUrl();
    if (!baseUrl) throw new Error('media-governance-executor-not-configured');
    const response = await fetch(`${baseUrl}/v1/dispatch`, {
      body: JSON.stringify(envelope),
      headers: {
        'content-type': 'application/json',
        'x-kt-media-executor-secret': this.secret(true),
      },
      method: 'POST',
      signal: AbortSignal.timeout(this.timeoutMs()),
    });
    const text = await response.text();
    if (!response.ok || Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
      throw new Error('media-governance-executor-request-failed');
    }
    const result = this.parseDispatch(text);
    if (
      result.runId !== envelope.runId ||
      result.sealedInputSha256 !== envelope.sealedInputSha256
    ) {
      throw new Error('media-governance-executor-identity-mismatch');
    }
    return result;
  }

  /**
   * 向指定运行发送幂等控制命令并校验回执身份。
   * @param input - 用于向指定运行发送幂等控制命令并校验回执身份的结构化输入，包含 `command`、`controlId`、`runId` 字段。
   * @returns 向指定运行发送幂等控制命令并校验回执身份。
   * @throws 当 `!baseUrl` 成立时拒绝当前输入并抛出 `Error`；当 `!response.ok || Buffer.byteLength(text) > MAX_RESPONSE_BYTES` 成立时拒绝当前输入并抛出 `Error`；当 `JSON.parse` 调用失败时拒绝当前输入并抛出 `Error`；
   *   当 `!value || typeof value !== 'object' || Array.isArray(value)` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `result.command !== input.command || result.controlId !== input.controlI…` 成立时拒绝当前输入并抛出 `Error`。
   */
  async control(input: {
    command: 'cancel' | 'pause' | 'resume';
    controlId: string;
    runId: string;
    sealedInputSha256: string;
    taskId: string;
  }) {
    const baseUrl = this.baseUrl();
    if (!baseUrl) throw new Error('media-governance-executor-not-configured');
    const response = await fetch(`${baseUrl}/v1/control`, {
      body: JSON.stringify(input),
      headers: {
        'content-type': 'application/json',
        'x-kt-media-executor-secret': this.secret(true),
      },
      method: 'POST',
      signal: AbortSignal.timeout(this.timeoutMs()),
    });
    const text = await response.text();
    if (!response.ok || Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
      throw new Error('media-governance-executor-control-failed');
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error('media-governance-executor-response-invalid');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('media-governance-executor-response-invalid');
    }
    const result = value as Record<string, unknown>;
    if (
      result.command !== input.command ||
      result.controlId !== input.controlId ||
      result.runId !== input.runId ||
      result.status !== 'accepted' ||
      typeof result.replayed !== 'boolean'
    ) {
      throw new Error('media-governance-executor-identity-mismatch');
    }
    return result as MediaGovernanceExecutionControl;
  }

  /**
   * 查询运行状态，并校验终态事件与清单摘要的完整性。
   * @param input - 用于状态的结构化输入，包含 `runId`、`taskId`、`sealedInputSha256` 字段。
   * @returns 状态。
   * @throws 当 `!baseUrl` 成立时拒绝当前输入并抛出 `Error`；当 `!response.ok || Buffer.byteLength(text) > MAX_RESPONSE_BYTES` 成立时拒绝当前输入并抛出 `Error`；当 `JSON.parse` 调用失败时拒绝当前输入并抛出 `Error`；
   *   当 `!value || typeof value !== 'object' || Array.isArray(value)` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `result.runId !== input.runId || result.taskId !== input.taskId || resul…` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `typeof result.runnerId !== 'string' || !SAFE_ID_PATTERN.test(result.run…` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `typeof result.activeState !== 'string' || typeof result.subState !== 's…` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `!DIGEST_PATTERN.test(String(result.manifestSha256 ?? '')) || !terminal…` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `!MEDIA_GOVERNANCE_EXECUTOR_ACTIONS.includes( terminal.action as (typeof…` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `typeof terminal.observedAt !== 'string' || Number.isNaN(Date.parse(term…` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `!Number.isSafeInteger(terminal.sequence) || Number(terminal.sequence) <…` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `typeof terminal.summary !== 'string' || terminal.summary.length < 1 ||…` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `result.manifestSha256 !== undefined || terminalEvent !== undefined` 成立时拒绝当前输入并抛出 `Error`。
   */
  async status(input: {
    afterSequence: number;
    runId: string;
    sealedInputSha256: string;
    taskId: string;
  }) {
    const baseUrl = this.baseUrl();
    if (!baseUrl) throw new Error('media-governance-executor-not-configured');
    const response = await fetch(`${baseUrl}/v1/status`, {
      body: JSON.stringify(input),
      headers: {
        'content-type': 'application/json',
        'x-kt-media-executor-secret': this.secret(true),
      },
      method: 'POST',
      signal: AbortSignal.timeout(this.timeoutMs()),
    });
    const text = await response.text();
    if (!response.ok || Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
      throw new Error('media-governance-executor-status-failed');
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error('media-governance-executor-response-invalid');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('media-governance-executor-response-invalid');
    }
    const result = value as Record<string, unknown>;
    const terminalEvent = result.terminalEvent;
    let terminalKeys = '';
    if (
      terminalEvent &&
      typeof terminalEvent === 'object' &&
      !Array.isArray(terminalEvent)
    ) {
      terminalKeys = Object.keys(terminalEvent).sort().join('\0');
    }
    const terminal = terminalEvent as Record<string, unknown> | undefined;
    const terminalStatus = ['exited', 'lost'].includes(String(result.status));
    let pendingEvents: MediaGovernanceExecutorEventDto[] = [];
    if (terminalStatus) {
      pendingEvents = parsePendingEvents(result.pendingEvents, input);
    } else if (result.pendingEvents !== undefined) {
      throw new Error('media-governance-executor-identity-mismatch');
    }
    const terminalEventType = String(terminal?.eventType ?? '');
    let terminalShapeInvalid: boolean;
    if (terminalEventType === 'run-failed') {
      terminalShapeInvalid =
        terminalKeys !==
        'action\0eventType\0observedAt\0runId\0sequence\0summary\0taskId\0taskRevision';
    } else {
      terminalShapeInvalid =
        terminalEventType !== 'run-succeeded' ||
        !DIGEST_PATTERN.test(String(terminal?.evidenceSha256 ?? '')) ||
        Object.keys(terminal ?? {}).some(
          (key) => !TERMINAL_EVENT_KEYS.has(key),
        );
    }
    if (
      result.runId !== input.runId ||
      result.taskId !== input.taskId ||
      result.sealedInputSha256 !== input.sealedInputSha256 ||
      !['exited', 'lost', 'queued', 'running'].includes(String(result.status))
    ) {
      throw new Error('media-governance-executor-identity-mismatch');
    }
    if (result.runnerId !== null) {
      if (
        typeof result.runnerId !== 'string' ||
        !SAFE_ID_PATTERN.test(result.runnerId)
      ) {
        throw new Error('media-governance-executor-identity-mismatch');
      }
    }
    if (
      typeof result.activeState !== 'string' ||
      typeof result.subState !== 'string' ||
      typeof result.result !== 'string' ||
      !Number.isSafeInteger(result.exitCode)
    ) {
      throw new Error('media-governance-executor-identity-mismatch');
    }
    if (terminalStatus) {
      if (
        !DIGEST_PATTERN.test(String(result.manifestSha256 ?? '')) ||
        !terminal ||
        terminalShapeInvalid
      ) {
        throw new Error('media-governance-executor-identity-mismatch');
      }
      if (
        !MEDIA_GOVERNANCE_EXECUTOR_ACTIONS.includes(
          terminal.action as (typeof MEDIA_GOVERNANCE_EXECUTOR_ACTIONS)[number],
        ) ||
        terminal.runId !== input.runId ||
        terminal.taskId !== input.taskId
      ) {
        throw new Error('media-governance-executor-identity-mismatch');
      }
      if (
        typeof terminal.observedAt !== 'string' ||
        Number.isNaN(Date.parse(terminal.observedAt))
      ) {
        throw new Error('media-governance-executor-identity-mismatch');
      }
      if (
        !Number.isSafeInteger(terminal.sequence) ||
        Number(terminal.sequence) < 1 ||
        !Number.isSafeInteger(terminal.taskRevision) ||
        Number(terminal.taskRevision) < 1
      ) {
        throw new Error('media-governance-executor-identity-mismatch');
      }
      if (
        typeof terminal.summary !== 'string' ||
        terminal.summary.length < 1 ||
        terminal.summary.length > 400
      ) {
        throw new Error('media-governance-executor-identity-mismatch');
      }
    } else if (
      result.manifestSha256 !== undefined ||
      terminalEvent !== undefined
    ) {
      throw new Error('media-governance-executor-identity-mismatch');
    }
    return {
      ...result,
      pendingEvents,
    } as MediaGovernanceExecutionStatus;
  }

  /**
   * 从配置读取并规范化执行器基础地址，仅接受私网主机与固定端口。
   * @returns 当前状态对应的从配置读取并规范化执行器基础地址，仅接受私网主机与固定端口，取值为 `''`。
   * @throws 当 `url.protocol !== 'http:' || !allowedHost || url.port !== '48088' || url…` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `url.password || (url.pathname !== '/' && url.pathname !== '') || url.se…` 成立时拒绝当前输入并抛出 `Error`。
   */
  private baseUrl() {
    const value = String(
      this.config.get<string>('MEDIA_GOVERNANCE_EXECUTOR_BASE_URL') ?? '',
    ).trim();
    if (!value) return '';
    const url = new URL(value);
    const allowedHost =
      url.hostname === '127.0.0.1' ||
      url.hostname === 'localhost' ||
      /^172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(url.hostname);
    if (
      url.protocol !== 'http:' ||
      !allowedHost ||
      url.port !== '48088' ||
      url.username
    ) {
      throw new Error('media-governance-executor-url-invalid');
    }
    if (
      url.password ||
      (url.pathname !== '/' && url.pathname !== '') ||
      url.search ||
      url.hash
    ) {
      throw new Error('media-governance-executor-url-invalid');
    }
    return url.origin;
  }

  /**
   * 解析执行排队响应并验证运行标识、摘要和状态。
   * @param text - 决定执行排队响应并验证运行标识、摘要和状态内容、边界或目标的 `text` 值。
   * @returns 执行排队响应并验证运行标识、摘要和状态。
   * @throws 当 `JSON.parse` 调用失败时拒绝当前输入并抛出 `Error`；当 `!value || typeof value !== 'object' || Array.isArray(value)` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `typeof result.executionId !== 'string' || !SAFE_ID_PATTERN.test(result.…` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `typeof result.sealedInputSha256 !== 'string' || !DIGEST_PATTERN.test(re…` 成立时拒绝当前输入并抛出 `Error`。
   */
  private parseDispatch(text: string): MediaGovernanceExecutionDispatch {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error('media-governance-executor-response-invalid');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('media-governance-executor-response-invalid');
    }
    const result = value as Record<string, unknown>;
    if (
      typeof result.executionId !== 'string' ||
      !SAFE_ID_PATTERN.test(result.executionId) ||
      typeof result.runId !== 'string' ||
      !SAFE_ID_PATTERN.test(result.runId)
    ) {
      throw new Error('media-governance-executor-response-invalid');
    }
    if (
      typeof result.sealedInputSha256 !== 'string' ||
      !DIGEST_PATTERN.test(result.sealedInputSha256) ||
      typeof result.replayed !== 'boolean' ||
      !['queued', 'running'].includes(String(result.status))
    ) {
      throw new Error('media-governance-executor-response-invalid');
    }
    return result as MediaGovernanceExecutionDispatch;
  }

  /**
   * 读取并校验执行器内部密钥，可选模式下以空值表示未配置。
   * @param required - 决定是否启用“required”分支的布尔选项。
   * @returns 当前状态对应的并校验执行器内部密钥，可选模式下以空值表示未配置，取值为 `''`。
   * @throws 当 `value.length < 32 || value.length > 512` 成立时拒绝当前输入并抛出 `Error`。
   */
  private secret(required: boolean) {
    const value = String(
      this.config.get<string>('MEDIA_GOVERNANCE_EXECUTOR_INTERNAL_SECRET') ??
        '',
    ).trim();
    if (value.length < 32 || value.length > 512) {
      if (!required) return '';
      throw new Error('media-governance-executor-secret-invalid');
    }
    return value;
  }

  /**
   * 将执行器请求超时限制在允许区间，非法配置回退为二十秒。
   * @returns 当前状态对应的将执行器请求超时限制在允许区间，非法配置回退为二十秒，取值为 `20_000`。
   */
  private timeoutMs() {
    const value = Number(
      this.config.get<string>('MEDIA_GOVERNANCE_EXECUTOR_TIMEOUT_MS') ?? 20_000,
    );
    if (Number.isSafeInteger(value) && value >= 1_000 && value <= 120_000) {
      return value;
    }
    return 20_000;
  }
}
