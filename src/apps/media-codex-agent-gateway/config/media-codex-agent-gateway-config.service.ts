import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEFAULT_PORT = 48087;
const DEFAULT_TIMEOUT_MS = 20_000;

@Injectable()
export class MediaCodexAgentGatewayConfigService {
  constructor(private readonly config: ConfigService) {}

  apiBaseUrl() {
    const value =
      this.text('MEDIA_CODEX_AGENT_API_BASE_URL') || 'http://127.0.0.1:48085';
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      throw new Error('media-codex-agent-api-url-invalid');
    }
    return url.toString().replace(/\/$/, '');
  }

  appServerSocketPath() {
    return this.absolutePath(
      'MEDIA_CODEX_AGENT_APP_SERVER_SOCKET',
      '/run/kt-codex-agent/app-server.sock',
      '/run/kt-codex-agent/',
    );
  }

  cleanCwd() {
    return this.absolutePath(
      'MEDIA_CODEX_AGENT_CLEAN_CWD',
      '/vol1/docker/kt-codex-agent/runtime',
      '/vol1/docker/kt-codex-agent/',
    );
  }

  evidenceRoot() {
    return this.absolutePath(
      'MEDIA_CODEX_AGENT_EVIDENCE_ROOT',
      '/vol1/docker/kt-codex/artifacts/automation/media',
      '/vol1/docker/kt-codex/artifacts/automation/media',
    );
  }

  host() {
    const value = this.text('MEDIA_CODEX_AGENT_HOST') || '127.0.0.1';
    if (!/^(?:127\.0\.0\.1|::1|10\.66\.66\.2|172\.21\.0\.1)$/.test(value)) {
      throw new Error('media-codex-agent-host-invalid');
    }
    return value;
  }

  internalSecret() {
    const value = this.text('MEDIA_CODEX_AGENT_INTERNAL_SECRET');
    if (value.length < 32 || value.length > 512) {
      throw new Error('media-codex-agent-internal-secret-invalid');
    }
    return value;
  }

  port() {
    return this.positiveInteger('MEDIA_CODEX_AGENT_PORT', DEFAULT_PORT, 65_535);
  }

  stateRoot() {
    return this.absolutePath(
      'MEDIA_CODEX_AGENT_STATE_ROOT',
      '/vol1/docker/kt-codex-agent/state',
      '/vol1/docker/kt-codex-agent/',
    );
  }

  timeoutMs() {
    return this.positiveInteger(
      'MEDIA_CODEX_AGENT_TIMEOUT_MS',
      DEFAULT_TIMEOUT_MS,
      120_000,
    );
  }

  private absolutePath(key: string, fallback: string, prefix: string) {
    const value = this.text(key) || fallback;
    if (
      !value.startsWith(prefix) ||
      value.includes('\\') ||
      value.includes('\0') ||
      value.includes('/../') ||
      value.endsWith('/..')
    ) {
      throw new Error(`media-codex-agent-path-invalid:${key}`);
    }
    return value.replace(/\/$/, '');
  }

  private positiveInteger(key: string, fallback: number, maximum: number) {
    const value = Number(this.text(key) || fallback);
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw new Error(`media-codex-agent-number-invalid:${key}`);
    }
    return value;
  }

  private text(key: string) {
    return String(this.config.get<string>(key) ?? '').trim();
  }
}
