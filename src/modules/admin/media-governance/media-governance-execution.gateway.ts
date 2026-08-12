import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { buildMediaGovernanceExecutionEnvelope } from './media-governance-executor.contract';

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

@Injectable()
export class MediaGovernanceExecutionGatewayClient implements MediaGovernanceExecutionGateway {
  constructor(private readonly config: ConfigService) {}

  enabled() {
    try {
      return Boolean(this.baseUrl() && this.secret(false));
    } catch {
      return false;
    }
  }

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
    if (
      result.runId !== input.runId ||
      result.taskId !== input.taskId ||
      result.sealedInputSha256 !== input.sealedInputSha256 ||
      !['exited', 'lost', 'queued', 'running'].includes(
        String(result.status),
      ) ||
      (result.runnerId !== null &&
        (typeof result.runnerId !== 'string' ||
          !SAFE_ID_PATTERN.test(result.runnerId))) ||
      typeof result.activeState !== 'string' ||
      typeof result.subState !== 'string' ||
      typeof result.result !== 'string' ||
      !Number.isSafeInteger(result.exitCode)
    ) {
      throw new Error('media-governance-executor-identity-mismatch');
    }
    return result as MediaGovernanceExecutionStatus;
  }

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
      url.username ||
      url.password ||
      (url.pathname !== '/' && url.pathname !== '') ||
      url.search ||
      url.hash
    ) {
      throw new Error('media-governance-executor-url-invalid');
    }
    return url.origin;
  }

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
      !SAFE_ID_PATTERN.test(result.runId) ||
      typeof result.sealedInputSha256 !== 'string' ||
      !DIGEST_PATTERN.test(result.sealedInputSha256) ||
      typeof result.replayed !== 'boolean' ||
      !['queued', 'running'].includes(String(result.status))
    ) {
      throw new Error('media-governance-executor-response-invalid');
    }
    return result as MediaGovernanceExecutionDispatch;
  }

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

  private timeoutMs() {
    const value = Number(
      this.config.get<string>('MEDIA_GOVERNANCE_EXECUTOR_TIMEOUT_MS') ?? 20_000,
    );
    return Number.isSafeInteger(value) && value >= 1_000 && value <= 120_000
      ? value
      : 20_000;
  }
}
