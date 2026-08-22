import type { IncomingMessage } from 'http';
import type { Socket } from 'net';
import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost, ModuleRef } from '@nestjs/core';
import { WebSocket, WebSocketServer } from 'ws';
import { ToolsService } from '@/common';
import {
  BOT_MQTT_TOPICS,
  BOT_REVERSE_WS_PATH,
} from '../../../contract/bot.constants';
import type {
  BotConnectionRole,
  BotOneBotActionResponse,
  BotOneBotEvent,
  BotPendingAction,
} from '../../../contract/bot.types';
import { BotAccountService } from '../../../application/account/bot-account.service';
import { BotEventService } from '../../../application/event/bot-event.service';
import { BotBusService } from '../bus/bot-bus.service';

export class BotReverseWsActionError extends Error {
  constructor(
    public readonly code:
      | 'onebot_disconnected'
      | 'onebot_rejected'
      | 'onebot_timeout',
    message: string,
  ) {
    super(message);
    this.name = 'BotReverseWsActionError';
  }
}

@Injectable()
export class BotReverseWsService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(BotReverseWsService.name);
  private readonly connections = new Map<string, WebSocket>();
  private readonly pendingActions = new Map<string, BotPendingAction>();
  private server: WebSocketServer | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly moduleRef: ModuleRef,
    private readonly accountService: BotAccountService,
    private readonly busService: BotBusService,
    private readonly toolsService: ToolsService,
  ) {}

  onApplicationBootstrap() {
    if (!this.isEnabled()) {
      this.logger.log('Bot runtime 未启用，跳过反向 WS 监听');
      return;
    }

    const httpServer = this.httpAdapterHost.httpAdapter.getHttpServer();
    this.server = new WebSocketServer({ noServer: true });
    httpServer.on(
      'upgrade',
      (request: IncomingMessage, socket: Socket, head) => {
        if (!this.isReversePath(request)) return;
        this.server?.handleUpgrade(request, socket, head, (ws) => {
          this.server?.emit('connection', ws, request);
        });
      },
    );
    this.server.on('connection', (ws, request) => {
      this.handleConnection(ws, request);
    });
    this.logger.log(`Bot 反向 WS 已挂载: ${this.getReversePath()}`);
  }

  onModuleDestroy() {
    this.pendingActions.forEach((pending) => {
      clearTimeout(pending.timer);
      pending.reject(new Error('Bot runtime stopped'));
    });
    this.pendingActions.clear();
    this.connections.forEach((ws) => ws.close());
    this.server?.close();
  }

  /**
   * 按`selfId`、`action`、`params`投递网关动作；从 `getWritableConnection` 读取网关动作。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param action - 决定网关动作内容、边界或目标的 `action` 值。
   * @param params - 决定网关动作内容、边界或目标的 `params` 值。
   * @returns 完成初始化并携带当前边界配置的网关动作。
   */
  async sendAction(
    selfId: string,
    action: string,
    params: Record<string, any>,
  ) {
    const ws = this.getWritableConnection(selfId);
    const echo = `${selfId}-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`;
    const payload = {
      action,
      echo,
      params,
    };

    return new Promise<BotOneBotActionResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingActions.delete(echo);
        this.closeTimedOutConnection(selfId, ws);
        reject(
          new BotReverseWsActionError(
            'onebot_timeout',
            'OneBot action timed out',
          ),
        );
      }, this.getActionTimeout());
      this.pendingActions.set(echo, { reject, resolve, timer });

      try {
        ws.send(JSON.stringify(payload));
      } catch {
        clearTimeout(timer);
        this.pendingActions.delete(echo);
        this.closeCurrentConnection(
          selfId,
          ws,
          'OneBot connection send failed',
        );
        reject(
          new BotReverseWsActionError(
            'onebot_disconnected',
            'OneBot connection is unavailable',
          ),
        );
      }
    });
  }

  /**
   * 根据`selfId`处理连接踢除。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @returns 包含 `count` 字段的连接踢除。
   */
  async kick(selfId: string) {
    let count = 0;
    [...this.connections.entries()].forEach(([key, ws]) => {
      if (!key.startsWith(`${selfId}:`)) return;
      count += 1;
      ws.close(1000, 'Admin kick');
      this.connections.delete(key);
    });
    if (count > 0) await this.accountService.markOffline(selfId);
    return { count };
  }

  /**
   * 通过 `isEnabled` 判断输入是否满足函数约束。
   * @returns 包含 `enabled`、`path`、`sessions` 字段的运行态状态。
   */
  getRuntimeStatus() {
    return {
      enabled: this.isEnabled(),
      path: this.getReversePath(),
      sessions: [...this.connections.keys()],
    };
  }

  private async handleConnection(ws: WebSocket, request: IncomingMessage) {
    let activeSelfId = '';
    const queuedMessages: string[] = [];
    ws.on('message', async (buffer) => {
      const raw = buffer.toString();
      if (!activeSelfId) {
        if (queuedMessages.length >= 50) {
          ws.close(1008, 'too many early messages');
          return;
        }
        queuedMessages.push(raw);
        return;
      }
      await this.consumeMessage(activeSelfId, raw);
    });

    const context = await this.authorize(request);
    if (!context.ok) {
      ws.close(1008, context.message);
      return;
    }

    const key = this.getConnectionKey(context.selfId, context.role);
    this.connections.set(key, ws);
    activeSelfId = context.selfId;
    await this.accountService.markOnline(context.selfId, context.role);
    await this.busService.publish(BOT_MQTT_TOPICS.status(context.selfId), {
      role: context.role,
      selfId: context.selfId,
      status: 'online',
    });

    ws.on('close', async () => {
      if (!this.isCurrentConnection(key, ws)) return;
      this.connections.delete(key);
      await this.accountService.markOffline(context.selfId);
      await this.busService.publish(BOT_MQTT_TOPICS.status(context.selfId), {
        role: context.role,
        selfId: context.selfId,
        status: 'offline',
      });
    });
    ws.on('error', async (err) => {
      this.logger.warn(`Bot WS 错误 ${context.selfId}: ${err.message}`);
      if (!this.isCurrentConnection(key, ws)) return;
      await this.accountService.markOffline(context.selfId, err.message);
    });

    while (queuedMessages.length > 0) {
      await this.consumeMessage(context.selfId, queuedMessages.shift() || '');
    }
  }

  /**
   * 通过 `handleMessage` 交给领域处理器。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param raw - 决定consume消息内容、边界或目标的 `raw` 值。
   */
  private async consumeMessage(selfId: string, raw: string) {
    try {
      await this.handleMessage(selfId, raw);
    } catch (err) {
      const message = this.toolsService.getErrorMessage(err);
      this.logger.warn(`Bot 处理 WS 消息失败 ${selfId}: ${message}`);
    }
  }

  /**
   * 根据`selfId`、`raw`处理消息；当 `payload.echo && this.pendingActions.has(`${payload.echo}`)` 成立时直接结束且不产生返回值。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param raw - 决定消息内容、边界或目标的 `raw` 值。
   */
  private async handleMessage(selfId: string, raw: string) {
    let payload: BotOneBotEvent;
    try {
      payload = JSON.parse(raw);
    } catch {
      this.logger.warn('Bot 收到非 JSON WS 消息，已忽略');
      return;
    }

    if (payload.echo && this.pendingActions.has(`${payload.echo}`)) {
      await this.resolvePendingAction(
        selfId,
        payload as BotOneBotActionResponse,
      );
      return;
    }

    if (
      payload.post_type === 'meta_event' &&
      payload.meta_event_type === 'heartbeat'
    ) {
      await this.accountService.markHeartbeat(selfId);
    }
    const eventService = this.moduleRef.get(BotEventService, {
      strict: false,
    });
    await eventService.handleIncoming({
      ...payload,
      self_id: payload.self_id || selfId,
    });
  }

  /**
   * 从`selfId`、`payload`解析等待状态网关动作；向目标通道投递结果（`busService.publish`）。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param payload - 待按当前协议校验并路由的事件载荷，包含 `echo` 字段。
   */
  private async resolvePendingAction(
    selfId: string,
    payload: BotOneBotActionResponse,
  ) {
    const echo = `${payload.echo}`;
    const pending = this.pendingActions.get(echo);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingActions.delete(echo);
    await this.busService.publish(
      BOT_MQTT_TOPICS.response(selfId, echo),
      payload,
    );
    pending.resolve(payload);
  }

  /**
   * 仅关闭仍对应给定连接标识的反向 WebSocket，避免超时回调误关后续新连接。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param ws - 决定仅关闭仍对应给定连接标识的反向 WebSocket，避免超时回调误关后续新连接内容、边界或目标的 `ws` 值。
   */
  private closeTimedOutConnection(selfId: string, ws: WebSocket) {
    this.closeCurrentConnection(selfId, ws, 'OneBot action timeout');
  }

  /**
   * 按`selfId`、`ws`、`reason`停止当前连接并清理该入口拥有的运行态资源；向目标通道投递结果（`busService.publish`）。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param ws - 决定当前连接内容、边界或目标的 `ws` 值。
   * @param reason - 决定当前连接内容、边界或目标的 `reason` 值。
   */
  private closeCurrentConnection(
    selfId: string,
    ws: WebSocket,
    reason: string,
  ) {
    let closedCurrentConnection = false;
    [...this.connections.entries()].forEach(([key, connection]) => {
      if (!key.startsWith(`${selfId}:`) || connection !== ws) return;
      this.connections.delete(key);
      closedCurrentConnection = true;
      try {
        connection.close(1011, reason);
      } catch {
        // The connection is already unusable; state cleanup is the important part.
      }
    });
    if (!closedCurrentConnection) return;
    void this.accountService.markOffline(selfId, reason).catch(() => undefined);
    void this.busService
      .publish(BOT_MQTT_TOPICS.status(selfId), {
        selfId,
        status: 'offline',
      })
      .catch(() => undefined);
  }

  /**
   * 根据`key`、`ws`与当前约束判定连接；从 `connections.get` 读取连接。
   * @param key - 用于读取或更新连接的稳定键。
   * @param ws - 决定连接内容、边界或目标的 `ws` 值。
   * @returns 满足连接约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isCurrentConnection(key: string, ws: WebSocket) {
    return this.connections.get(key) === ws;
  }

  /**
   * 根据`request`处理authorize；当 `!selfId` 成立时返回 `{ ok: false as const, message: 'missing sel…`。
   * @param request - 用于authorize的当前 HTTP 请求，包含 `url`、`headers` 字段。
   * @returns 包含 `ok`、`role`、`selfId` 字段的authorize。
   */
  private async authorize(request: IncomingMessage) {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const selfId = `${
      request.headers['x-self-id'] || url.searchParams.get('self_id') || ''
    }`.trim();
    const role = this.normalizeRole(
      `${
        request.headers['x-client-role'] ||
        url.searchParams.get('role') ||
        'Universal'
      }`,
    );
    const token = this.readToken(request, url);

    if (!selfId) {
      return { ok: false as const, message: 'missing self id' };
    }

    const account =
      await this.accountService.findEnabledBySelfIdWithToken(selfId);
    const expectedToken =
      account?.accessToken ||
      this.configService.get<string>('BOT_REVERSE_WS_TOKEN') ||
      '';
    if (expectedToken && token !== expectedToken) {
      return { ok: false as const, message: 'invalid token' };
    }
    if (!account) {
      const disabledAccount = await this.accountService.findBySelfId(selfId);
      if (disabledAccount) {
        return { ok: false as const, message: 'account disabled' };
      }
      if (!this.isAutoRegisterEnabled()) {
        return { ok: false as const, message: 'unknown account' };
      }
      await this.accountService.ensureRuntimeAccount(selfId);
    }

    return { ok: true as const, role, selfId };
  }

  /**
   * 按`selfId`读取Writable连接；从 `connections.get` 读取Writable连接。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @returns Writable连接。
   * @throws 当 `!ws || ws.readyState !== WebSocket.OPEN` 成立时拒绝当前输入并抛出 `BotReverseWsActionError`。
   */
  private getWritableConnection(selfId: string) {
    const universal = this.connections.get(
      this.getConnectionKey(selfId, 'Universal'),
    );
    const api = this.connections.get(this.getConnectionKey(selfId, 'API'));
    const ws = api || universal;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new BotReverseWsActionError(
        'onebot_disconnected',
        'OneBot connection is unavailable',
      );
    }
    return ws;
  }

  /**
   * 按 ``${selfId}:${role}`` 计算并返回结果。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param role - 决定连接键内容、边界或目标的 `role` 值。
   * @returns 按参数编码并拼接完成的连接键。
   */
  private getConnectionKey(selfId: string, role: BotConnectionRole) {
    return `${selfId}:${role}`;
  }

  /**
   * 按当前运行态读取Reverse路径；从 `configService.get` 读取Reverse路径。
   * @returns 规范化后的Reverse路径；主值为空时采用 `BOT_REVERSE_WS_PATH` 兜底。
   */
  private getReversePath() {
    return (
      this.configService.get<string>('BOT_REVERSE_WS_PATH') ||
      BOT_REVERSE_WS_PATH
    );
  }

  /**
   * 按当前运行态读取网关动作超时；从 `configService.get` 读取网关动作超时。
   * @returns 网关动作超时。
   */
  private getActionTimeout() {
    return Number(this.configService.get('BOT_API_TIMEOUT_MS') || 10_000);
  }

  /**
   * 根据当前运行态与当前约束判定启用状态；从 `configService.get` 读取启用状态。
   * @returns 满足启用状态约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isEnabled() {
    return `${this.configService.get('BOT_ENABLED') || 'false'}` === 'true';
  }

  /**
   * 根据当前运行态与当前约束判定AutoRegister启用状态；从 `configService.get` 读取AutoRegister启用状态。
   * @returns 满足AutoRegister启用状态约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isAutoRegisterEnabled() {
    return (
      `${this.configService.get('BOT_AUTO_REGISTER_ACCOUNT') || 'true'}` ===
      'true'
    );
  }

  /**
   * 根据`request`与当前约束判定Reverse路径；从 `getReversePath` 读取Reverse路径。
   * @param request - 用于Reverse路径的当前 HTTP 请求，包含 `url`、`headers` 字段。
   * @returns 满足Reverse路径约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isReversePath(request: IncomingMessage) {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    return url.pathname === this.getReversePath();
  }

  /**
   * 将`role`规范为角色，使等价输入得到一致表示。
   * @param role - 决定角色内容、边界或目标的 `role` 值。
   * @returns 当前状态对应的角色，取值为 `'Universal'`。
   */
  private normalizeRole(role: string): BotConnectionRole {
    if (role === 'API' || role === 'Event') return role;
    return 'Universal';
  }

  /**
   * 通过 `authorization.startsWith` 判断输入是否满足函数约束。
   * @param request - 用于令牌的当前 HTTP 请求，包含 `headers` 字段。
   * @param url - 待规范化、请求或同源校验的URL 地址 URL。
   * @returns 规范化后的令牌；主值为空时采用 ``${request.headers['x-onebot-token'] || ''}`` 兜底。
   */
  private readToken(request: IncomingMessage, url: URL) {
    const authorization = `${request.headers.authorization || ''}`;
    if (authorization.startsWith('Bearer ')) return authorization.slice(7);
    return (
      url.searchParams.get('token') ||
      url.searchParams.get('access_token') ||
      `${request.headers['x-onebot-token'] || ''}`
    );
  }
}
