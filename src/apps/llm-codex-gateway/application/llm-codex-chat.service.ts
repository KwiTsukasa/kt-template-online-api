import { Injectable } from '@nestjs/common';
import type { CodexAppServerNotification } from '../infrastructure/llm-codex-rpc.transport';
import { UnixWebSocketRpcTransport } from '../infrastructure/llm-codex-rpc.transport';
import { LlmCodexGatewayConfigService } from '../config/llm-codex-gateway-config.service';
import {
  LLM_CODEX_NETWORK_ACCESS,
  LLM_CODEX_PERMISSION_PROFILE,
  type LlmCodexModelCapabilityOption,
  type LlmCodexModelItem,
  type LlmCodexModelsResponse,
} from '../domain/llm-codex-runtime.contract';
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
  constructor(private readonly config: LlmCodexGatewayConfigService) {}

  /**
   * 验证统一 App Server 连接已就绪。
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
      return {
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
    const transport = new UnixWebSocketRpcTransport(
      this.config.appServerSocketPath(),
      this.config.timeoutMs(),
    );
    const queue = new CodexNotificationQueue();
    transport.onNotification((notification) => queue.push(notification));
    transport.onDisconnect(() => queue.close('app-server-disconnected'));
    transport.onRequest(async (request) => {
      await transport.respond(request.id, {
        result: { contentItems: [], success: false },
      });
    });
    let threadId = '';
    let turnId = '';
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
      threadId = await this.openThread(transport, body);
      turnId = await this.startTurn(transport, body, threadId);
      yield { model: body.model, threadId, type: 'start' };
      while (true) {
        const notification = await queue.next(signal);
        const identity = this.notificationIdentity(notification);
        if (identity.threadId !== threadId || identity.turnId !== turnId) {
          continue;
        }
        const projected = this.projectNotification(notification, body.model);
        if (!projected) continue;
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
   * @returns App Server 线程标识。
   * @throws 线程响应缺少合法标识、恢复到其他线程或权限边界漂移时抛出错误。
   */
  private async openThread(
    transport: UnixWebSocketRpcTransport,
    body: LlmCodexChatStreamDto,
  ) {
    const cwd = this.config.chatCwd();
    const providerThreadId = body.threadId;
    let response: unknown;
    if (providerThreadId) {
      const params: Record<string, unknown> = {
        approvalPolicy: 'never',
        cwd,
        model: body.model,
        permissions: LLM_CODEX_PERMISSION_PROFILE,
        threadId: providerThreadId,
      };
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
   * 将普通正文提交到已锁定线程，并只传递实时校验后的推理与速度档位。
   * @param transport - 当前独立 App Server RPC 连接。
   * @param body - 模型、正文、客户端消息标识及实时校验后的推理/速度档位。
   * @param threadId - 已创建或恢复的线程标识。
   * @returns App Server 回合标识。
   * @throws App Server 未返回非空回合标识或响应结构不合法时抛出错误。
   */
  private async startTurn(
    transport: UnixWebSocketRpcTransport,
    body: LlmCodexChatStreamDto,
    threadId: string,
  ) {
    const params: Record<string, unknown> = {
      approvalPolicy: 'never',
      clientUserMessageId: body.clientMessageId,
      cwd: this.config.chatCwd(),
      input: [{ text: body.prompt, text_elements: [], type: 'text' }],
      model: body.model,
      permissions: LLM_CODEX_PERMISSION_PROFILE,
      threadId,
    };
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
   * @returns 可见增量或 done；无关通知返回 null。
   * @throws 回合终态被中断、失败或缺少合法结构时抛出稳定错误。
   */
  private projectNotification(
    notification: CodexAppServerNotification,
    model: string,
  ): LlmCodexGatewayStreamEvent | null {
    if (notification.method === 'item/agentMessage/delta') {
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
