import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEFAULT_PORT = 48087;
const DEFAULT_TIMEOUT_MS = 20_000;

@Injectable()
export class LlmCodexGatewayConfigService {
  constructor(private readonly config: ConfigService) {}

  /**
   * 返回限定在受管运行目录内的 App Server Unix Socket 路径。
   * @returns 返回 `absolutePath` 的调用结果，其业务含义为限定在受管运行目录内的 App Server Unix Socket 路径。
   */
  appServerSocketPath() {
    return this.absolutePath(
      'LLM_CODEX_GATEWAY_APP_SERVER_SOCKET',
      '/run/kt-codex-agent/app-server.sock',
      '/run/kt-codex-agent/',
    );
  }

  /**
   * 返回通用 LLM Codex 对话使用的受管只读工作目录。
   * @returns 位于受管 Codex 根目录内的绝对路径。
   */
  cleanCwd() {
    return this.absolutePath(
      'LLM_CODEX_CHAT_CWD',
      '/vol1/docker/kt-codex-agent/runtime',
      '/vol1/docker/kt-codex-agent/',
    );
  }

  /**
   * 返回通用大模型对话使用的只读 Codex 工作目录，并限制在 KT 或受管 Agent 根内。
   * @returns 已规范化的绝对工作目录。
   * @throws 路径不是绝对路径、包含回退段或越出允许前缀时抛出错误。
   */
  chatCwd() {
    const value = this.cleanCwd();
    if (
      !value.startsWith('/') ||
      value.includes('\\') ||
      value.includes('\0') ||
      value.includes('/../') ||
      value.endsWith('/..')
    ) {
      throw new Error('llm-codex-chat-cwd-invalid');
    }
    const allowed =
      value.startsWith('/home/yemu2/KT') ||
      value.startsWith('/vol1/docker/kt-codex-agent/');
    if (!allowed) throw new Error('llm-codex-chat-cwd-invalid');
    return value.replace(/\/$/, '');
  }

  /**
   * 读取网关监听地址，并限制为已批准的本机或私有桥接地址。
   * @returns 宿主。
   * @throws 当 `!/^(?:127\.0\.0\.1|::1|10\.66\.66\.2|172\.21\.0\.1)$/.test(value)` 成立时拒绝当前输入并抛出 `Error`。
   */
  host() {
    const value = this.text('LLM_CODEX_GATEWAY_HOST') || '127.0.0.1';
    if (!/^(?:127\.0\.0\.1|::1|10\.66\.66\.2|172\.21\.0\.1)$/.test(value)) {
      throw new Error('llm-codex-gateway-host-invalid');
    }
    return value;
  }

  /**
   * 读取当前 LLM Codex 网关统一内部密钥。
   * @returns 长度符合内部认证边界的 Codex 对话密钥。
   * @throws 密钥长度小于 32 或大于 512 时抛出错误。
   */
  llmInternalSecret() {
    const value = this.text('LLM_CODEX_GATEWAY_INTERNAL_SECRET');
    if (value.length < 32 || value.length > 512) {
      throw new Error('llm-codex-gateway-internal-secret-invalid');
    }
    return value;
  }

  /**
   * 返回网关监听端口，并校验其处于有效端口范围。
   * @returns 返回 `positiveInteger` 的调用结果，其业务含义为网关监听端口，并校验其处于有效端口范围。
   */
  port() {
    return this.positiveInteger('LLM_CODEX_GATEWAY_PORT', DEFAULT_PORT, 65_535);
  }

  /**
   * 返回外部依赖请求超时，并限制其为正整数和允许上限。
   * @returns 返回 `positiveInteger` 的调用结果，其业务含义为外部依赖请求超时，并限制其为正整数和允许上限。
   */
  timeoutMs() {
    return this.positiveInteger(
      'LLM_CODEX_GATEWAY_TIMEOUT_MS',
      DEFAULT_TIMEOUT_MS,
      120_000,
    );
  }

  /**
   * 读取绝对路径配置，并确保结果始终位于指定受管前缀内。
   * @param key - 用于读取或更新absolute路径的稳定键。
   * @param fallback - 主值缺失、为空或不合法时采用的兜底结果。
   * @param prefix - 决定absolute路径内容、边界或目标的 `prefix` 值。
   * @returns absolute路径。
   * @throws 当 `!value.startsWith(prefix) || value.includes('\\') || value.includes('\0…` 成立时拒绝当前输入并抛出 `Error`。
   */
  private absolutePath(key: string, fallback: string, prefix: string) {
    const value = this.text(key) || fallback;
    if (
      !value.startsWith(prefix) ||
      value.includes('\\') ||
      value.includes('\0') ||
      value.includes('/../') ||
      value.endsWith('/..')
    ) {
      throw new Error(`llm-codex-gateway-path-invalid:${key}`);
    }
    return value.replace(/\/$/, '');
  }

  /**
   * 读取正整数配置，并按调用方给定的最大值执行范围校验。
   * @param key - 用于读取或更新positive整数的稳定键。
   * @param fallback - 主值缺失、为空或不合法时采用的兜底结果。
   * @param maximum - 决定positive整数内容、边界或目标的 `maximum` 值。
   * @returns positive整数。
   * @throws 当 `!Number.isSafeInteger(value) || value < 1 || value > maximum` 成立时拒绝当前输入并抛出 `Error`。
   */
  private positiveInteger(key: string, fallback: number, maximum: number) {
    const value = Number(this.text(key) || fallback);
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw new Error(`llm-codex-gateway-number-invalid:${key}`);
    }
    return value;
  }

  /**
   * 将配置项规范为去除首尾空白的字符串。
   * @param key - 用于读取或更新将配置项规范为去除首尾空白的字符串的稳定键。
   * @returns 将配置项规范为去除首尾空白的字符串。
   */
  private text(key: string) {
    return String(this.config.get<string>(key) ?? '').trim();
  }
}
