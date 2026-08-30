import { Agent as HttpsAgent } from 'node:https';
import { Injectable, Optional } from '@nestjs/common';
import axios, { type AxiosRequestConfig } from 'axios';
import { EnvironmentDashboardConfigService } from '../../environment-dashboard/infrastructure/environment-dashboard-config.service';

interface SunshineHttpClient {
  request<T>(config: AxiosRequestConfig): Promise<{ data: T; status: number }>;
}

export interface SunshineAppPayload {
  name?: string;
  uuid?: string;
  'image-path'?: string;
}

export interface SunshineAppsPayload {
  apps?: SunshineAppPayload[];
}

export interface SunshineVigemStatusPayload {
  installed?: boolean;
  version?: string;
  version_compatible?: boolean;
}

interface SunshinePinPayload {
  status?: boolean;
}

const SUNSHINE_TIMEOUT_MS = 12_000;

@Injectable()
export class SunshineMobileClient {
  private readonly http: SunshineHttpClient;

  constructor(
    private readonly config: EnvironmentDashboardConfigService,
    @Optional() http?: SunshineHttpClient,
  ) {
    this.http = http || axios;
  }

  /**
   * 读取 Sunshine 管理 API 的真实应用目录，并保留完整正文供上层白名单投影。
   * @returns Sunshine `/api/apps` 响应。
   */
  async apps(): Promise<SunshineAppsPayload> {
    this.requireConfigured();
    const response = await this.http.request<SunshineAppsPayload>({
      headers: this.authHeaders(),
      httpsAgent: this.httpsAgent(),
      method: 'GET',
      timeout: SUNSHINE_TIMEOUT_MS,
      url: this.url('api/apps'),
    });
    return response.data;
  }

  /**
   * 读取 Sunshine 对 ViGEmBus 的权威兼容判定，只供上层投影布尔能力状态。
   * @returns Sunshine `/api/vigembus/status` 响应。
   */
  async vigemStatus(): Promise<SunshineVigemStatusPayload> {
    this.requireConfigured();
    const response = await this.http.request<SunshineVigemStatusPayload>({
      headers: this.authHeaders(),
      httpsAgent: this.httpsAgent(),
      method: 'GET',
      timeout: SUNSHINE_TIMEOUT_MS,
      url: this.url('api/vigembus/status'),
    });
    return response.data;
  }

  /**
   * 把 Moonlight 客户端生成的短 PIN 经服务端私有 Basic 凭据提交给 Sunshine。
   * @param pin - 只含十进制数字的临时配对码。
   * @param name - 当前 KwiCore 客户端友好名称。
   * @returns Sunshine 接受请求时为 true。
   */
  async submitPin(pin: string, name: string): Promise<boolean> {
    this.requireConfigured();
    const response = await this.http.request<SunshinePinPayload>({
      data: { name, pin },
      headers: this.authHeaders(),
      httpsAgent: this.httpsAgent(),
      method: 'POST',
      timeout: SUNSHINE_TIMEOUT_MS,
      url: this.url('api/pin'),
    });
    return (
      response.status >= 200 &&
      response.status < 300 &&
      response.data.status === true
    );
  }

  /**
   * 返回固定 Sunshine WireGuard 主机名，不投影管理端口、用户名或密码。
   * @returns 管理 URL 中的主机名。
   */
  host(): string {
    this.requireConfigured();
    return new URL(this.baseUrl()).hostname;
  }

  /**
   * 从固定 Sunshine Web UI 端口推导 GameStream TLS 端口，保持与版本化 port 偏移族一致。
   * @returns KwiCore 原生客户端使用的 HTTPS 端口。
   * @throws Web UI 端口缺失或无法落入有效 GameStream 偏移族时拒绝返回。
   */
  httpsPort(): number {
    return this.streamPort() - 5;
  }

  /**
   * 从固定 Sunshine Web UI 端口推导 GameStream HTTP 基准端口，避免 Android 硬编码生产端口。
   * @returns KwiCore 原生客户端使用的 HTTP 端口。
   * @throws Web UI 端口缺失或无法落入有效 GameStream 偏移族时拒绝返回。
   */
  streamPort(): number {
    this.requireConfigured();
    const webPort = Number.parseInt(new URL(this.baseUrl()).port, 10);
    if (!Number.isInteger(webPort) || webPort <= 6 || webPort > 65_535) {
      throw new Error('Sunshine Web UI 端口配置无效');
    }
    return webPort - 1;
  }

  /**
   * 仅在已校验的 Sunshine 管理基址下解析固定 API 路径，禁止调用方改写主机。
   * @param path - 固定管理 API 路径。
   * @returns 同源 HTTPS URL。
   */
  private url(path: string): string {
    return new URL(path, `${this.baseUrl()}/`).toString();
  }

  /**
   * 返回去除尾斜杠的 Sunshine 管理基址。
   * @returns 已配置 HTTPS 基址。
   */
  private baseUrl(): string {
    return this.config.get('ENV_DASHBOARD_SUNSHINE_URL').replace(/\/+$/u, '');
  }

  /**
   * 为固定 Sunshine 自签 HTTPS 创建仅当前请求使用的 Agent。
   * @returns 允许当前固定主机自签证书的 HTTPS Agent。
   */
  private httpsAgent(): HttpsAgent {
    return new HttpsAgent({ rejectUnauthorized: false });
  }

  /**
   * 构造 Sunshine Basic 与 JSON Header，调用方不得记录返回值。
   * @returns 当前请求使用的私有 Header。
   */
  private authHeaders(): Record<string, string> {
    const username = this.config.get('ENV_DASHBOARD_SUNSHINE_USERNAME');
    const password = this.config.get('ENV_DASHBOARD_SUNSHINE_PASSWORD');
    const encoded = Buffer.from(`${username}:${password}`).toString('base64');
    return {
      Accept: 'application/json',
      Authorization: `Basic ${encoded}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * 在任何外部访问前要求 Sunshine URL、用户名和密码同时存在。
   * @throws 缺少任一生产配置时拒绝请求。
   */
  private requireConfigured(): void {
    const missing = this.config.missing([
      'ENV_DASHBOARD_SUNSHINE_URL',
      'ENV_DASHBOARD_SUNSHINE_USERNAME',
      'ENV_DASHBOARD_SUNSHINE_PASSWORD',
    ]);
    if (missing.length > 0) {
      throw new Error('Sunshine 移动能力配置不完整');
    }
  }
}
