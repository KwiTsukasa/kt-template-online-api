import { createConnection } from 'node:net';
import { WebSocket, type RawData } from 'ws';

type JsonRpcId = number | string;
type JsonRpcObject = Record<string, unknown>;

export interface CodexAppServerNotification {
  method: string;
  params: Record<string, unknown>;
}

export class UnixWebSocketRpcTransport {
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

  /**
   * 建立并复用 Unix Socket WebSocket 连接，同时绑定断线清理逻辑。
   * @returns 连接打开后兑现的 Promise；已连接时立即完成，正在连接时复用同一 Promise。
   */
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

  /** 主动关闭当前 App Server WebSocket，并拒绝所有尚未完成的请求。 */
  close() {
    const socket = this.socket;
    this.socket = undefined;
    this.rejectPending('app-server-disconnected');
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
  }

  /**
   * 发送带递增标识的 JSON-RPC 请求，并在有界时间内等待响应。
   * @param method - App Server 方法名。
   * @param params - 可选协议参数。
   * @returns 对应请求的响应结果。
   */
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

  /**
   * 仅在初始化完成等无回执场景写出协议帧；请求序号与等待超时槽位均保持不变。
   * @param method - App Server 方法名。
   * @param params - 可选协议参数。
   */
  async notify(method: string, params?: unknown) {
    await this.connect();
    this.write({ method, params });
  }

  /**
   * 将服务端主动请求的原始标识与结果或错误封装成回执，不改动本地等待映射。
   * @param id - 上游请求标识。
   * @param response - 成功结果或错误对象。
   */
  async respond(
    id: JsonRpcId,
    response: { error?: JsonRpcObject; result?: unknown },
  ) {
    await this.connect();
    this.write({ id, ...response });
  }

  /**
   * 替换当前唯一主动请求回调，使服务端发起的请求在统一 RPC 边界内收束。
   * @param handler - 接收请求身份、方法和参数的处理器。
   */
  onRequest(
    handler: (request: {
      id: JsonRpcId;
      method: string;
      params: Record<string, unknown>;
    }) => Promise<void>,
  ) {
    this.requestHandler = handler;
  }

  /**
   * 保存断线收束回调，供外层及时关闭通知队列并停止等待流事件。
   * @param handler - 断线后执行的状态收束函数。
   */
  onDisconnect(handler: () => void) {
    this.disconnectHandler = handler;
  }

  /**
   * 保存无请求标识通知的消费回调，让已解码流事件交给当前会话处理。
   * @param handler - 接收已解码通知的处理器。
   */
  onNotification(
    handler: (notification: CodexAppServerNotification) => void | Promise<void>,
  ) {
    this.notificationHandler = handler;
  }

  /**
   * 解码单条文本帧并将合法 JSON 对象交给路由器。
   * @param data - WebSocket 帧数据。
   * @param isBinary - 当前帧是否为二进制。
   */
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

  /**
   * 按主动请求、请求响应和通知三类 JSON-RPC 消息分派处理。
   * @param message - 已解码的 App Server 消息。
   */
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

  /**
   * 仅在 WebSocket 已打开时发送一帧序列化协议消息，避免断线期间静默丢包。
   * @param value - 待序列化的协议对象。
   * @throws 连接未打开时抛出断线错误。
   */
  private write(value: Record<string, unknown>) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('app-server-disconnected');
    }
    this.socket.send(JSON.stringify(value));
  }

  /**
   * 拒绝并清空所有等待中的请求，避免断线后悬挂。
   * @param message - 传给每个等待请求的稳定错误码。
   */
  private rejectPending(message: string) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }
}

/**
 * 要求协议值为普通对象，并以指定错误码拒绝其他形态。
 * @param value - 待校验协议值。
 * @param code - 形态非法时抛出的稳定错误码。
 * @returns 已校验的普通对象。
 * @throws 输入为空、数组或非对象时抛出错误。
 */
function asObject(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(code);
  }
  return value as Record<string, unknown>;
}
