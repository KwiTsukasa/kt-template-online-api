import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MEDIA_GOVERNANCE_EXECUTOR_ACTIONS,
  type buildMediaGovernanceExecutionEnvelope,
} from '@/modules/admin/media-governance/contract/media-governance-executor.contract';
import type { MediaGovernanceExecutorEventDto } from '@/modules/admin/media-governance/contract/media-governance.dto';

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
    runId: string;
    sealedInputSha256: string;
    taskId: string;
  }): Promise<MediaGovernanceExecutionStatus>;
}

const MAX_RESPONSE_BYTES = 32 * 1024;
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

@Injectable()
export class MediaGovernanceExecutionGatewayClient implements MediaGovernanceExecutionGateway {
  constructor(private readonly config: ConfigService) {}

  /** 检查执行器地址和共享密钥是否形成可用配置。 */
  enabled() {
    try {
      return Boolean(this.baseUrl() && this.secret(false));
    } catch {
      return false;
    }
  }

  /** 提交密封执行信封，并校验执行器返回的运行身份。 */
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

  /** 向指定运行发送幂等控制命令并校验回执身份。 */
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

  /** 查询运行状态，并校验终态事件与清单摘要的完整性。 */
  async status(input: {
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
    return result as MediaGovernanceExecutionStatus;
  }

  /** 规范化仅允许私网固定端口的执行器基础地址。 */
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

  /** 解析执行排队响应并验证运行标识、摘要和状态。 */
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

  /** 读取并校验执行器内部密钥，可选模式下以空值表示未配置。 */
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

  /** 将执行器请求超时限制在允许区间，非法配置回退为二十秒。 */
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
