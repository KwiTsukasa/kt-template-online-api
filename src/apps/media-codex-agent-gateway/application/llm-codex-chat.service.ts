import { Injectable } from '@nestjs/common';
import type { CodexAppServerNotification } from '../infrastructure/codex-app-server.client';
import { UnixWebSocketRpcTransport } from '../infrastructure/codex-app-server.client';
import { MediaCodexAgentGatewayConfigService } from '../config/media-codex-agent-gateway-config.service';
import {
  MEDIA_CODEX_AGENT_DYNAMIC_TOOLS,
  MEDIA_CODEX_AGENT_RESULT_SCHEMA,
  canonicalJson,
  mediaCodexAgentToolFromWireName,
  parseMediaCodexAgentResult,
  type MediaCodexAgentBoundaryCapsule,
  type MediaCodexAgentPolicy,
  type MediaCodexAgentResult,
  type MediaCodexAgentTurnRequest,
  type MediaCodexAgentWireResult,
  type MediaGovernanceLlmConversationIdentity,
} from '../domain/media-codex-agent.contract';
import {
  buildMediaCodexAgentCapsule,
  buildMediaCodexAgentPolicy,
  buildMediaCodexAgentTurnPrompt,
  validateMediaCodexAgentToolCall,
} from '../domain/media-codex-agent.policy';
import {
  LLM_CODEX_NETWORK_ACCESS,
  LLM_CODEX_PERMISSION_PROFILE,
  type LlmCodexModelCapabilityOption,
  type LlmCodexModelItem,
  type LlmCodexModelsResponse,
} from '../domain/llm-codex-runtime.contract';
import { MediaCodexAgentApiClient } from '../infrastructure/media-codex-agent-api.client';
import type { LlmCodexChatStreamDto } from '../presentation/llm-codex-chat.dto';

const LLM_CODEX_MODEL_PAGE_SIZE = 100;
const LLM_CODEX_MODEL_MAX_PAGES = 100;

export type LlmCodexGatewayStreamEvent =
  | { model: string; threadId: string; type: 'start' }
  | { content: string; type: 'reasoning-delta' | 'text-delta' }
  | {
      finishReason: string;
      metadata?: Record<string, unknown>;
      model: string;
      threadId: string;
      type: 'done';
    };

interface LlmCodexMediaRuntime {
  capsule: MediaCodexAgentBoundaryCapsule;
  identity: MediaGovernanceLlmConversationIdentity;
  policy: MediaCodexAgentPolicy;
  prompt: string;
  request: MediaCodexAgentTurnRequest;
}

class CodexNotificationQueue {
  private ended = false;
  private readonly notifications: CodexAppServerNotification[] = [];
  private readonly waiters: Array<{
    reject: (error: Error) => void;
    resolve: (notification: CodexAppServerNotification) => void;
  }> = [];

  /**
   * 把 App Server 通知交给首个等待者；无人等待时按序缓存。
   * @param notification - App Server 主动推送的通知。
   */
  push(notification: CodexAppServerNotification) {
    if (this.ended) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve(notification);
      return;
    }
    this.notifications.push(notification);
  }

  /**
   * 等待下一条通知，并在调用方取消时拒绝等待。
   * @param signal - 浏览器断连或停止生成信号。
   * @returns 下一条 App Server 通知。
   */
  next(signal: AbortSignal): Promise<CodexAppServerNotification> {
    const buffered = this.notifications.shift();
    if (buffered) return Promise.resolve(buffered);
    if (this.ended) return Promise.reject(new Error('codex-stream-ended'));
    if (signal.aborted) {
      return Promise.reject(new Error('llm-stream-aborted'));
    }
    return new Promise<CodexAppServerNotification>((resolve, reject) => {
      let abort: () => void = () => {};
      const waiter = {
        reject: (error: Error) => {
          signal.removeEventListener('abort', abort);
          reject(error);
        },
        resolve: (notification: CodexAppServerNotification) => {
          signal.removeEventListener('abort', abort);
          resolve(notification);
        },
      };
      abort = () => {
        this.removeWaiter(waiter);
        waiter.reject(new Error('llm-stream-aborted'));
      };
      signal.addEventListener('abort', abort, { once: true });
      this.waiters.push(waiter);
    });
  }

  /**
   * 终止队列并拒绝所有等待者。
   * @param message - 等待者接收的稳定错误码。
   */
  close(message: string) {
    this.ended = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.reject(new Error(message));
    }
  }

  /**
   * 按对象身份移除已取消等待者。
   * @param waiter - 需要从等待队列移除的等待记录。
   */
  private removeWaiter(waiter: (typeof this.waiters)[number]) {
    const index = this.waiters.indexOf(waiter);
    if (index >= 0) this.waiters.splice(index, 1);
  }
}

@Injectable()
export class LlmCodexChatService {
  constructor(
    private readonly config: MediaCodexAgentGatewayConfigService,
    private readonly mediaApiClient: MediaCodexAgentApiClient,
  ) {}

  /**
   * 验证统一 App Server 连接和媒体治理回调均已就绪。
   * @returns 统一 Codex 网关健康投影。
   */
  async health() {
    const transport = new UnixWebSocketRpcTransport(
      this.config.appServerSocketPath(),
      this.config.timeoutMs(),
    );
    try {
      await transport.connect();
      await transport.request('initialize', {
        capabilities: { experimentalApi: true },
        clientInfo: {
          name: 'kt_llm_health',
          title: 'KT LLM Codex Health',
          version: '1.0.0',
        },
      });
      await transport.notify('initialized');
      await this.mediaApiClient.health();
      return {
        apiCallbackReady: true,
        appServerReady: true,
        appServerTransport: 'unix',
        networkAccess: LLM_CODEX_NETWORK_ACCESS,
        permissionProfile: LLM_CODEX_PERMISSION_PROFILE,
        status: 'ready',
      } as const;
    } finally {
      transport.close();
    }
  }

  /**
   * 通过单次独立 App Server 连接握手并分页读取当前可发送模型。
   * @returns 去空、排除隐藏项并按发送标识去重后的模型列表。
   * @throws 握手、分页协议或模型结构无效时抛出稳定的模型发现错误。
   */
  async models(): Promise<LlmCodexModelsResponse> {
    const transport = new UnixWebSocketRpcTransport(
      this.config.appServerSocketPath(),
      this.config.timeoutMs(),
    );
    try {
      await transport.connect();
      await transport.request('initialize', {
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
        },
        clientInfo: {
          name: 'kt_llm_model_discovery_gateway',
          title: 'KT 大模型模型发现 Gateway',
          version: '1.0.0',
        },
      });
      await transport.notify('initialized');
      return { items: await this.readModels(transport) };
    } catch {
      throw new Error('codex-model-list-unavailable');
    } finally {
      transport.close();
    }
  }

  /**
   * 通过独立 Unix-WebSocket App Server 连接启动或恢复线程，并归一化可见增量。
   * @param body - 模型、用户正文、客户端消息标识和可选持久线程。
   * @param signal - 浏览器停止或断连信号。
   * @returns 逐帧产出 start、reasoning-delta、text-delta 与 done 事件的异步生成器。
   * @throws App Server 握手、线程、回合或通知合同无效时抛出错误。
   */
  async *stream(
    body: LlmCodexChatStreamDto,
    signal: AbortSignal,
  ): AsyncGenerator<LlmCodexGatewayStreamEvent> {
    const mediaRuntime = await this.prepareMediaRuntime(body);
    const transport = new UnixWebSocketRpcTransport(
      this.config.appServerSocketPath(),
      this.config.timeoutMs(),
    );
    const queue = new CodexNotificationQueue();
    transport.onNotification((notification) => queue.push(notification));
    transport.onDisconnect(() => queue.close('app-server-disconnected'));
    transport.onRequest(async (request) => {
      if (mediaRuntime) {
        await this.handleMediaToolCall(transport, request, mediaRuntime);
        return;
      }
      await transport.respond(request.id, {
        result: { contentItems: [], success: false },
      });
    });
    let threadId = '';
    let turnId = '';
    let mediaResult: MediaCodexAgentResult | null = null;
    try {
      await transport.connect();
      await transport.request('initialize', {
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
        },
        clientInfo: {
          name: 'kt_llm_chat_gateway',
          title: 'KT 大模型对话 Gateway',
          version: '1.0.0',
        },
      });
      await transport.notify('initialized');
      threadId = await this.openThread(transport, body, mediaRuntime);
      if (mediaRuntime) {
        const identity = await this.mediaApiClient.bindProviderThread({
          conversationId: mediaRuntime.identity.conversationId,
          conversationTurnId: mediaRuntime.identity.activeTurnId,
          expectedProviderThreadId: mediaRuntime.identity.providerThreadId,
          providerThreadId: threadId,
          replaceProviderThread:
            mediaRuntime.identity.providerThreadResetRequired === true,
          taskId: mediaRuntime.identity.sceneRefId,
        });
        mediaRuntime.identity = this.mediaConversationIdentity(
          identity,
          body,
          threadId,
        );
      }
      turnId = await this.startTurn(transport, body, threadId, mediaRuntime);
      yield { model: body.model, threadId, type: 'start' };
      while (true) {
        const notification = await queue.next(signal);
        const identity = this.notificationIdentity(notification);
        if (identity.threadId !== threadId || identity.turnId !== turnId) {
          continue;
        }
        const capturedResult = this.mediaResult(
          notification,
          Boolean(mediaRuntime),
        );
        if (capturedResult) mediaResult = capturedResult;
        const projected = this.projectNotification(
          notification,
          body.model,
          Boolean(mediaRuntime),
        );
        if (!projected) continue;
        if (projected.type === 'done' && mediaRuntime) {
          if (!mediaResult) throw new Error('media-agent-result-missing');
          const resultPayload = this.mediaResultPayload(mediaResult);
          await this.mediaApiClient.publishConversationResult({
            conversationId: body.conversationId!,
            conversationTurnId: mediaRuntime.identity.activeTurnId,
            providerThreadId: threadId,
            result: resultPayload,
            taskId: body.sceneRefId!,
          });
          yield { content: mediaResult.answer, type: 'text-delta' };
          projected.metadata = { mediaGovernanceResult: resultPayload };
        }
        yield projected;
        if (projected.type === 'done') break;
      }
    } catch (error) {
      if (signal.aborted && threadId && turnId) {
        try {
          await transport.request('turn/interrupt', { threadId, turnId });
        } catch {}
        throw new Error('llm-stream-aborted');
      }
      throw error;
    } finally {
      queue.close('codex-stream-ended');
      transport.close();
    }
  }

  /**
   * 分页读取官方模型协议，并拒绝超量分页、游标循环、非法结构或空结果。
   * @param transport - 已完成初始化握手的当前独立 App Server RPC 连接。
   * @returns 按首次出现顺序去重后的可发送模型。
   * @throws 分页超过硬上限、游标循环、响应非法或无可用模型时抛出错误。
   */
  private async readModels(
    transport: UnixWebSocketRpcTransport,
  ): Promise<LlmCodexModelItem[]> {
    const itemsById = new Map<string, LlmCodexModelItem>();
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    for (
      let pageIndex = 0;
      pageIndex < LLM_CODEX_MODEL_MAX_PAGES;
      pageIndex += 1
    ) {
      const response = this.object(
        await transport.request('model/list', {
          cursor,
          includeHidden: false,
          limit: LLM_CODEX_MODEL_PAGE_SIZE,
        }),
        'codex-model-list-response-invalid',
      );
      if (!Array.isArray(response.data)) {
        throw new Error('codex-model-list-response-invalid');
      }
      for (const value of response.data) {
        const item = this.projectModelItem(value);
        if (!item || itemsById.has(item.id)) continue;
        itemsById.set(item.id, item);
      }
      let nextCursor: string | undefined;
      if (response.nextCursor !== undefined && response.nextCursor !== null) {
        if (
          typeof response.nextCursor !== 'string' ||
          !response.nextCursor.trim()
        ) {
          throw new Error('codex-model-list-response-invalid');
        }
        nextCursor = response.nextCursor;
      }
      if (!nextCursor) {
        if (itemsById.size === 0) {
          throw new Error('codex-model-list-empty');
        }
        return [...itemsById.values()];
      }
      if (seenCursors.has(nextCursor)) {
        throw new Error('codex-model-list-cursor-loop');
      }
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }
    throw new Error('codex-model-list-page-limit-exceeded');
  }

  /**
   * 校验官方模型结构，并投影发送标识与用户可见名称。
   * @param value - `model/list` 返回的单个未知模型值。
   * @returns 非隐藏且发送标识非空的模型；隐藏项或空标识返回 null。
   * @throws 模型缺少官方协议要求字段或字段类型不符时抛出错误。
   */
  private projectModelItem(value: unknown): LlmCodexModelItem | null {
    const model = this.object(value, 'codex-model-list-response-invalid');
    if (
      typeof model.id !== 'string' ||
      typeof model.model !== 'string' ||
      typeof model.displayName !== 'string' ||
      typeof model.hidden !== 'boolean'
    ) {
      throw new Error('codex-model-list-response-invalid');
    }
    if (
      !Array.isArray(model.supportedReasoningEfforts) ||
      !Array.isArray(model.serviceTiers)
    ) {
      throw new Error('codex-model-list-response-invalid');
    }
    if (model.hidden) return null;
    let id = model.model.trim();
    if (!id) id = model.id.trim();
    if (!id) return null;
    let label = model.displayName.trim();
    if (!label) label = id;
    const reasoningEfforts = this.projectReasoningEfforts(
      model.supportedReasoningEfforts,
    );
    const serviceTiers = this.projectServiceTiers(model.serviceTiers);
    const defaultReasoningEffort = this.projectDefaultCapability(
      model.defaultReasoningEffort,
      reasoningEfforts,
    );
    const defaultServiceTier = this.projectDefaultCapability(
      model.defaultServiceTier,
      serviceTiers,
    );
    return {
      defaultReasoningEffort,
      defaultServiceTier,
      id,
      label,
      reasoningEfforts,
      serviceTiers,
    };
  }

  /**
   * 投影 App Server 模型声明的逐模型推理强度，并按标识去重。
   * @param values - `supportedReasoningEfforts` 官方数组。
   * @returns 使用 `reasoningEffort` 作为发送值和显示兜底的选项。
   * @throws 任一选项缺少非空标识或描述时抛出协议错误。
   */
  private projectReasoningEfforts(
    values: unknown[],
  ): LlmCodexModelCapabilityOption[] {
    const options: LlmCodexModelCapabilityOption[] = [];
    const seen = new Set<string>();
    for (const value of values) {
      const record = this.object(value, 'codex-model-list-response-invalid');
      if (
        typeof record.reasoningEffort !== 'string' ||
        typeof record.description !== 'string'
      ) {
        throw new Error('codex-model-list-response-invalid');
      }
      const id = record.reasoningEffort.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      options.push({ id, label: id });
    }
    return options;
  }

  /**
   * 投影 App Server 模型声明的额外服务档位，并保留官方可见名称。
   * @param values - `serviceTiers` 官方数组。
   * @returns 按档位 ID 去重的速度选项。
   * @throws 任一档位缺少非空 ID、名称或描述时抛出协议错误。
   */
  private projectServiceTiers(
    values: unknown[],
  ): LlmCodexModelCapabilityOption[] {
    const options: LlmCodexModelCapabilityOption[] = [];
    const seen = new Set<string>();
    for (const value of values) {
      const record = this.object(value, 'codex-model-list-response-invalid');
      if (
        typeof record.id !== 'string' ||
        typeof record.name !== 'string' ||
        typeof record.description !== 'string'
      ) {
        throw new Error('codex-model-list-response-invalid');
      }
      const id = record.id.trim();
      if (!id || seen.has(id)) continue;
      let label = record.name.trim();
      if (!label) label = id;
      seen.add(id);
      options.push({ id, label });
    }
    return options;
  }

  /**
   * 校验 App Server 默认能力属于同一模型实时声明的选项。
   * @param value - 默认推理强度或默认服务档位。
   * @param options - 当前模型对应能力选项。
   * @returns 合法默认标识；缺失时返回 null。
   * @throws 默认字段类型非法或未被选项声明时抛出协议错误。
   */
  private projectDefaultCapability(
    value: unknown,
    options: LlmCodexModelCapabilityOption[],
  ): null | string {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') {
      throw new Error('codex-model-list-response-invalid');
    }
    const normalized = value.trim();
    if (!normalized) return null;
    if (!options.some((option) => option.id === normalized)) {
      throw new Error('codex-model-list-response-invalid');
    }
    return normalized;
  }

  /**
   * 创建新线程或恢复已有线程，并验证响应线程标识。
   * @param transport - 当前独立 App Server RPC 连接。
   * @param body - 模型、实时校验后的速度档位与可选线程标识。
   * @param mediaRuntime - 可选媒体治理任务策略与动态工具上下文。
   * @returns App Server 线程标识。
   * @throws 线程响应缺少合法标识、恢复到其他线程或权限边界漂移时抛出错误。
   */
  private async openThread(
    transport: UnixWebSocketRpcTransport,
    body: LlmCodexChatStreamDto,
    mediaRuntime: LlmCodexMediaRuntime | null,
  ) {
    const cwd = this.config.chatCwd();
    let providerThreadId = body.threadId;
    if (mediaRuntime) {
      providerThreadId = undefined;
      if (
        mediaRuntime.identity.providerThreadId &&
        mediaRuntime.identity.providerThreadResetRequired !== true
      ) {
        providerThreadId = mediaRuntime.identity.providerThreadId;
      }
    }
    let response: unknown;
    if (providerThreadId) {
      const params: Record<string, unknown> = {
        approvalPolicy: 'never',
        cwd,
        model: body.model,
        permissions: LLM_CODEX_PERMISSION_PROFILE,
        threadId: providerThreadId,
      };
      if (mediaRuntime)
        params.baseInstructions = mediaRuntime.policy.staticPrompt;
      if (body.serviceTier) params.serviceTier = body.serviceTier;
      response = await transport.request('thread/resume', params);
    } else {
      const params: Record<string, unknown> = {
        approvalPolicy: 'never',
        cwd,
        ephemeral: false,
        model: body.model,
        permissions: LLM_CODEX_PERMISSION_PROFILE,
        serviceName: 'kt-llm-chat',
      };
      if (mediaRuntime) {
        params.baseInstructions = mediaRuntime.policy.staticPrompt;
        params.dynamicTools = MEDIA_CODEX_AGENT_DYNAMIC_TOOLS;
        params.serviceName = 'kt-media-governance';
      }
      if (body.serviceTier) params.serviceTier = body.serviceTier;
      response = await transport.request('thread/start', params);
    }
    const record = this.object(response, 'codex-thread-response-invalid');
    this.assertThreadBoundary(record, cwd);
    const thread = this.object(record.thread, 'codex-thread-response-invalid');
    if (typeof thread.id !== 'string' || !thread.id) {
      throw new Error('codex-thread-response-invalid');
    }
    if (providerThreadId && thread.id !== providerThreadId) {
      throw new Error('codex-thread-identity-mismatch');
    }
    return thread.id;
  }

  /**
   * 校验 App Server 实际线程命中统一权限档、固定目录和已启用网络。
   * @param response - thread/start 或 thread/resume 响应。
   * @param cwd - 本轮允许的唯一工作目录。
   * @throws 实际边界与请求不一致时抛出错误。
   */
  private assertThreadBoundary(response: Record<string, unknown>, cwd: string) {
    const sandbox = this.object(
      response.sandbox,
      'codex-thread-boundary-mismatch',
    );
    const activePermissionProfile = this.object(
      response.activePermissionProfile,
      'codex-thread-boundary-mismatch',
    );
    if (
      response.approvalPolicy !== 'never' ||
      response.cwd !== cwd ||
      activePermissionProfile.id !== LLM_CODEX_PERMISSION_PROFILE ||
      sandbox.type !== 'readOnly' ||
      sandbox.networkAccess !== LLM_CODEX_NETWORK_ACCESS
    ) {
      throw new Error('codex-thread-boundary-mismatch');
    }
  }

  /**
   * 将普通正文或媒体治理提示提交到已锁定线程，并只传递实时校验后的推理与速度档位。
   * @param transport - 当前独立 App Server RPC 连接。
   * @param body - 模型、正文、客户端消息标识及实时校验后的推理/速度档位。
   * @param threadId - 已创建或恢复的线程标识。
   * @param mediaRuntime - 可选媒体治理提示词和结构化输出上下文。
   * @returns App Server 回合标识。
   * @throws App Server 未返回非空回合标识或响应结构不合法时抛出错误。
   */
  private async startTurn(
    transport: UnixWebSocketRpcTransport,
    body: LlmCodexChatStreamDto,
    threadId: string,
    mediaRuntime: LlmCodexMediaRuntime | null,
  ) {
    let prompt = body.prompt;
    if (mediaRuntime) prompt = mediaRuntime.prompt;
    const params: Record<string, unknown> = {
      approvalPolicy: 'never',
      clientUserMessageId: body.clientMessageId,
      cwd: this.config.chatCwd(),
      input: [{ text: prompt, text_elements: [], type: 'text' }],
      model: body.model,
      permissions: LLM_CODEX_PERMISSION_PROFILE,
      threadId,
    };
    if (mediaRuntime) params.outputSchema = MEDIA_CODEX_AGENT_RESULT_SCHEMA;
    if (body.reasoningEffort) params.effort = body.reasoningEffort;
    if (body.serviceTier) params.serviceTier = body.serviceTier;
    const response = this.object(
      await transport.request('turn/start', params),
      'codex-turn-response-invalid',
    );
    const turn = this.object(response.turn, 'codex-turn-response-invalid');
    if (typeof turn.id !== 'string' || !turn.id) {
      throw new Error('codex-turn-response-invalid');
    }
    return turn.id;
  }

  /**
   * 从通知中提取线程与回合身份，未知形态返回空值。
   * @param notification - App Server 通知。
   * @returns 线程与回合标识。
   */
  private notificationIdentity(notification: CodexAppServerNotification) {
    let threadId = '';
    let turnId = '';
    if (typeof notification.params.threadId === 'string') {
      threadId = notification.params.threadId;
    }
    if (typeof notification.params.turnId === 'string') {
      turnId = notification.params.turnId;
    }
    const turn = notification.params.turn;
    if (!turnId && turn && typeof turn === 'object' && !Array.isArray(turn)) {
      const value = turn as Record<string, unknown>;
      if (typeof value.id === 'string') turnId = value.id;
    }
    return { threadId, turnId };
  }

  /**
   * 把 Codex 消息、思考摘要与回合终态投影为网关稳定事件。
   * @param notification - 已匹配当前线程/回合的通知。
   * @param model - 当前回合请求模型。
   * @param structuredMediaResult - 是否等待媒体治理最终结构化结果。
   * @returns 可见增量或 done；无关通知返回 null。
   * @throws 回合终态被中断、失败或缺少合法结构时抛出稳定错误。
   */
  private projectNotification(
    notification: CodexAppServerNotification,
    model: string,
    structuredMediaResult: boolean,
  ): LlmCodexGatewayStreamEvent | null {
    if (notification.method === 'item/agentMessage/delta') {
      if (structuredMediaResult) return null;
      const delta = notification.params.delta;
      if (typeof delta === 'string' && delta) {
        return { content: delta, type: 'text-delta' };
      }
      return null;
    }
    if (notification.method === 'item/reasoning/summaryTextDelta') {
      const delta = notification.params.delta;
      if (typeof delta === 'string' && delta) {
        return { content: delta, type: 'reasoning-delta' };
      }
      return null;
    }
    if (notification.method !== 'turn/completed') return null;
    const turn = this.object(
      notification.params.turn,
      'codex-turn-completed-invalid',
    );
    if (turn.status === 'interrupted') {
      throw new Error('codex-turn-interrupted');
    }
    if (turn.status !== 'completed') {
      throw new Error('codex-turn-failed');
    }
    const identity = this.notificationIdentity(notification);
    return {
      finishReason: 'stop',
      model,
      threadId: identity.threadId,
      type: 'done',
    };
  }

  /**
   * 为媒体治理场景读取当前任务边界并生成动态工具回合上下文。
   * @param body - 当前统一 Codex 流请求。
   * @returns 媒体治理上下文；普通对话返回 null。
   * @throws 场景字段不完整或 API 返回的任务、模型身份与请求不一致时抛出错误。
   */
  private async prepareMediaRuntime(
    body: LlmCodexChatStreamDto,
  ): Promise<LlmCodexMediaRuntime | null> {
    const hasSceneFields = Boolean(
      body.scene ||
      body.sceneRefId ||
      body.conversationId ||
      body.conversationTurnId,
    );
    if (!hasSceneFields) return null;
    if (
      body.scene !== 'media-governance' ||
      !body.sceneRefId ||
      !body.conversationTurnId ||
      !body.conversationId
    ) {
      throw new Error('llm-codex-scene-context-invalid');
    }
    let providerThreadId: null | string = null;
    if (body.threadId) providerThreadId = body.threadId;
    const value = await this.mediaApiClient.conversationContext({
      clientMessageId: body.clientMessageId,
      content: body.prompt,
      conversationId: body.conversationId,
      conversationTurnId: body.conversationTurnId,
      model: body.model,
      providerThreadId,
      taskId: body.sceneRefId,
    });
    const context = this.object(value, 'media-agent-context-invalid');
    const identity = this.mediaConversationIdentity(
      context.identity,
      body,
      providerThreadId,
    );
    const request = this.object(
      context.request,
      'media-agent-context-invalid',
    ) as unknown as MediaCodexAgentTurnRequest;
    if (request.taskId !== body.sceneRefId || request.model !== body.model) {
      throw new Error('media-agent-context-invalid');
    }
    const policy = buildMediaCodexAgentPolicy(request.taskId);
    const capsule = buildMediaCodexAgentCapsule(request, policy);
    return {
      capsule,
      identity,
      policy,
      prompt: buildMediaCodexAgentTurnPrompt(request, capsule, policy),
      request,
    };
  }

  /**
   * 校验 API 权威返回的 conversation、scene、Task 与 provider thread 元组均匹配当前流请求。
   * @param value - 内部 context 响应中的未知身份对象。
   * @param body - 当前统一 Codex 流请求。
   * @param providerThreadId - API 对话表在请求前声明的期望线程。
   * @returns 可用于 App Server start/resume 决策的规范媒体对话身份。
   * @throws 身份字段缺失或任一值与流请求不一致时抛出错误。
   */
  private mediaConversationIdentity(
    value: unknown,
    body: LlmCodexChatStreamDto,
    providerThreadId: null | string,
  ): MediaGovernanceLlmConversationIdentity {
    const identity = this.object(value, 'media-agent-context-invalid');
    const conversationMatches =
      identity.conversationId === body.conversationId &&
      identity.activeTurnId === body.conversationTurnId;
    const sceneMatches =
      identity.scene === 'media-governance' &&
      identity.sceneRefId === body.sceneRefId;
    const threadValid =
      identity.providerThreadId === null ||
      typeof identity.providerThreadId === 'string';
    const resetValid =
      identity.providerThreadResetRequired === undefined ||
      typeof identity.providerThreadResetRequired === 'boolean';
    if (!conversationMatches || !sceneMatches) {
      throw new Error('media-agent-conversation-identity-mismatch');
    }
    if (
      !threadValid ||
      !resetValid ||
      identity.providerThreadId !== providerThreadId
    ) {
      throw new Error('media-agent-conversation-identity-mismatch');
    }
    return identity as unknown as MediaGovernanceLlmConversationIdentity;
  }

  /**
   * 将通过胶囊、策略和 revision 校验的动态工具请求转发到媒体 API，并统一响应成功或失败。
   * @param transport - 当前 App Server RPC 连接。
   * @param request - App Server 主动工具请求。
   * @param runtime - 当前媒体任务策略、胶囊和请求。
   * @throws 显式校验异常只用于进入本方法内部的失败响应分支，不会穿透 RPC 边界。
   */
  private async handleMediaToolCall(
    transport: UnixWebSocketRpcTransport,
    request: {
      id: number | string;
      method: string;
      params: Record<string, unknown>;
    },
    runtime: LlmCodexMediaRuntime,
  ) {
    if (request.method !== 'item/tool/call') {
      await transport.respond(request.id, {
        result: { contentItems: [], success: false },
      });
      return;
    }
    try {
      const toolName = request.params.tool;
      if (typeof toolName !== 'string') {
        throw new Error('media-agent-tool-invalid');
      }
      const tool = mediaCodexAgentToolFromWireName(toolName);
      if (!tool) throw new Error('media-agent-tool-invalid');
      const argumentsValue = this.object(
        request.params.arguments ?? {},
        'media-agent-tool-invalid',
      );
      const call = validateMediaCodexAgentToolCall(
        {
          arguments: argumentsValue,
          capsuleSha256: runtime.capsule.capsuleSha256,
          manifestSha256: runtime.capsule.manifestSha256,
          policySha256: runtime.policy.policySha256,
          taskId: runtime.request.taskId,
          taskRevision: runtime.request.taskRevision,
          tool,
        },
        runtime.capsule,
        runtime.policy,
      );
      const result = await this.mediaApiClient.call(call);
      await transport.respond(request.id, {
        result: {
          contentItems: [{ text: canonicalJson(result), type: 'inputText' }],
          success: true,
        },
      });
    } catch (error) {
      await transport.respond(request.id, {
        result: {
          contentItems: [
            {
              text: canonicalJson({
                accepted: false,
                code: this.mediaToolErrorCode(error),
                currentStage: runtime.capsule.currentStage,
                tool: request.params.tool,
              }),
              type: 'inputText',
            },
          ],
          success: false,
        },
      });
    }
  }

  /**
   * 从最终 agentMessage 项提取严格媒体治理结果。
   * @param notification - 当前 App Server 通知。
   * @param enabled - 当前回合是否绑定媒体治理上下文；普通对话必须跳过结构化结果解析。
   * @returns 合法结构化结果；其他通知返回 null。
   * @throws 最终回答不是合法 JSON 或不满足媒体结果 Schema 时抛出稳定错误。
   */
  private mediaResult(
    notification: CodexAppServerNotification,
    enabled: boolean,
  ): MediaCodexAgentResult | null {
    if (!enabled) return null;
    if (notification.method !== 'item/completed') return null;
    const item = this.object(
      notification.params.item,
      'media-agent-result-invalid',
    );
    if (
      item.type !== 'agentMessage' ||
      item.phase !== 'final_answer' ||
      typeof item.text !== 'string'
    ) {
      return null;
    }
    try {
      return parseMediaCodexAgentResult(JSON.parse(item.text));
    } catch {
      throw new Error('media-agent-result-invalid');
    }
  }

  /**
   * 把含内部候选投影的媒体结果收敛为 App Server 输出 Schema 的五字段载荷，供 API 回调和消息 metadata 复用。
   * @param result - 已通过严格解析并附加派生候选标识的媒体结果。
   * @returns 不含内部 `candidates` 派生字段的稳定传输载荷。
   */
  private mediaResultPayload(
    result: MediaCodexAgentResult,
  ): MediaCodexAgentWireResult {
    return {
      answer: result.answer,
      candidateSummaries: result.candidateSummaries,
      nextActionLabel: result.nextActionLabel,
      planSha256: result.planSha256,
      status: result.status,
      summary: result.summary,
    };
  }

  /**
   * 将动态工具异常收敛为不含上游正文、内部地址、凭据或堆栈的稳定失败码。
   * @param error - Gateway 校验或内部媒体 API 调用抛出的未知异常。
   * @returns 可安全交给模型用于停止重试和解释当前阻塞的错误码。
   */
  private mediaToolErrorCode(error: unknown) {
    if (!(error instanceof Error)) return 'media-tool-call-rejected';
    if (error.message === 'media-codex-agent-api-request-failed') {
      return 'media-tool-api-rejected';
    }
    if (error.message.includes('identity-mismatch')) {
      return 'media-tool-identity-mismatch';
    }
    if (
      error.message.includes('arguments-invalid') ||
      error.message.includes('tool-invalid')
    ) {
      return 'media-tool-arguments-invalid';
    }
    return 'media-tool-call-rejected';
  }

  /**
   * 要求未知协议值为普通对象。
   * @param value - App Server 响应或通知字段。
   * @param code - 形态不符时抛出的稳定错误码。
   * @returns 普通对象。
   * @throws 输入为空、数组或非对象时抛出错误。
   */
  private object(value: unknown, code: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(code);
    }
    return value as Record<string, unknown>;
  }
}
