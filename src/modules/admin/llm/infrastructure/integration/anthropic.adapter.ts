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

const ANTHROPIC_VERSION = '2023-06-01';
const REQUEST_TIMEOUT_MS = 60_000;
const MODEL_DISCOVERY_TIMEOUT_MS = 20_000;
const MODEL_DISCOVERY_PAGE_LIMIT = 20;
const MODEL_RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024;

type AnthropicEvent = {
  delta?: {
    stop_reason?: null | string;
    text?: string;
    thinking?: string;
    type?: string;
  };
  error?: { message?: unknown };
  message?: {
    id?: string;
    model?: string;
    usage?: { input_tokens?: unknown; output_tokens?: unknown };
  };
  type?: string;
  usage?: { input_tokens?: unknown; output_tokens?: unknown };
};

@Injectable()
export class AnthropicAdapter extends LlmProviderAdapter {
  /**
   * 按 Anthropic `after_id` 协议有界分页读取模型，并规范展示名与模型 ID。
   * @param config - 含 Base URL 与 `x-api-key` 凭据的运行配置。
   * @returns 跨页去空并按 ID 去重的实时模型目录。
   * @throws {LlmModelDiscoveryError} 请求失败、分页游标循环、协议非法或目录为空时抛出安全错误。
   */
  async fetchModels(config: LlmAdapterConfig): Promise<LlmModelItem[]> {
    const signal = AbortSignal.timeout(MODEL_DISCOVERY_TIMEOUT_MS);
    const values: unknown[] = [];
    const seenCursors = new Set<string>();
    let afterId = '';
    let completed = false;
    for (
      let pageIndex = 0;
      pageIndex < MODEL_DISCOVERY_PAGE_LIMIT;
      pageIndex += 1
    ) {
      let payload: unknown;
      try {
        const response = await axios.get<unknown>(
          this.modelsUrl(config.baseUrl, afterId),
          {
            headers: {
              Accept: 'application/json',
              'anthropic-version': ANTHROPIC_VERSION,
              'x-api-key': config.apiKey,
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
      const page = this.readModelPage(payload);
      values.push(...page.data);
      if (!page.hasMore) {
        completed = true;
        break;
      }
      if (seenCursors.has(page.lastId)) {
        throw new LlmModelDiscoveryError('Anthropic 实时模型分页游标不合法');
      }
      seenCursors.add(page.lastId);
      afterId = page.lastId;
    }
    if (!completed) {
      throw new LlmModelDiscoveryError('Anthropic 实时模型分页超过安全上限');
    }
    return normalizeLlmModelItems(
      values.map((value) => this.projectModelCapabilities(value)),
      'Anthropic 实时模型响应协议不合法',
      'display_name',
    );
  }

  /**
   * 判断当前供应商是否使用 Anthropic Messages SSE。
   * @param provider - 当前连接声明的供应商。
   * @returns Anthropic 时返回 true。
   */
  supports(provider: LlmProvider): boolean {
    return provider === 'anthropic';
  }

  /**
   * 请求 Anthropic Messages 流并归一化正文、思考、停止原因与累计用量。
   * @param request - 已解密连接、消息、模型和取消信号。
   * @returns 依次产出统一流事件的异步生成器。
   * @throws 上游拒绝、超时、非法分片或缺少 message_stop 时抛出错误。
   */
  async *stream(
    request: LlmStreamRequest,
  ): AsyncGenerator<LlmNormalizedStreamEvent> {
    if (request.signal.aborted) throw new Error('llm-stream-aborted');
    const body: Record<string, unknown> = {
      max_tokens: 4096,
      messages: request.messages,
      model: request.model,
      stream: true,
    };
    if (request.reasoningEffort) {
      body.output_config = { effort: request.reasoningEffort };
    }
    if (request.serviceTier) body.service_tier = request.serviceTier;
    let upstream: Readable;
    try {
      const response = await axios.post<Readable>(
        this.messagesUrl(request.config.baseUrl),
        body,
        {
          headers: {
            Accept: 'text/event-stream',
            'Content-Type': 'application/json',
            'anthropic-version': ANTHROPIC_VERSION,
            'x-api-key': request.config.apiKey,
          },
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
    let receivedStop = false;
    let usage: LlmTokenUsage | undefined;
    yield { model: actualModel, type: 'start' };
    try {
      for await (const frame of parseSseStream(upstream, request.signal)) {
        const event = this.parseEvent(frame.data);
        if (event.type === 'error') {
          const detail = this.safeText(event.error?.message);
          if (detail) throw new Error(`Anthropic 上游拒绝请求：${detail}`);
          throw new Error('Anthropic 上游拒绝请求');
        }
        if (event.type === 'message_start') {
          if (event.message?.model) actualModel = event.message.model;
          const initialUsage = this.projectUsage(event.message?.usage);
          if (initialUsage) usage = initialUsage;
          continue;
        }
        if (event.type === 'content_block_delta') {
          if (event.delta?.type === 'text_delta' && event.delta.text) {
            yield { content: event.delta.text, type: 'text-delta' };
          }
          if (event.delta?.type === 'thinking_delta' && event.delta.thinking) {
            yield {
              content: event.delta.thinking,
              type: 'reasoning-delta',
            };
          }
          continue;
        }
        if (event.type === 'message_delta') {
          if (event.delta?.stop_reason) finishReason = event.delta.stop_reason;
          const finalUsage = this.projectUsage(event.usage);
          if (finalUsage) usage = { ...usage, ...finalUsage };
          continue;
        }
        if (event.type === 'message_stop') {
          receivedStop = true;
          break;
        }
      }
      if (!receivedStop) {
        throw new Error('Anthropic 上游未返回完整流式终态');
      }
      yield { finishReason, model: actualModel, type: 'done', usage };
    } finally {
      if (!upstream.destroyed) upstream.destroy();
    }
  }

  /**
   * 保留已指向 `/messages` 的端点，否则剥离尾斜杠后补齐 Anthropic Messages 路径。
   * @param baseUrl - 已由配置服务校验的 HTTP(S) 地址。
   * @returns 以 `/messages` 结尾的请求地址。
   */
  private messagesUrl(baseUrl: string): string {
    const normalized = baseUrl.replace(/\/+$/, '');
    if (normalized.endsWith('/messages')) return normalized;
    return `${normalized}/messages`;
  }

  /**
   * 将 Base URL 规范为带 `limit=1000` 和可选 `after_id` 的 Anthropic Models 地址。
   * @param baseUrl - 已由配置服务校验的 HTTP(S) 地址。
   * @param afterId - 上一页返回的非空游标；首页传空字符串。
   * @returns 官方分页参数完整且不携带凭据的 Models URL。
   */
  private modelsUrl(baseUrl: string, afterId: string): string {
    let normalized = baseUrl.replace(/\/+$/, '');
    if (normalized.endsWith('/messages')) {
      normalized = normalized.slice(0, -'/messages'.length);
    }
    if (!normalized.endsWith('/models')) normalized = `${normalized}/models`;
    const url = new URL(normalized);
    url.searchParams.set('limit', '1000');
    if (afterId) url.searchParams.set('after_id', afterId);
    return url.toString();
  }

  /**
   * 校验 Anthropic 模型分页根对象、数据数组、续页标记和非循环游标所需字段。
   * @param payload - Axios 解码后的未知 JSON 值。
   * @returns 当前页模型数组、是否续页和规范化末尾游标。
   * @throws {LlmModelDiscoveryError} 任一分页字段类型或组合不合法时抛出安全错误。
   */
  private readModelPage(payload: unknown): {
    data: unknown[];
    hasMore: boolean;
    lastId: string;
  } {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new LlmModelDiscoveryError('Anthropic 实时模型响应协议不合法');
    }
    const record = payload as Record<string, unknown>;
    if (!Array.isArray(record.data)) {
      throw new LlmModelDiscoveryError('Anthropic 实时模型响应协议不合法');
    }
    let hasMore = false;
    if (record.has_more !== undefined) {
      if (typeof record.has_more !== 'boolean') {
        throw new LlmModelDiscoveryError('Anthropic 实时模型响应协议不合法');
      }
      hasMore = record.has_more;
    }
    let lastId = '';
    if (hasMore) {
      if (typeof record.last_id !== 'string') {
        throw new LlmModelDiscoveryError('Anthropic 实时模型响应协议不合法');
      }
      lastId = record.last_id.trim();
      if (!lastId) {
        throw new LlmModelDiscoveryError('Anthropic 实时模型响应协议不合法');
      }
    }
    return { data: record.data, hasMore, lastId };
  }

  /**
   * 把 Anthropic Models API 的 `capabilities.effort` 投影为统一模型级推理选项。
   * @param value - 当前分页中的未知模型项。
   * @returns 保留原字段并附带实时推理强度、默认值与空速度档位的模型项；非法根值原样交给统一校验器拒绝。
   */
  private projectModelCapabilities(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return value;
    }
    const record = value as Record<string, unknown>;
    const reasoningEfforts: Array<{ id: string; label: string }> = [];
    const capabilities = record.capabilities;
    if (
      capabilities &&
      typeof capabilities === 'object' &&
      !Array.isArray(capabilities)
    ) {
      const effort = (capabilities as Record<string, unknown>).effort;
      if (effort && typeof effort === 'object' && !Array.isArray(effort)) {
        for (const [id, support] of Object.entries(
          effort as Record<string, unknown>,
        )) {
          if (id === 'supported') continue;
          if (
            !support ||
            typeof support !== 'object' ||
            Array.isArray(support)
          ) {
            continue;
          }
          if ((support as Record<string, unknown>).supported === true) {
            reasoningEfforts.push({ id, label: id });
          }
        }
      }
    }
    let defaultReasoningEffort: null | string = null;
    if (reasoningEfforts.some((option) => option.id === 'high')) {
      defaultReasoningEffort = 'high';
    }
    return {
      ...record,
      defaultReasoningEffort,
      defaultServiceTier: null,
      reasoningEfforts,
      serviceTiers: [],
    };
  }

  /**
   * 将单个 SSE data 文本解码为 Anthropic 事件；非法 JSON 转换为不暴露原文的稳定错误。
   * @param data - SSE data 字段中的 JSON 文本。
   * @returns Anthropic 事件对象。
   * @throws JSON 非法时抛出错误。
   */
  private parseEvent(data: string): AnthropicEvent {
    try {
      return JSON.parse(data) as AnthropicEvent;
    } catch {
      throw new Error('Anthropic 上游返回了非法流式分片');
    }
  }

  /**
   * 把 Anthropic input/output Token 用量投影为统一结构。
   * @param usage - message_start 或 message_delta 携带的累计用量。
   * @returns 至少包含一个数值时返回统一用量，否则返回 undefined。
   */
  private projectUsage(usage?: {
    input_tokens?: unknown;
    output_tokens?: unknown;
  }) {
    if (!usage) return undefined;
    const projected: LlmTokenUsage = {};
    if (Number.isFinite(Number(usage.input_tokens))) {
      projected.inputTokens = Number(usage.input_tokens);
    }
    if (Number.isFinite(Number(usage.output_tokens))) {
      projected.outputTokens = Number(usage.output_tokens);
    }
    if (Object.keys(projected).length === 0) return undefined;
    return projected;
  }

  /**
   * 把 Axios 建连错误收敛为不含认证信息的短错误。
   * @param error - 上游建连阶段捕获的未知错误。
   * @param signal - 用于区分取消与真实失败的信号。
   * @throws 始终抛出安全错误文本。
   */
  private throwRequestError(error: unknown, signal: AbortSignal): never {
    if (signal.aborted) throw new Error('llm-stream-aborted');
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        throw new Error('Anthropic 上游请求超时');
      }
      const status = error.response?.status;
      if (status) throw new Error(`Anthropic 上游连接失败（HTTP ${status}）`);
    }
    throw new Error('Anthropic 上游连接失败');
  }

  /**
   * 把 Anthropic Models Axios 异常收敛为不含请求 URL、密钥或响应正文的错误。
   * @param error - 实时模型请求捕获的未知异常。
   * @param signal - 整次分页发现共用的有界超时信号。
   * @throws {LlmModelDiscoveryError} 始终抛出安全的模型发现错误。
   */
  private throwModelRequestError(error: unknown, signal: AbortSignal): never {
    if (signal.aborted) {
      throw new LlmModelDiscoveryError('Anthropic 实时模型请求超时');
    }
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        throw new LlmModelDiscoveryError('Anthropic 实时模型请求超时');
      }
      const status = error.response?.status;
      if (status) {
        throw new LlmModelDiscoveryError(
          `Anthropic 实时模型请求失败（HTTP ${status}）`,
        );
      }
    }
    throw new LlmModelDiscoveryError('Anthropic 实时模型请求失败');
  }

  /**
   * 把未知错误字段收敛为最长 300 字符的单行文本。
   * @param value - Anthropic 错误对象中的未知字段。
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
