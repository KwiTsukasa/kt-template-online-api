import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEFAULT_PORT = 48087;
const DEFAULT_TIMEOUT_MS = 20_000;

@Injectable()
export class MediaCodexAgentGatewayConfigService {
  constructor(private readonly config: ConfigService) {}

  /** 读取并校验媒体治理 API 的 HTTP 基础地址，禁止携带认证信息。 */
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

  /** 返回限定在受管运行目录内的 App Server Unix Socket 路径。 */
  appServerSocketPath() {
    return this.absolutePath(
      'MEDIA_CODEX_AGENT_APP_SERVER_SOCKET',
      '/run/kt-codex-agent/app-server.sock',
      '/run/kt-codex-agent/',
    );
  }

  /** 返回供 CodexAgent 使用的受管干净工作目录。 */
  cleanCwd() {
    return this.absolutePath(
      'MEDIA_CODEX_AGENT_CLEAN_CWD',
      '/vol1/docker/kt-codex-agent/runtime',
      '/vol1/docker/kt-codex-agent/',
    );
  }

  /** 返回当前媒体任务证据的受管根目录。 */
  evidenceRoot() {
    return this.absolutePath(
      'MEDIA_CODEX_AGENT_EVIDENCE_ROOT',
      '/vol1/docker/kt-codex/artifacts/automation/media',
      '/vol1/docker/kt-codex/artifacts/automation/media',
    );
  }

  /** 读取网关监听地址，并限制为已批准的本机或私有桥接地址。 */
  host() {
    const value = this.text('MEDIA_CODEX_AGENT_HOST') || '127.0.0.1';
    if (!/^(?:127\.0\.0\.1|::1|10\.66\.66\.2|172\.21\.0\.1)$/.test(value)) {
      throw new Error('media-codex-agent-host-invalid');
    }
    return value;
  }

  /** 读取内部调用密钥，并拒绝长度不符合边界要求的配置。 */
  internalSecret() {
    const value = this.text('MEDIA_CODEX_AGENT_INTERNAL_SECRET');
    if (value.length < 32 || value.length > 512) {
      throw new Error('media-codex-agent-internal-secret-invalid');
    }
    return value;
  }

  /** 返回网关监听端口，并校验其处于有效端口范围。 */
  port() {
    return this.positiveInteger('MEDIA_CODEX_AGENT_PORT', DEFAULT_PORT, 65_535);
  }

  /** 返回持久化会话状态的受管根目录。 */
  stateRoot() {
    return this.absolutePath(
      'MEDIA_CODEX_AGENT_STATE_ROOT',
      '/vol1/docker/kt-codex-agent/state',
      '/vol1/docker/kt-codex-agent/',
    );
  }

  /** 返回外部依赖请求超时，并限制其为正整数和允许上限。 */
  timeoutMs() {
    return this.positiveInteger(
      'MEDIA_CODEX_AGENT_TIMEOUT_MS',
      DEFAULT_TIMEOUT_MS,
      120_000,
    );
  }

  /** 读取绝对路径配置，并确保结果始终位于指定受管前缀内。 */
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

  /** 读取正整数配置，并按调用方给定的最大值执行范围校验。 */
  private positiveInteger(key: string, fallback: number, maximum: number) {
    const value = Number(this.text(key) || fallback);
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw new Error(`media-codex-agent-number-invalid:${key}`);
    }
    return value;
  }

  /** 将配置项规范为去除首尾空白的字符串。 */
  private text(key: string) {
    return String(this.config.get<string>(key) ?? '').trim();
  }
}
