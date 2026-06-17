import { createHash } from 'crypto';
import * as http from 'http';
import * as https from 'https';
import * as QRCode from 'qrcode';

export type NewDeviceQrStatus =
  | 'confirming'
  | 'expired'
  | 'failed'
  | 'qr-pending'
  | 'scanned'
  | 'verified';

export type NewDeviceQrCode = {
  bytesToken: string;
  deviceVerifyUrl?: string;
  pullQrCodeSig?: unknown;
  qrcodeUrl: string;
  status: 'qr-pending';
  strUrl?: string;
};

export type NewDeviceQrPollResult = {
  confirmToken?: string;
  message?: string;
  status: Exclude<NewDeviceQrStatus, 'verified'>;
};

export type NewDeviceLoginResult = {
  jumpUrl?: string;
  message?: string;
  needNewDevice?: boolean;
  pullQrCodeSig?: unknown;
  status: 'failed' | 'verified';
  success: boolean;
};

export type NewDeviceQrRequest = {
  jumpUrl: string;
  uin: string;
};

export type NewDeviceQrPollRequest = {
  bytesToken: string;
  uin: string;
};

export type NewDeviceLoginRequest = {
  newDevicePullQrCodeSig?: unknown;
  passwordMd5: string;
  uin: string;
};

export type NapcatLoginApiTransport = {
  post(path: string, body: Record<string, unknown>): Promise<unknown>;
};

export type NapcatWebuiRuntime = {
  baseUrl: string;
  id?: string;
  webuiToken?: null | string;
};

type NapcatApiResponse<T> = {
  code: number;
  data?: T;
  message?: string;
};

type NapcatCredential = {
  Credential?: string;
};

export class NapcatWebuiHttpClient {
  private readonly credentials: Record<
    string,
    { credential: string; expiresAt: number } | undefined
  > = {};

  /**
   * 初始化 NapcatWebuiHttpClient 实例。
   * @param options - NapCat列表；影响 constructor 的返回值。
   */
  constructor(
    private readonly options: {
      getTimeoutMs: () => number;
    },
  ) {}

  /**
   * 执行 NapCat 登录运行态流程。
   * @param container - container 输入；驱动 `this.getCredential()` 的 NapCat步骤。
   * @param path - 路由或文件路径；影响 post 的返回值。
   * @param body - 请求体 DTO；承载 NapCat新增、更新、导入或执行字段。
   */
  async post<T>(
    container: NapcatWebuiRuntime,
    path: string,
    body: Record<string, unknown> = {},
  ) {
    const credential = await this.getCredential(container);
    return this.request<T>(container, path, body, credential);
  }

  /**
   * 清理Credential。
   * @param container - container 输入；驱动 `this.getCredentialCacheKey()` 的 NapCat步骤。
   */
  clearCredential(container: NapcatWebuiRuntime) {
    delete this.credentials[this.getCredentialCacheKey(container)];
  }

  /**
   * 查询 NapCat 登录运行态数据。
   * @param container - container 输入；使用 `id`、`baseUrl` 字段生成结果。
   */
  private getCredentialCacheKey(container: NapcatWebuiRuntime) {
    return container.id || container.baseUrl;
  }

  /**
   * 查询 NapCat 登录运行态数据。
   * @param container - container 输入；驱动 `this.getCredentialCacheKey()`、`this.getWebuiToken()` 的 NapCat步骤。
   */
  private async getCredential(container: NapcatWebuiRuntime) {
    const cacheKey = this.getCredentialCacheKey(container);
    const cached = this.credentials[cacheKey];
    if (cached && Date.now() < cached.expiresAt) {
      return cached.credential;
    }

    const token = this.getWebuiToken(container);
    const hash = createHash('sha256').update(`${token}.napcat`).digest('hex');
    const data = await this.request<NapcatCredential>(
      container,
      '/api/auth/login',
      { hash },
    );
    if (!data.Credential) {
      throw new Error('NapCat WebUI 登录失败');
    }
    this.credentials[cacheKey] = {
      credential: data.Credential,
      expiresAt: Date.now() + 50 * 60 * 1000,
    };
    return data.Credential;
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param container - container 输入；使用 `baseUrl` 字段生成结果。
   * @param path - 路由或文件路径；驱动 `URL()` 的 NapCat步骤。
   * @param body - 请求体 DTO；承载 NapCat新增、更新、导入或执行字段。
   * @param credential - credential 输入；影响 request 的返回值。
   * @returns 异步完成后的 NapCat 登录运行态结果。
   */
  private request<T>(
    container: NapcatWebuiRuntime,
    path: string,
    body: Record<string, unknown> = {},
    credential?: string,
  ): Promise<T> {
    const target = new URL(path, container.baseUrl);
    const payload = JSON.stringify(body);
    const client = target.protocol === 'https:' ? https : http;

    return new Promise<T>((resolve, reject) => {
      const req = client.request(
        {
          headers: {
            ...(credential
              ? {
                  Authorization: `Bearer ${credential}`,
                }
              : {}),
            'Content-Length': Buffer.byteLength(payload),
            'Content-Type': 'application/json',
          },
          hostname: target.hostname,
          method: 'POST',
          path: `${target.pathname}${target.search}`,
          port: target.port,
          protocol: target.protocol,
          timeout: this.options.getTimeoutMs(),
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            let result: NapcatApiResponse<T>;
            try {
              result = raw ? JSON.parse(raw) : ({ code: -1 } as any);
            } catch {
              reject(new Error('NapCat 返回非 JSON 响应'));
              return;
            }
            if (result.code !== 0) {
              reject(new Error(result.message || 'NapCat 请求失败'));
              return;
            }
            resolve(result.data as T);
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error('NapCat 请求超时'));
      });
      req.write(payload);
      req.end();
    });
  }

  /**
   * 查询 NapCat 登录运行态数据。
   * @param container - container 输入；使用 `webuiToken` 字段生成结果。
   */
  private getWebuiToken(container: NapcatWebuiRuntime) {
    const token = `${container.webuiToken || ''}`.trim();
    if (!token) {
      throw new Error('NapCat WebUI token 未配置');
    }
    return token;
  }
}

export class NapcatLoginApiClient {
  /**
   * 初始化 NapcatLoginApiClient 实例。
   * @param transport - transport 输入；影响 constructor 的返回值。
   */
  constructor(private readonly transport: NapcatLoginApiTransport) {}

  /**
   * 查询 NapCat 登录运行态数据。
   * @param input - input 输入；使用 `uin`、`jumpUrl` 字段生成结果。
   * @returns NapCat 登录运行态查询结果。
   */
  async getNewDeviceQRCode(
    input: NewDeviceQrRequest,
  ): Promise<NewDeviceQrCode> {
    const uin = this.pickString(input.uin);
    const jumpUrl = this.pickString(input.jumpUrl);
    if (!uin || !jumpUrl) {
      throw new Error('uin and jumpUrl are required');
    }

    const data = (await this.transport.post('/api/QQLogin/GetNewDeviceQRCode', {
      jumpUrl,
      uin,
    })) as Record<string, unknown>;
    const strUrl = this.pickString(data.str_url, data.strUrl);
    const qrcodeSource = this.pickString(
      data.qrcodeUrl,
      data.qrcodeurl,
      data.qrcode,
      data.url,
    );
    const returnedJumpUrl = this.pickString(data.jumpUrl, data.verifyUrl);
    const bytesToken =
      this.pickString(data.bytes_token, data.bytesToken) ||
      this.deriveBytesToken(strUrl);
    const newDeviceQrcodeUrl = await this.toQrcodeDataUrl(
      strUrl || qrcodeSource || returnedJumpUrl || jumpUrl,
    );
    if (!newDeviceQrcodeUrl) {
      throw new Error('NapCat 未返回新设备验证二维码');
    }
    if (!bytesToken) {
      throw new Error('NapCat 未返回新设备验证 bytesToken');
    }

    return {
      bytesToken,
      deviceVerifyUrl: returnedJumpUrl || jumpUrl,
      pullQrCodeSig: this.pickPayload(data.newDevicePullQrCodeSig, data.sig),
      qrcodeUrl: newDeviceQrcodeUrl,
      status: 'qr-pending',
      strUrl: strUrl || undefined,
    };
  }

  /**
   * 轮询New Device QR。
   * @param input - input 输入；使用 `uin`、`bytesToken` 字段生成结果。
   * @returns 异步完成后的 NapCat 登录运行态结果。
   */
  async pollNewDeviceQR(
    input: NewDeviceQrPollRequest,
  ): Promise<NewDeviceQrPollResult> {
    const uin = this.pickString(input.uin);
    const bytesToken = this.pickString(input.bytesToken);
    if (!uin || !bytesToken) {
      throw new Error('uin and bytesToken are required');
    }

    const data = (await this.transport.post('/api/QQLogin/PollNewDeviceQR', {
      bytesToken,
      uin,
    })) as Record<string, unknown>;
    const status = this.normalizePollStatus(
      this.pickPayload(
        data.status,
        data.state,
        data.result,
        data.uint32_guarantee_status,
      ),
    );

    return {
      confirmToken: this.pickString(data.str_nt_succ_token) || undefined,
      message: this.pickString(data.message, data.reason) || undefined,
      status,
    };
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param input - input 输入；使用 `uin`、`passwordMd5`、`newDevicePullQrCodeSig` 字段生成结果。
   * @returns 异步完成后的 NapCat 登录运行态结果。
   */
  async newDeviceLogin(
    input: NewDeviceLoginRequest,
  ): Promise<NewDeviceLoginResult> {
    const uin = this.pickString(input.uin);
    const passwordMd5 = this.pickString(input.passwordMd5);
    if (!uin || !passwordMd5 || input.newDevicePullQrCodeSig == null) {
      throw new Error(
        'uin, passwordMd5 and newDevicePullQrCodeSig are required',
      );
    }

    const payload = await this.transport.post('/api/QQLogin/NewDeviceLogin', {
      newDevicePullQrCodeSig: input.newDevicePullQrCodeSig,
      passwordMd5,
      uin,
    });
    const data =
      payload && typeof payload === 'object'
        ? (payload as Record<string, unknown>)
        : {};
    const success =
      payload === null || payload === undefined
        ? true
        : this.normalizeLoginSuccess(data);

    return {
      jumpUrl: this.pickString(data.jumpUrl, data.verifyUrl) || undefined,
      message: this.pickString(data.message, data.reason) || undefined,
      needNewDevice: data.needNewDevice === true,
      pullQrCodeSig: this.pickPayload(data.newDevicePullQrCodeSig, data.sig),
      status: success ? 'verified' : 'failed',
      success,
    };
  }

  /**
   * 转换 NapCat 登录运行态输入。
   * @param status - NapCat列表；执行 `status.toLowerCase()` 对应的 NapCat步骤。
   * @returns NapCat 登录运行态转换后的值。
   */
  private normalizePollStatus(
    status: unknown,
  ): NewDeviceQrPollResult['status'] {
    if (typeof status === 'number') {
      if (status === 3) return 'scanned';
      if (status === 1) return 'confirming';
      if (status < 0) return 'failed';
      return 'qr-pending';
    }
    if (typeof status !== 'string') return 'qr-pending';

    const normalized = status.toLowerCase().replace(/[_\s-]+/g, '');
    if (['scan', 'scanned'].includes(normalized)) return 'scanned';
    if (['confirm', 'confirming'].includes(normalized)) return 'confirming';
    if (['expire', 'expired', 'timeout'].includes(normalized)) return 'expired';
    if (['fail', 'failed', 'error', 'denied'].includes(normalized)) {
      return 'failed';
    }
    return 'qr-pending';
  }

  /**
   * 转换 NapCat 登录运行态输入。
   * @param data - 响应数据；承载 NapCat新增、更新、导入或执行字段。
   */
  private normalizeLoginSuccess(data: Record<string, unknown>) {
    if (data.needNewDevice === true) return false;
    const status = this.pickString(data.status, data.state, data.result)
      .toLowerCase()
      .replace(/[_\s-]+/g, '');
    if (['fail', 'failed', 'error', 'denied'].includes(status)) return false;
    if (['ok', 'success', 'verified'].includes(status)) return true;
    return data.success !== false;
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param values - 配置值字典；驱动 `for()` 的 NapCat步骤。
   */
  private pickString(...values: unknown[]) {
    for (const value of values) {
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
    return '';
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param values - 配置值字典；驱动 `for()` 的 NapCat步骤。
   */
  private pickPayload(...values: unknown[]) {
    for (const value of values) {
      if (value === undefined || value === null) continue;
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) return trimmed;
        continue;
      }
      return value;
    }
    return undefined;
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param strUrl - 访问地址；驱动 `URL()` 的 NapCat步骤。
   */
  private deriveBytesToken(strUrl: string) {
    if (!strUrl) return '';
    try {
      const proofUrl = new URL(strUrl).searchParams.get('str_url') || '';
      if (!proofUrl) return '';
      return Buffer.from(proofUrl, 'utf8').toString('base64');
    } catch {
      return '';
    }
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param text - 待匹配文本；驱动 `this.pickString()` 的 NapCat步骤。
   */
  private async toQrcodeDataUrl(text: string) {
    const normalized = this.pickString(text);
    if (!normalized) return '';
    if (normalized.startsWith('data:image/')) return normalized;
    return this.createQrcode(normalized);
  }

  /**
   * 创建 NapCat 登录运行态对象或配置。
   * @param text - 待匹配文本；驱动 `QRCode.toDataURL()` 的 NapCat步骤。
   */
  private async createQrcode(text: string) {
    if (!text) return '';
    return QRCode.toDataURL(text, {
      errorCorrectionLevel: 'M',
      margin: 1,
      scale: 6,
      type: 'image/png',
    });
  }
}
