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
import { QQBOT_MQTT_TOPICS, QQBOT_REVERSE_WS_PATH } from '../qqbot.constants';
import type {
  QqbotConnectionRole,
  QqbotOneBotActionResponse,
  QqbotOneBotEvent,
  QqbotPendingAction,
} from '../qqbot.types';
import { QqbotAccountService } from '../account/qqbot-account.service';
import { QqbotEventService } from '../event/qqbot-event.service';
import { QqbotBusService } from '../mqtt/qqbot-bus.service';

@Injectable()
export class QqbotReverseWsService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(QqbotReverseWsService.name);
  private readonly connections = new Map<string, WebSocket>();
  private readonly pendingActions = new Map<string, QqbotPendingAction>();
  private server: WebSocketServer | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly moduleRef: ModuleRef,
    private readonly accountService: QqbotAccountService,
    private readonly busService: QqbotBusService,
    private readonly toolsService: ToolsService,
  ) {}

  onApplicationBootstrap() {
    if (!this.isEnabled()) {
      this.logger.log('QQBot runtime 未启用，跳过反向 WS 监听');
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
    this.logger.log(`QQBot 反向 WS 已挂载: ${this.getReversePath()}`);
  }

  onModuleDestroy() {
    this.pendingActions.forEach((pending) => {
      clearTimeout(pending.timer);
      pending.reject(new Error('QQBot runtime stopped'));
    });
    this.pendingActions.clear();
    this.connections.forEach((ws) => ws.close());
    this.server?.close();
  }

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

    const responsePromise = new Promise<QqbotOneBotActionResponse>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          this.pendingActions.delete(echo);
          reject(new Error('OneBot action timeout'));
        }, this.getActionTimeout());
        this.pendingActions.set(echo, { reject, resolve, timer });
      },
    );
    ws.send(JSON.stringify(payload));
    return responsePromise;
  }

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
    await this.busService.publish(QQBOT_MQTT_TOPICS.status(context.selfId), {
      role: context.role,
      selfId: context.selfId,
      status: 'online',
    });

    ws.on('close', async () => {
      this.connections.delete(key);
      await this.accountService.markOffline(context.selfId);
      await this.busService.publish(QQBOT_MQTT_TOPICS.status(context.selfId), {
        role: context.role,
        selfId: context.selfId,
        status: 'offline',
      });
    });
    ws.on('error', async (err) => {
      this.logger.warn(`QQBot WS 错误 ${context.selfId}: ${err.message}`);
      await this.accountService.markOffline(context.selfId, err.message);
    });

    while (queuedMessages.length > 0) {
      await this.consumeMessage(context.selfId, queuedMessages.shift() || '');
    }
  }

  private async consumeMessage(selfId: string, raw: string) {
    try {
      await this.handleMessage(selfId, raw);
    } catch (err) {
      const message = this.toolsService.getErrorMessage(err);
      this.logger.warn(`QQBot 处理 WS 消息失败 ${selfId}: ${message}`);
    }
  }

  private async handleMessage(selfId: string, raw: string) {
    let payload: QqbotOneBotEvent;
    try {
      payload = JSON.parse(raw);
    } catch {
      this.logger.warn('QQBot 收到非 JSON WS 消息，已忽略');
      return;
    }

    if (payload.echo && this.pendingActions.has(`${payload.echo}`)) {
      await this.resolvePendingAction(
        selfId,
        payload as QqbotOneBotActionResponse,
      );
      return;
    }

    if (
      payload.post_type === 'meta_event' &&
      payload.meta_event_type === 'heartbeat'
    ) {
      await this.accountService.markHeartbeat(selfId);
    }
    const eventService = this.moduleRef.get(QqbotEventService, {
      strict: false,
    });
    await eventService.handleIncoming({
      ...payload,
      self_id: payload.self_id || selfId,
    });
  }

  private async resolvePendingAction(
    selfId: string,
    payload: QqbotOneBotActionResponse,
  ) {
    const echo = `${payload.echo}`;
    const pending = this.pendingActions.get(echo);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingActions.delete(echo);
    await this.busService.publish(
      QQBOT_MQTT_TOPICS.response(selfId, echo),
      payload,
    );
    pending.resolve(payload);
  }

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

    const account = await this.accountService.findEnabledBySelfIdWithToken(
      selfId,
    );
    const expectedToken =
      account?.accessToken ||
      this.configService.get<string>('QQBOT_REVERSE_WS_TOKEN') ||
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

  private getWritableConnection(selfId: string) {
    const universal = this.connections.get(
      this.getConnectionKey(selfId, 'Universal'),
    );
    const api = this.connections.get(this.getConnectionKey(selfId, 'API'));
    const ws = api || universal;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error(`QQBot ${selfId} 未连接可用 API WS`);
    }
    return ws;
  }

  private getConnectionKey(selfId: string, role: QqbotConnectionRole) {
    return `${selfId}:${role}`;
  }

  private getReversePath() {
    return (
      this.configService.get<string>('QQBOT_REVERSE_WS_PATH') ||
      QQBOT_REVERSE_WS_PATH
    );
  }

  private getActionTimeout() {
    return Number(this.configService.get('QQBOT_API_TIMEOUT_MS') || 10_000);
  }

  private isEnabled() {
    return `${this.configService.get('QQBOT_ENABLED') || 'false'}` === 'true';
  }

  private isAutoRegisterEnabled() {
    return (
      `${this.configService.get('QQBOT_AUTO_REGISTER_ACCOUNT') || 'true'}` ===
      'true'
    );
  }

  private isReversePath(request: IncomingMessage) {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    return url.pathname === this.getReversePath();
  }

  private normalizeRole(role: string): QqbotConnectionRole {
    if (role === 'API' || role === 'Event') return role;
    return 'Universal';
  }

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
