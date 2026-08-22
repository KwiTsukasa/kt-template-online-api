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

  constructor(
    private readonly options: {
      getTimeoutMs: () => number;
    },
  ) {}

  /**
   * 携带内部密钥向 NapCat WebUI 网关发送有超时边界的 POST 请求，并解包响应数据。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @param path - 必须保持在受控根目录内的路径。
   * @param body - 用于post的结构化输入；省略时默认采用 `{}`。
   * @returns 返回网关响应解包后的业务数据。
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
   * 按`container`移除登录凭据；从 `getCredentialCacheKey` 读取登录凭据。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   */
  clearCredential(container: NapcatWebuiRuntime) {
    delete this.credentials[this.getCredentialCacheKey(container)];
  }

  /**
   * 按`container`读取登录凭据缓存键。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @returns 规范化后的登录凭据缓存键；主值为空时采用 `container.baseUrl` 兜底。
   */
  private getCredentialCacheKey(container: NapcatWebuiRuntime) {
    return container.id || container.baseUrl;
  }

  /**
   * 按`container`读取登录凭据；当 `cached && Date.now() < cached.expiresAt` 成立时返回 `cached.credential`。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @returns 登录凭据。
   * @throws 当 `!data.Credential` 成立时拒绝当前输入并抛出 `Error`。
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
   * 根据 NapCat WebUI URL 协议选择 HTTP 或 HTTPS，在配置超时内发送 JSON POST 请求，并将非 JSON、异常状态与网络失败转为稳定异常。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @param path - 必须保持在受控根目录内的路径。
   * @param body - 用于`request` 对应结果的结构化输入；省略时默认采用 `{}`。
   * @param credential - 决定`request` 对应结果内容、边界或目标的 `credential` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 完成初始化并携带当前边界配置的`request` 对应。
   */
  private request<T>(
    container: NapcatWebuiRuntime,
    path: string,
    body: Record<string, unknown> = {},
    credential?: string,
  ): Promise<T> {
    const target = new URL(path, container.baseUrl);
    const payload = JSON.stringify(body);
    const client = (() => {
      if (target.protocol === 'https:') {
        return https;
      }
      return http;
    })();

    return new Promise<T>((resolve, reject) => {
      const req = client.request(
        {
          headers: {
            ...((() => {
              if (credential) {
                return {
                  Authorization: `Bearer ${credential}`,
                };
              }
              return {};
            })()),
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
              if (raw) {
                result = JSON.parse(raw);
              } else {
                result = ({ code: -1 } as any);
              }
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
   * 从容器运行态读取并裁剪 NapCat WebUI 令牌；令牌缺失时抛出配置错误。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @returns 从容器运行态读取并裁剪 NapCat WebUI 令牌。
   * @throws 当 `!token` 成立时拒绝当前输入并抛出 `Error`。
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
  constructor(private readonly transport: NapcatLoginApiTransport) {}

  /**
   * 按`input`读取设备二维码；向目标通道投递结果（`transport.post`）。
   * @param input - 用于设备二维码的结构化输入，包含 `uin`、`jumpUrl` 字段。
   * @returns 包含 `bytesToken`、`deviceVerifyUrl`、`pullQrCodeSig`、`qrcodeUrl`、`status` 字段的设备二维码。
   * @throws 当 `!uin || !jumpUrl` 成立时拒绝当前输入并抛出 `Error`；当 `!newDeviceQrcodeUrl` 成立时拒绝当前输入并抛出 `Error`；当 `!bytesToken` 成立时拒绝当前输入并抛出 `Error`。
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
   * 调用 NapCat 新设备二维码状态接口，归一化多种状态字段并提取确认令牌与提示。
   * @param input - 新设备验证的 QQ 号与二维码 `bytesToken`；两者均需为非空文本。
   * @returns 返回归一化的轮询状态，以及 NapCat 可选的确认令牌和提示；后两者缺失时为 `undefined`。
   * @throws 当 QQ 号或 `bytesToken` 为空时抛出 `Error`。
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
   * 根据`input`处理设备Login；向目标通道投递结果（`transport.post`）。
   * @param input - 用于设备Login的结构化输入，包含 `uin`、`passwordMd5`、`newDevicePullQrCodeSig` 字段。
   * @returns 包含 `jumpUrl`、`message`、`needNewDevice`、`pullQrCodeSig`、`status` 字段的设备Login；没有可用结果或提前结束时为 `undefined`。
   * @throws 当 `!uin || !passwordMd5 || input.newDevicePullQrCodeSig == null` 成立时拒绝当前输入并抛出 `Error`。
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
      (() => {
        if (payload && typeof payload === 'object') {
          return (payload as Record<string, unknown>);
        }
        return {};
      })();
    const success =
      (() => {
        if (payload === null || payload === undefined) {
          return true;
        }
        return this.normalizeLoginSuccess(data);
      })();

    return {
      jumpUrl: this.pickString(data.jumpUrl, data.verifyUrl) || undefined,
      message: this.pickString(data.message, data.reason) || undefined,
      needNewDevice: data.needNewDevice === true,
      pullQrCodeSig: this.pickPayload(data.newDevicePullQrCodeSig, data.sig),
      status: (() => {
        if (success) {
          return 'verified';
        }
        return 'failed';
      })(),
      success,
    };
  }

  /**
   * 将`status`规范为轮询状态，使等价输入得到一致表示；当 `typeof status === 'number'` 成立时返回 `'scanned'`。
   * @param status - 决定轮询状态内容、边界或目标的 `status` 值。
   * @returns 当前状态对应的轮询状态，取值为 `'scanned'`、`'confirming'`、`'failed'`、`'qr-pending'`、`'expired'`。
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
   * 将`data`规范为LoginSuccess，使等价输入得到一致表示。
   * @param data - 用于LoginSuccess的领域对象，包含 `needNewDevice`、`status`、`state`、`result` 字段。
   * @returns 满足LoginSuccess约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
   * 按实参顺序返回首个去除首尾空白后仍非空的字符串；没有匹配值时返回空字符串。
   * @param values - 按原有顺序参与按实参顺序返回首个去除首尾空白后仍非空的字符串筛选、合并或汇总的集合；按调用方给定的顺序传递全部剩余实参。
   * @returns 当前状态对应的按实参顺序返回首个去除首尾空白后仍非空的字符串，取值为 `''`。
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
   * 按实参顺序返回首个有效载荷；字符串会去除首尾空白，空字符串与空值被跳过，全部无效时返回 `undefined`。
   * @param values - 按原有顺序参与按实参顺序返回首个有效载荷筛选、合并或汇总的集合；按调用方给定的顺序传递全部剩余实参。
   * @returns 按实参顺序返回首个有效载荷；没有可用结果或提前结束时为 `undefined`。
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
   * 根据`strUrl`处理deriveBytes令牌；从 `searchParams.get` 读取deriveBytes令牌。
   * @param strUrl - 待规范化、请求或同源校验的strURL 地址 URL。
   * @returns 当前状态对应的deriveBytes令牌，取值为 `''`。
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
   * 将`text`转换为二维码数据URL 地址。
   * @param text - 决定二维码数据URL 地址内容、边界或目标的 `text` 值。
   * @returns 当前状态对应的二维码数据URL 地址，取值为 `''`。
   */
  private async toQrcodeDataUrl(text: string) {
    const normalized = this.pickString(text);
    if (!normalized) return '';
    if (normalized.startsWith('data:image/')) return normalized;
    return this.createQrcode(normalized);
  }

  /**
   * 将非空文本生成固定纠错级别、边距和缩放比的 PNG 二维码 Data URL；空文本返回空字符串。
   * @param text - 决定将非空文本生成固定纠错级别、边距和缩放比的 PNG 二维码 Data URL内容、边界或目标的 `text` 值。
   * @returns 当前状态对应的二维码，取值为 `''`。
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
