import { Injectable } from '@nestjs/common';
import axios from 'axios';
import type { Readable } from 'node:stream';
import type {
  LlmAdapterConfig,
  LlmModelItem,
  LlmNormalizedStreamEvent,
  LlmProvider,
  LlmStreamRequest,
  LlmTokenUsage,
} from '../../contract/llm.types';
import { parseSseStream } from './llm-sse';
import {
  LlmModelDiscoveryError,
  LlmProviderAdapter,
  normalizeLlmModelItems,
} from './llm-provider.adapter';

const OPENAI_COMPATIBLE_PROVIDERS = new Set<LlmProvider>([
  'deepseek',
  'moonshot',
  'openai',
  'zhipu',
]);
const REQUEST_TIMEOUT_MS = 60_000;
const MODEL_DISCOVERY_TIMEOUT_MS = 15_000;
const MODEL_RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024;

type OpenAiChunk = {
  choices?: Array<{
    delta?: {
      content?: null | string;
      reasoning_content?: null | string;
      refusal?: null | string;
    };
    finish_reason?: null | string;
  }>;
  error?: { message?: unknown };
  model?: string;
  usage?: {
    completion_tokens?: unknown;
    prompt_tokens?: unknown;
    total_tokens?: unknown;
  };
};

@Injectable()
export class OpenAiCompatibleAdapter extends LlmProviderAdapter {
  /**
   * 通过 OpenAI-compatible Models API 实时读取并规范供应商模型目录。
   * @param config - 含 Base URL 与 Bearer API Key 的运行配置。
   * @returns 去空并按 ID 去重的模型目录，展示名与模型 ID 相同。
   * @throws {LlmModelDiscoveryError} 请求超时、HTTP 失败、协议非法或目录为空时抛出安全错误。
   */
  async fetchModels(config: LlmAdapterConfig): Promise<LlmModelItem[]> {
    const signal = AbortSignal.timeout(MODEL_DISCOVERY_TIMEOUT_MS);
    let payload: unknown;
    try {
      const response = await axios.get<unknown>(
        this.modelsUrl(config.baseUrl),
        {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
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
    return normalizeLlmModelItems(
      this.modelData(payload),
      '大模型实时模型响应协议不合法',
      'id',
    );
  }

  /**
   * 判断供应商是否使用 Chat Completions SSE 合同。
   * @param provider - 当前连接声明的供应商。
   * @returns OpenAI、智谱、DeepSeek 或 Moonshot 时返回 true。
   */
  supports(provider: LlmProvider): boolean {
    return OPENAI_COMPATIBLE_PROVIDERS.has(provider);
  }

  /**
   * 请求 Chat Completions 流并归一化正文、思考增量、终止原因与用量。
   * @param request - 已解密连接、消息、模型和取消信号。
   * @returns 依次产出 start、reasoning-delta、text-delta 与 done 的异步流。
   * @throws 上游拒绝、超时、非法分片或缺少终态时抛出安全错误。
   */
  async *stream(
    request: LlmStreamRequest,
  ): AsyncGenerator<LlmNormalizedStreamEvent> {
    if (request.signal.aborted) throw new Error('llm-stream-aborted');
    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
    };
    if (request.config.apiKey) {
      headers.Authorization = `Bearer ${request.config.apiKey}`;
    }
    const body: Record<string, unknown> = {
      messages: request.messages,
      model: request.model,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (request.reasoningEffort) {
      body.reasoning_effort = request.reasoningEffort;
    }
    if (request.serviceTier) body.service_tier = request.serviceTier;
    let upstream: Readable;
    try {
      const response = await axios.post<Readable>(
        this.chatCompletionUrl(request.config.baseUrl),
        body,
        {
          headers,
          maxRedirects: 0,
          responseType: 'stream',
          signal: request.signal,
          timeout: REQUEST_TIMEOUT_MS,
        },
      );
      upstream = response.data;
    } catch (error) {
      this.throwRequestError(error, request.signal);
    }

    let actualModel = request.model;
    let finishReason: null | string = null;
    let receivedDone = false;
    let usage: LlmTokenUsage | undefined;
    yield { model: actualModel, type: 'start' };
    try {
      for await (const frame of parseSseStream(upstream, request.signal)) {
        if (frame.data === '[DONE]') {
          receivedDone = true;
          break;
        }
        const chunk = this.parseChunk(frame.data);
        if (chunk.model) actualModel = chunk.model;
        const projectedUsage = this.projectUsage(chunk.usage);
        if (projectedUsage) usage = projectedUsage;
        const choice = chunk.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        const reasoning = choice?.delta?.reasoning_content;
        if (reasoning) {
          yield { content: reasoning, type: 'reasoning-delta' };
        }
        let content = choice?.delta?.content;
        if (!content) content = choice?.delta?.refusal;
        if (content) yield { content, type: 'text-delta' };
      }
      if (!receivedDone && !finishReason) {
        throw new Error('大模型上游未返回完整流式终态');
      }
      yield { finishReason, model: actualModel, type: 'done', usage };
    } finally {
      if (!upstream.destroyed) upstream.destroy();
    }
  }

  /**
   * 将 API Base URL 规范为完整 Chat Completions 端点。
   * @param baseUrl - 已由配置服务校验的 HTTP(S) 地址。
   * @returns 以 `/chat/completions` 结尾的请求地址。
   */
  private chatCompletionUrl(baseUrl: string): string {
    const normalized = baseUrl.replace(/\/+$/, '');
    if (normalized.endsWith('/chat/completions')) return normalized;
    return `${normalized}/chat/completions`;
  }

  /**
   * 将 API Base URL 规范为 OpenAI-compatible Models 端点，并兼容已填写 Chat Completions 全路径的配置。
   * @param baseUrl - 已由配置服务校验的 HTTP(S) 地址。
   * @returns 以 `/models` 结尾的请求地址。
   */
  private modelsUrl(baseUrl: string): string {
    let normalized = baseUrl.replace(/\/+$/, '');
    if (normalized.endsWith('/models')) return normalized;
    if (normalized.endsWith('/chat/completions')) {
      normalized = normalized.slice(0, -'/chat/completions'.length);
    }
    return `${normalized}/models`;
  }

  /**
   * 从结构化 JSON 根对象中提取 OpenAI-compatible `data` 模型数组。
   * @param payload - Axios 解码后的未知 JSON 值。
   * @returns 待统一规范化的模型数组字段。
   * @throws {LlmModelDiscoveryError} JSON 根值不是普通对象时抛出安全错误。
   */
  private modelData(payload: unknown): unknown {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new LlmModelDiscoveryError('大模型实时模型响应协议不合法');
    }
    return (payload as Record<string, unknown>).data;
  }

  /**
   * 解析单个 OpenAI-compatible 数据分片并拒绝上游错误对象。
   * @param data - SSE data 字段中的 JSON 文本。
   * @returns 可读取 choices、model 与 usage 的分片。
   * @throws JSON 非法或上游返回 error 时抛出安全错误。
   */
  private parseChunk(data: string): OpenAiChunk {
    let chunk: OpenAiChunk;
    try {
      chunk = JSON.parse(data) as OpenAiChunk;
    } catch {
      throw new Error('大模型上游返回了非法流式分片');
    }
    if (chunk.error) {
      const detail = this.safeText(chunk.error.message);
      if (detail) throw new Error(`大模型上游拒绝请求：${detail}`);
      throw new Error('大模型上游拒绝请求');
    }
    return chunk;
  }

  /**
   * 把 snake_case Token 用量字段投影为统一结构。
   * @param usage - 最终分片可能携带的用量对象。
   * @returns 至少包含一个有限数值时返回统一用量，否则返回 undefined。
   */
  private projectUsage(usage?: OpenAiChunk['usage']) {
    if (!usage) return undefined;
    const projected: LlmTokenUsage = {};
    if (Number.isFinite(Number(usage.prompt_tokens))) {
      projected.promptTokens = Number(usage.prompt_tokens);
    }
    if (Number.isFinite(Number(usage.completion_tokens))) {
      projected.completionTokens = Number(usage.completion_tokens);
    }
    if (Number.isFinite(Number(usage.total_tokens))) {
      projected.totalTokens = Number(usage.total_tokens);
    }
    if (Object.keys(projected).length === 0) return undefined;
    return projected;
  }

  /**
   * 把 Axios 建连错误收敛为不含请求配置和认证头的短错误。
   * @param error - 上游建连阶段捕获的未知错误。
   * @param signal - 用于区分用户取消与真实上游失败的信号。
   * @throws 始终抛出安全错误文本。
   */
  private throwRequestError(error: unknown, signal: AbortSignal): never {
    if (signal.aborted) throw new Error('llm-stream-aborted');
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        throw new Error('大模型上游请求超时');
      }
      const status = error.response?.status;
      if (status) throw new Error(`大模型上游连接失败（HTTP ${status}）`);
    }
    throw new Error('大模型上游连接失败');
  }

  /**
   * 把 Models API 的 Axios 错误收敛为不含 URL、认证头或响应正文的稳定错误。
   * @param error - 实时模型请求捕获的未知异常。
   * @param signal - 全请求共用的有界超时信号。
   * @throws {LlmModelDiscoveryError} 始终抛出安全的模型发现错误。
   */
  private throwModelRequestError(error: unknown, signal: AbortSignal): never {
    if (signal.aborted) {
      throw new LlmModelDiscoveryError('大模型实时模型请求超时');
    }
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        throw new LlmModelDiscoveryError('大模型实时模型请求超时');
      }
      const status = error.response?.status;
      if (status) {
        throw new LlmModelDiscoveryError(
          `大模型实时模型请求失败（HTTP ${status}）`,
        );
      }
    }
    throw new LlmModelDiscoveryError('大模型实时模型请求失败');
  }

  /**
   * 把未知错误字段收敛为最长 300 字符的单行文本。
   * @param value - 上游错误对象中的未知字段。
   * @returns 可安全进入业务错误的短文本。
   */
  private safeText(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value
      .replace(/[\r\n\t]+/g, ' ')
      .trim()
      .slice(0, 300);
  }
}
