import { Injectable, Optional } from '@nestjs/common';
import axios, { type AxiosRequestConfig } from 'axios';
import { WebSocket } from 'ws';
import { EnvironmentDashboardConfigService } from '../../environment-dashboard/infrastructure/environment-dashboard-config.service';

export interface HomeAssistantStatePayload {
  entity_id: string;
  state: string;
  attributes?: Record<string, unknown>;
  last_changed?: string;
  last_updated?: string;
}

export interface HomeAssistantAreaPayload {
  area_id: string;
  floor_id?: string | null;
  name: string;
}

export interface HomeAssistantDevicePayload {
  area_id?: string | null;
  id: string;
  name?: string | null;
  name_by_user?: string | null;
}

export interface HomeAssistantEntityRegistryPayload {
  area_id?: string | null;
  device_id?: string | null;
  entity_id: string;
  name?: string | null;
  original_name?: string | null;
}

export interface HomeAssistantLogbookPayload {
  entity_id?: string;
  message?: string;
  name?: string;
  state?: string;
  when: string;
}

export interface HomeAssistantSnapshotPayload {
  areas: HomeAssistantAreaPayload[];
  devices: HomeAssistantDevicePayload[];
  entities: HomeAssistantEntityRegistryPayload[];
  logbook: HomeAssistantLogbookPayload[];
  states: HomeAssistantStatePayload[];
}

export interface HomeAssistantServiceCallInput {
  data: Record<string, unknown>;
  domain: string;
  service: string;
}

export interface HomeAssistantAssistInput {
  conversationId?: string;
  language?: string;
  text: string;
}

interface HomeAssistantHttpClient {
  request<T>(config: AxiosRequestConfig): Promise<{ data: T; status: number }>;
}

interface HomeAssistantWsResult<T> {
  id: number;
  result?: T;
  success: boolean;
  type: 'result';
}

const HOME_ASSISTANT_TIMEOUT_MS = 12_000;

@Injectable()
export class HomeAssistantMobileClient {
  private readonly http: HomeAssistantHttpClient;

  constructor(
    private readonly config: EnvironmentDashboardConfigService,
    @Optional() http?: HomeAssistantHttpClient,
  ) {
    this.http = http || axios;
  }

  /**
   * 同时读取状态、区域、设备、实体注册表与最近 24 小时日志，任一权威来源失败时拒绝部分快照。
   * @returns Home Assistant 首批移动能力需要的原始权威快照。
   */
  async snapshot(): Promise<HomeAssistantSnapshotPayload> {
    this.requireConfigured();
    const end = new Date();
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    const [states, areas, devices, entities, logbook] = await Promise.all([
      this.get<HomeAssistantStatePayload[]>('api/states'),
      this.rpc<HomeAssistantAreaPayload[]>({
        type: 'config/area_registry/list',
      }),
      this.rpc<HomeAssistantDevicePayload[]>({
        type: 'config/device_registry/list',
      }),
      this.rpc<HomeAssistantEntityRegistryPayload[]>({
        type: 'config/entity_registry/list',
      }),
      this.get<HomeAssistantLogbookPayload[]>(
        `api/logbook/${encodeURIComponent(start.toISOString())}`,
        { end_time: end.toISOString() },
      ),
    ]);
    return { areas, devices, entities, logbook, states };
  }

  /**
   * 调用 Home Assistant 官方 conversation/process，并只返回当前会话的结构化结果。
   * @param input - 用户文本、语言与可选会话标识。
   * @returns Home Assistant Conversation API 的原始响应。
   */
  async assist(input: HomeAssistantAssistInput): Promise<unknown> {
    this.requireConfigured();
    const body: Record<string, unknown> = { text: input.text };
    if (input.language) body.language = input.language;
    if (input.conversationId) body.conversation_id = input.conversationId;
    return this.post<unknown>('api/conversation/process', body);
  }

  /**
   * 把已通过上层白名单校验的服务调用发送到 Home Assistant，并返回更新后的状态集合。
   * @param input - 固定 domain、service 与脱敏参数。
   * @returns Home Assistant service call 的状态响应。
   */
  async callService(
    input: HomeAssistantServiceCallInput,
  ): Promise<HomeAssistantStatePayload[]> {
    this.requireConfigured();
    return this.post<HomeAssistantStatePayload[]>(
      `api/services/${encodeURIComponent(input.domain)}/${encodeURIComponent(
        input.service,
      )}`,
      input.data,
    );
  }

  /**
   * 读取指定实体在时间窗口内的真实状态历史，查询参数始终由服务端生成。
   * @param entityIds - 已通过实体白名单校验的实体标识。
   * @param startIso - 时间窗口起点。
   * @param endIso - 时间窗口终点。
   * @returns 与实体顺序对应的 Home Assistant 历史状态数组。
   */
  async history(
    entityIds: string[],
    startIso: string,
    endIso: string,
  ): Promise<HomeAssistantStatePayload[][]> {
    this.requireConfigured();
    return this.get<HomeAssistantStatePayload[][]>(
      `api/history/period/${encodeURIComponent(startIso)}`,
      {
        end_time: endIso,
        filter_entity_id: entityIds.join(','),
        minimal_response: true,
        no_attributes: true,
      },
    );
  }

  /**
   * 对 Home Assistant 执行受控 GET，并把 token 仅放入当前请求头。
   * @param path - 相对部署基址的官方 API 路径。
   * @param params - 由服务端构造的查询参数。
   * @returns 完整 JSON 响应数据。
   */
  private async get<T>(
    path: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const response = await this.http.request<T>({
      headers: this.authHeaders(),
      method: 'GET',
      params,
      timeout: HOME_ASSISTANT_TIMEOUT_MS,
      url: this.url(path),
    });
    return response.data;
  }

  /**
   * 对 Home Assistant 执行受控 POST，并把 token 仅放入当前请求头。
   * @param path - 相对部署基址的官方 API 路径。
   * @param data - 已通过上层白名单校验的 JSON 数据。
   * @returns 完整 JSON 响应数据。
   */
  private async post<T>(path: string, data: unknown): Promise<T> {
    const response = await this.http.request<T>({
      data,
      headers: this.authHeaders(),
      method: 'POST',
      timeout: HOME_ASSISTANT_TIMEOUT_MS,
      url: this.url(path),
    });
    return response.data;
  }

  /**
   * 完成 Home Assistant WebSocket auth 握手并执行一个固定类型 RPC，超时或失败时关闭连接并拒绝。
   * @param message - 不含 id 的官方 WebSocket 命令。
   * @returns 命令 success=true 时的 result 字段。
   * @throws 当认证、RPC、JSON 或网络步骤失败时抛出脱敏错误。
   */
  private rpc<T>(message: Record<string, unknown>): Promise<T> {
    const url = this.websocketUrl();
    const token = this.token();
    return new Promise<T>((resolve, reject) => {
      const socket = new WebSocket(url);
      const requestId = 1;
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.terminate();
        reject(new Error('Home Assistant WebSocket RPC 超时'));
      }, HOME_ASSISTANT_TIMEOUT_MS);
      const finish = (error?: Error, value?: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.close();
        if (error) {
          reject(error);
          return;
        }
        resolve(value as T);
      };
      socket.on('message', (raw) => {
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(raw.toString()) as Record<string, unknown>;
        } catch {
          finish(new Error('Home Assistant WebSocket 返回非法 JSON'));
          return;
        }
        if (payload.type === 'auth_required') {
          socket.send(JSON.stringify({ access_token: token, type: 'auth' }));
          return;
        }
        if (payload.type === 'auth_invalid') {
          finish(new Error('Home Assistant WebSocket 认证失败'));
          return;
        }
        if (payload.type === 'auth_ok') {
          socket.send(JSON.stringify({ ...message, id: requestId }));
          return;
        }
        if (payload.type !== 'result' || payload.id !== requestId) return;
        const result = payload as unknown as HomeAssistantWsResult<T>;
        if (!result.success) {
          finish(new Error('Home Assistant WebSocket RPC 失败'));
          return;
        }
        finish(undefined, result.result as T);
      });
      socket.on('error', () => {
        finish(new Error('Home Assistant WebSocket 连接失败'));
      });
    });
  }

  /**
   * 组合 Home Assistant 部署基址和固定 API 路径，禁止调用方传入绝对地址。
   * @param path - 固定相对路径。
   * @returns 同源 API URL。
   */
  private url(path: string): string {
    return new URL(path, `${this.baseUrl()}/`).toString();
  }

  /**
   * 把 Home Assistant HTTP 基址转换为同源 `/api/websocket` 地址。
   * @returns 使用 ws 或 wss 的官方 WebSocket URL。
   */
  private websocketUrl(): string {
    const target = new URL('api/websocket', `${this.baseUrl()}/`);
    if (target.protocol === 'https:') target.protocol = 'wss:';
    if (target.protocol === 'http:') target.protocol = 'ws:';
    return target.toString();
  }

  /**
   * 返回去除尾斜杠的 Home Assistant 基址。
   * @returns 已配置部署基址。
   */
  private baseUrl(): string {
    return this.config
      .get('ENV_DASHBOARD_HOME_ASSISTANT_URL')
      .replace(/\/+$/u, '');
  }

  /**
   * 返回只用于当前服务端请求的 Home Assistant 长效 token。
   * @returns 已配置 token。
   */
  private token(): string {
    return this.config.get('ENV_DASHBOARD_HOME_ASSISTANT_TOKEN');
  }

  /**
   * 构造 Home Assistant Bearer 和 JSON 头，调用方不得记录返回值。
   * @returns 当前请求使用的私有 Header。
   */
  private authHeaders(): Record<string, string> {
    return {
      Accept: 'application/json',
      Authorization: `Bearer ${this.token()}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * 在任何外部访问前要求 URL 与 token 同时存在。
   * @throws 缺少任一生产配置时拒绝请求。
   */
  private requireConfigured(): void {
    const missing = this.config.missing([
      'ENV_DASHBOARD_HOME_ASSISTANT_URL',
      'ENV_DASHBOARD_HOME_ASSISTANT_TOKEN',
    ]);
    if (missing.length > 0) {
      throw new Error('Home Assistant 移动能力配置不完整');
    }
  }
}
