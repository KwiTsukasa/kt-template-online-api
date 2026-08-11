import { createConnection } from 'node:net';
import { WebSocket, type RawData } from 'ws';
import {
  MEDIA_CODEX_AGENT_DYNAMIC_TOOLS,
  MEDIA_CODEX_AGENT_RESULT_SCHEMA,
  canonicalJson,
  mediaCodexAgentToolFromWireName,
  type MediaCodexAgentPolicy,
  type MediaCodexAgentTool,
} from '../domain/media-codex-agent.contract';
import { isMediaCodexAgentTool } from '../domain/media-codex-agent.policy';

type JsonRpcId = number | string;
type JsonRpcObject = Record<string, unknown>;

export interface CodexAppServerThreadState {
  lastTurn: null | {
    id: string;
    status: 'completed' | 'failed' | 'inProgress' | 'interrupted';
  };
  threadId: string;
}

export interface CodexAppServerToolRequest {
  arguments: Record<string, unknown>;
  callId: string;
  threadId: string;
  tool: MediaCodexAgentTool;
  turnId: string;
}

export interface CodexAppServerNotification {
  method: string;
  params: Record<string, unknown>;
}

export interface CodexAppServerAdapter {
  initialize(): Promise<void>;
  onNotification(
    handler: (notification: CodexAppServerNotification) => void | Promise<void>,
  ): void;
  onToolCall(
    handler: (request: CodexAppServerToolRequest) => Promise<unknown>,
  ): void;
  resumeThread(
    threadId: string,
    policy: MediaCodexAgentPolicy,
  ): Promise<CodexAppServerThreadState>;
  startThread(
    policy: MediaCodexAgentPolicy,
  ): Promise<CodexAppServerThreadState>;
  startTurn(
    threadId: string,
    prompt: string,
    policy: MediaCodexAgentPolicy,
  ): Promise<{ turnId: string }>;
}

export interface CodexAppServerRpcTransport {
  connect(): Promise<void>;
  notify(method: string, params?: unknown): Promise<void>;
  onDisconnect(handler: () => void): void;
  onNotification(
    handler: (notification: CodexAppServerNotification) => void | Promise<void>,
  ): void;
  onRequest(
    handler: (request: {
      id: JsonRpcId;
      method: string;
      params: Record<string, unknown>;
    }) => Promise<void>,
  ): void;
  request(method: string, params?: unknown): Promise<unknown>;
  respond(
    id: JsonRpcId,
    response: { error?: JsonRpcObject; result?: unknown },
  ): Promise<void>;
}

export class CodexAppServerClient implements CodexAppServerAdapter {
  private initialized = false;
  private notificationHandler:
    | ((notification: CodexAppServerNotification) => void | Promise<void>)
    | undefined;
  private toolHandler:
    | ((request: CodexAppServerToolRequest) => Promise<unknown>)
    | undefined;

  constructor(private readonly transport: CodexAppServerRpcTransport) {
    this.transport.onDisconnect(() => {
      this.initialized = false;
    });
    this.transport.onRequest((request) => this.handleServerRequest(request));
    this.transport.onNotification((notification) =>
      this.notificationHandler?.(notification),
    );
  }

  async initialize() {
    if (this.initialized) return;
    await this.transport.connect();
    await this.transport.request('initialize', {
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
      },
      clientInfo: {
        name: 'kt-media-codex-agent-gateway',
        title: 'KT 媒体治理 CodexAgent Gateway',
        version: '1.0.0',
      },
    });
    await this.transport.notify('initialized');
    this.initialized = true;
  }

  onNotification(
    handler: (notification: CodexAppServerNotification) => void | Promise<void>,
  ) {
    this.notificationHandler = handler;
  }

  onToolCall(
    handler: (request: CodexAppServerToolRequest) => Promise<unknown>,
  ) {
    this.toolHandler = handler;
  }

  async startThread(
    policy: MediaCodexAgentPolicy,
  ): Promise<CodexAppServerThreadState> {
    await this.initialize();
    const response = asObject(
      await this.transport.request('thread/start', {
        approvalPolicy: 'never',
        baseInstructions: policy.staticPrompt,
        cwd: policy.cleanCwd,
        dynamicTools: MEDIA_CODEX_AGENT_DYNAMIC_TOOLS,
        environments: [],
        ephemeral: false,
        historyMode: 'paginated',
        permissions: policy.permissionProfile,
        runtimeWorkspaceRoots: [],
        selectedCapabilityRoots: [],
        serviceName: 'kt-media-governance',
        sessionStartSource: 'startup',
        threadSource: 'kt-media-governance',
      }),
      'app-server-thread-start-invalid',
    );
    this.assertThreadBoundary(response, policy);
    return this.projectThread(response);
  }

  async resumeThread(
    threadId: string,
    policy: MediaCodexAgentPolicy,
  ): Promise<CodexAppServerThreadState> {
    await this.initialize();
    const response = asObject(
      await this.transport.request('thread/resume', {
        approvalPolicy: 'never',
        baseInstructions: policy.staticPrompt,
        cwd: policy.cleanCwd,
        excludeTurns: false,
        permissions: policy.permissionProfile,
        runtimeWorkspaceRoots: [],
        threadId,
      }),
      'app-server-thread-resume-invalid',
    );
    this.assertThreadBoundary(response, policy);
    const projected = this.projectThread(response);
    if (projected.threadId !== threadId) {
      throw new Error('app-server-thread-identity-mismatch');
    }
    return projected;
  }

  async startTurn(
    threadId: string,
    prompt: string,
    policy: MediaCodexAgentPolicy,
  ) {
    await this.initialize();
    const response = asObject(
      await this.transport.request('turn/start', {
        approvalPolicy: 'never',
        cwd: policy.cleanCwd,
        input: [{ text: prompt, text_elements: [], type: 'text' }],
        outputSchema: MEDIA_CODEX_AGENT_RESULT_SCHEMA,
        permissions: policy.permissionProfile,
        threadId,
      }),
      'app-server-turn-start-invalid',
    );
    const turn = asObject(response.turn, 'app-server-turn-start-invalid');
    if (typeof turn.id !== 'string' || !turn.id) {
      throw new Error('app-server-turn-start-invalid');
    }
    return { turnId: turn.id };
  }

  private async handleServerRequest(request: {
    id: JsonRpcId;
    method: string;
    params: Record<string, unknown>;
  }) {
    if (request.method !== 'item/tool/call') {
      await this.transport.respond(request.id, {
        error: {
          code: -32001,
          message: 'media-codex-agent-boundary-denied',
        },
      });
      return;
    }
    const params = request.params;
    const tool =
      typeof params.tool === 'string'
        ? mediaCodexAgentToolFromWireName(params.tool)
        : undefined;
    if (
      !this.toolHandler ||
      typeof params.threadId !== 'string' ||
      typeof params.turnId !== 'string' ||
      typeof params.callId !== 'string' ||
      !tool ||
      !isMediaCodexAgentTool(tool)
    ) {
      await this.transport.respond(request.id, {
        result: { contentItems: [], success: false },
      });
      return;
    }
    try {
      const result = await this.toolHandler({
        arguments: asObject(
          params.arguments ?? {},
          'app-server-tool-arguments-invalid',
        ),
        callId: params.callId,
        threadId: params.threadId,
        tool,
        turnId: params.turnId,
      });
      await this.transport.respond(request.id, {
        result: {
          contentItems: [{ text: canonicalJson(result), type: 'inputText' }],
          success: true,
        },
      });
    } catch {
      await this.transport.respond(request.id, {
        result: { contentItems: [], success: false },
      });
    }
  }

  private assertThreadBoundary(
    response: Record<string, unknown>,
    policy: MediaCodexAgentPolicy,
  ) {
    const sandbox = asObject(
      response.sandbox,
      'app-server-thread-boundary-mismatch',
    );
    const activePermissionProfile = asObject(
      response.activePermissionProfile,
      'app-server-thread-boundary-mismatch',
    );
    if (
      response.approvalPolicy !== 'never' ||
      response.cwd !== policy.cleanCwd ||
      activePermissionProfile.id !== policy.permissionProfile ||
      sandbox.type !== 'readOnly' ||
      sandbox.networkAccess !== false
    ) {
      throw new Error('app-server-thread-boundary-mismatch');
    }
  }

  private projectThread(response: Record<string, unknown>) {
    const thread = asObject(response.thread, 'app-server-thread-invalid');
    if (typeof thread.id !== 'string' || !thread.id) {
      throw new Error('app-server-thread-invalid');
    }
    const turns = Array.isArray(thread.turns) ? thread.turns : [];
    const latest = turns.at(-1);
    const latestTurn =
      latest && typeof latest === 'object' && !Array.isArray(latest)
        ? (latest as Record<string, unknown>)
        : null;
    const allowedStatuses = new Set([
      'completed',
      'failed',
      'inProgress',
      'interrupted',
    ]);
    return {
      lastTurn:
        latestTurn &&
        typeof latestTurn.id === 'string' &&
        typeof latestTurn.status === 'string' &&
        allowedStatuses.has(latestTurn.status)
          ? {
              id: latestTurn.id,
              status: latestTurn.status as
                | 'completed'
                | 'failed'
                | 'inProgress'
                | 'interrupted',
            }
          : null,
      threadId: thread.id,
    };
  }
}

export class UnixWebSocketRpcTransport implements CodexAppServerRpcTransport {
  private connectPromise: Promise<void> | undefined;
  private disconnectHandler: (() => void) | undefined;
  private notificationHandler:
    | ((notification: CodexAppServerNotification) => void | Promise<void>)
    | undefined;
  private readonly pending = new Map<
    JsonRpcId,
    {
      reject: (error: Error) => void;
      resolve: (value: unknown) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private requestHandler:
    | ((request: {
        id: JsonRpcId;
        method: string;
        params: Record<string, unknown>;
      }) => Promise<void>)
    | undefined;
  private sequence = 0;
  private socket: WebSocket | undefined;

  constructor(
    private readonly socketPath: string,
    private readonly timeoutMs = 20_000,
  ) {
    if (!socketPath.startsWith('/')) {
      throw new Error('app-server-socket-path-invalid');
    }
  }

  connect() {
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket('ws://localhost/', {
        createConnection: () => createConnection(this.socketPath),
        handshakeTimeout: this.timeoutMs,
        maxPayload: 1024 * 1024,
        perMessageDeflate: false,
      });
      this.socket = socket;
      let opened = false;
      socket.once('open', () => {
        opened = true;
        resolve();
      });
      socket.on('error', () => {
        this.rejectPending('app-server-disconnected');
        if (!opened) reject(new Error('app-server-connect-failed'));
      });
      socket.on('message', (data, isBinary) =>
        this.readMessage(data, isBinary),
      );
      socket.on('close', () => {
        if (this.socket === socket) this.socket = undefined;
        this.rejectPending('app-server-disconnected');
        this.disconnectHandler?.();
        if (!opened) reject(new Error('app-server-connect-failed'));
      });
    }).finally(() => {
      this.connectPromise = undefined;
    });
    return this.connectPromise;
  }

  async request(method: string, params?: unknown) {
    await this.connect();
    const id = ++this.sequence;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('app-server-request-timeout'));
      }, this.timeoutMs);
      timer.unref?.();
      this.pending.set(id, { reject, resolve, timer });
      this.write({ id, method, params });
    });
  }

  async notify(method: string, params?: unknown) {
    await this.connect();
    this.write({ method, params });
  }

  async respond(
    id: JsonRpcId,
    response: { error?: JsonRpcObject; result?: unknown },
  ) {
    await this.connect();
    this.write({ id, ...response });
  }

  onRequest(
    handler: (request: {
      id: JsonRpcId;
      method: string;
      params: Record<string, unknown>;
    }) => Promise<void>,
  ) {
    this.requestHandler = handler;
  }

  onDisconnect(handler: () => void) {
    this.disconnectHandler = handler;
  }

  onNotification(
    handler: (notification: CodexAppServerNotification) => void | Promise<void>,
  ) {
    this.notificationHandler = handler;
  }

  private readMessage(data: RawData, isBinary: boolean) {
    if (isBinary) return;
    let value: Record<string, unknown>;
    try {
      value = asObject(
        JSON.parse(data.toString()),
        'app-server-message-invalid',
      );
    } catch {
      return;
    }
    void this.routeMessage(value);
  }

  private async routeMessage(message: Record<string, unknown>) {
    if (
      (typeof message.id === 'number' || typeof message.id === 'string') &&
      typeof message.method === 'string'
    ) {
      await this.requestHandler?.({
        id: message.id,
        method: message.method,
        params: asObject(message.params ?? {}, 'app-server-message-invalid'),
      });
      return;
    }
    if (
      (typeof message.id === 'number' || typeof message.id === 'string') &&
      (Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error'))
    ) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error('app-server-request-failed'));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (typeof message.method === 'string') {
      await this.notificationHandler?.({
        method: message.method,
        params: asObject(message.params ?? {}, 'app-server-message-invalid'),
      });
    }
  }

  private write(value: Record<string, unknown>) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('app-server-disconnected');
    }
    this.socket.send(JSON.stringify(value));
  }

  private rejectPending(message: string) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }
}

function asObject(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(code);
  }
  return value as Record<string, unknown>;
}
