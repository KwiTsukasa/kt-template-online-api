import { ConfigService } from '@nestjs/config';
import { Injectable } from '@nestjs/common';
import axios from 'axios';
import type { Readable } from 'node:stream';
import type {
  LlmAdapterConfig,
  LlmModelItem,
  LlmNormalizedStreamEvent,
  LlmProvider,
  LlmStreamRequest,
} from '../../contract/llm.types';
import { LLM_CODEX_INTERNAL_HEADER } from '@/apps/llm-codex-gateway/domain/llm-codex-runtime.contract';
import { parseSseStream } from './llm-sse';
import {
  LlmModelDiscoveryError,
  LlmProviderAdapter,
  normalizeLlmModelItems,
} from './llm-provider.adapter';

const REQUEST_TIMEOUT_MS = 120_000;
const MODEL_DISCOVERY_TIMEOUT_MS = 15_000;
const MODEL_RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024;

@Injectable()
export class CodexGatewayAdapter extends LlmProviderAdapter {
  constructor(private readonly configService: ConfigService) {
    super();
  }

  /**
   * 使用既有内部认证头从私有 Codex gateway 实时读取模型目录。
   * @param config - 含部署固定 gateway Base URL 的运行配置。
   * @returns 去空并按 ID 去重的 gateway 模型目录。
   * @throws {LlmModelDiscoveryError} 请求失败、响应协议非法或目录为空时抛出安全错误。
   */
  async fetchModels(config: LlmAdapterConfig): Promise<LlmModelItem[]> {
    const signal = AbortSignal.timeout(MODEL_DISCOVERY_TIMEOUT_MS);
    const secret = this.internalSecret();
    let payload: unknown;
    try {
      const response = await axios.get<unknown>(
        `${config.baseUrl.replace(/\/+$/, '')}/models`,
        {
          headers: {
            Accept: 'application/json',
            [LLM_CODEX_INTERNAL_HEADER]: secret,
          },
          maxContentLength: MODEL_RESPONSE_LIMIT_BYTES,
          maxRedirects: 0,
          responseType: 'json',
          signal,
          timeout: MODEL_DISCOVERY_TIMEOUT_MS,
        },
      );
      payload = response.data;
    } catch (error) {
      this.throwModelRequestError(error, signal);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new LlmModelDiscoveryError('本地 Codex 实时模型响应协议不合法');
    }
    return normalizeLlmModelItems(
      (payload as Record<string, unknown>).items,
      '本地 Codex 实时模型响应协议不合法',
    );
  }

  /**
   * 判断当前供应商是否通过私有 Codex App Server gateway。
   * @param provider - 当前连接声明的供应商。
   * @returns Codex 时返回 true。
   */
  supports(provider: LlmProvider): boolean {
    return provider === 'codex';
  }

  /**
   * 请求私有 Codex gateway 流并转发其已归一化事件。
   * @param request - 当前模型、消息、线程标识和取消信号。
   * @returns 依次产出 gateway start、增量和 done 事件的异步流。
   * @throws 网关密钥缺失、请求失败或事件非法时抛出错误。
   */
  async *stream(
    request: LlmStreamRequest,
  ): AsyncGenerator<LlmNormalizedStreamEvent> {
    if (request.signal.aborted) throw new Error('llm-stream-aborted');
    const secret = this.internalSecret();
    const body: Record<string, unknown> = {
      clientMessageId: request.clientMessageId,
      model: request.model,
      prompt: this.latestUserMessage(request),
      threadId: request.providerThreadId,
    };
    if (request.reasoningEffort) {
      body.reasoningEffort = request.reasoningEffort;
    }
    if (request.serviceTier) body.serviceTier = request.serviceTier;
    let upstream: Readable;
    try {
      const response = await axios.post<Readable>(
        `${request.config.baseUrl.replace(/\/+$/, '')}/chat/stream`,
        body,
        {
          headers: {
            Accept: 'text/event-stream',
            'Content-Type': 'application/json',
            [LLM_CODEX_INTERNAL_HEADER]: secret,
          },
          maxRedirects: 0,
          responseType: 'stream',
          signal: request.signal,
          timeout: REQUEST_TIMEOUT_MS,
        },
      );
      upstream = response.data;
    } catch (error) {
      if (request.signal.aborted) throw new Error('llm-stream-aborted');
      if (axios.isAxiosError(error) && error.response?.status) {
        throw new Error(
          `本地 Codex gateway 连接失败（HTTP ${error.response.status}）`,
        );
      }
      throw new Error('本地 Codex gateway 连接失败');
    }
    let receivedDone = false;
    let receivedStart = false;
    try {
      for await (const frame of parseSseStream(upstream, request.signal)) {
        const event = this.parseEvent(frame.event, frame.data);
        if (event.type === 'start') receivedStart = true;
        if (event.type === 'done') receivedDone = true;
        yield event;
      }
      if (!receivedStart) {
        throw new Error('本地 Codex gateway 流缺少 start 事件');
      }
      if (!receivedDone) {
        throw new Error('本地 Codex gateway 流缺少 done 事件');
      }
    } finally {
      if (!upstream.destroyed) upstream.destroy();
    }
  }

  /**
   * 返回消息列表中最后一条用户文本，作为当前 Codex turn 输入。
   * @param request - 含完整页面消息历史的流请求。
   * @returns 最后一条用户消息正文。
   * @throws 没有用户消息时抛出错误。
   */
  private latestUserMessage(request: LlmStreamRequest): string {
    const message = [...request.messages]
      .reverse()
      .find((item) => item.role === 'user');
    if (!message) throw new Error('本地 Codex 请求缺少用户消息');
    return message.content;
  }

  /**
   * 解析 gateway 已归一化事件并校验事件名与数据类型一致。
   * @param eventName - SSE event 字段。
   * @param data - SSE data JSON 文本。
   * @returns 统一流事件。
   * @throws 事件未知、数据非法或 error 事件到达时抛出错误。
   */
  private parseEvent(
    eventName: string,
    data: string,
  ): LlmNormalizedStreamEvent {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(data) as Record<string, unknown>;
    } catch {
      throw new Error('本地 Codex gateway 返回了非法流式分片');
    }
    if (eventName === 'error') {
      let message = '本地 Codex 流式请求失败';
      if (typeof parsed.message === 'string' && parsed.message.trim()) {
        message = parsed.message.trim().slice(0, 300);
      }
      throw new Error(message);
    }
    if (eventName === 'start') {
      if (typeof parsed.model !== 'string') {
        throw new Error('本地 Codex start 事件缺少模型');
      }
      const event: LlmNormalizedStreamEvent = {
        model: parsed.model,
        type: 'start',
      };
      if (typeof parsed.threadId === 'string') {
        event.providerThreadId = parsed.threadId;
      }
      return event;
    }
    if (eventName === 'text-delta' || eventName === 'reasoning-delta') {
      if (typeof parsed.content !== 'string') {
        throw new Error('本地 Codex 增量事件缺少正文');
      }
      return { content: parsed.content, type: eventName };
    }
    if (eventName === 'done') {
      if (typeof parsed.model !== 'string') {
        throw new Error('本地 Codex done 事件缺少模型');
      }
      const event: LlmNormalizedStreamEvent = {
        model: parsed.model,
        type: 'done',
      };
      if (typeof parsed.finishReason === 'string') {
        event.finishReason = parsed.finishReason;
      }
      if (typeof parsed.threadId === 'string') {
        event.providerThreadId = parsed.threadId;
      }
      if (
        parsed.metadata &&
        typeof parsed.metadata === 'object' &&
        !Array.isArray(parsed.metadata)
      ) {
        event.metadata = parsed.metadata as Record<string, unknown>;
      }
      return event;
    }
    throw new Error(`本地 Codex gateway 事件不受支持：${eventName}`);
  }

  /**
   * 把 Codex Models Axios 异常收敛为不含内部密钥或响应正文的稳定错误。
   * @param error - 实时模型请求捕获的未知异常。
   * @param signal - 单次模型发现的有界超时信号。
   * @throws {LlmModelDiscoveryError} 始终抛出安全的模型发现错误。
   */
  private throwModelRequestError(error: unknown, signal: AbortSignal): never {
    if (signal.aborted) {
      throw new LlmModelDiscoveryError('本地 Codex 实时模型请求超时');
    }
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        throw new LlmModelDiscoveryError('本地 Codex 实时模型请求超时');
      }
      const status = error.response?.status;
      if (status) {
        throw new LlmModelDiscoveryError(
          `本地 Codex 实时模型请求失败（HTTP ${status}）`,
        );
      }
    }
    throw new LlmModelDiscoveryError('本地 Codex 实时模型请求失败');
  }

  /**
   * 读取 API 与 gateway 共享的内部密钥，禁止使用空值。
   * @returns 长度至少 32 的内部调用密钥。
   * @throws 密钥缺失或过短时抛出错误。
   */
  private internalSecret(): string {
    const secret = String(
      this.configService.get('LLM_CODEX_GATEWAY_INTERNAL_SECRET') || '',
    ).trim();
    if (secret.length < 32) {
      throw new LlmModelDiscoveryError('本地 Codex gateway 内部密钥未配置');
    }
    return secret;
  }
}
