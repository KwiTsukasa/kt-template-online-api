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

  async post<T>(
    container: NapcatWebuiRuntime,
    path: string,
    body: Record<string, unknown> = {},
  ) {
    const credential = await this.getCredential(container);
    return this.request<T>(container, path, body, credential);
  }

  clearCredential(container: NapcatWebuiRuntime) {
    delete this.credentials[this.getCredentialCacheKey(container)];
  }

  private getCredentialCacheKey(container: NapcatWebuiRuntime) {
    return container.id || container.baseUrl;
  }

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

  async getNewDeviceQRCode(
    input: NewDeviceQrRequest,
  ): Promise<NewDeviceQrCode> {
    const uin = this.pickString(input.uin);
    const jumpUrl = this.pickString(input.jumpUrl);
    if (!uin || !jumpUrl) {
      throw new Error('uin and jumpUrl are required');
    }

    const data = (await this.transport.post(
      '/api/QQLogin/GetNewDeviceQRCode',
      { jumpUrl, uin },
    )) as Record<string, unknown>;
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

  async pollNewDeviceQR(
    input: NewDeviceQrPollRequest,
  ): Promise<NewDeviceQrPollResult> {
    const uin = this.pickString(input.uin);
    const bytesToken = this.pickString(input.bytesToken);
    if (!uin || !bytesToken) {
      throw new Error('uin and bytesToken are required');
    }

    const data = (await this.transport.post(
      '/api/QQLogin/PollNewDeviceQR',
      { bytesToken, uin },
    )) as Record<string, unknown>;
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

    const payload = await this.transport.post(
      '/api/QQLogin/NewDeviceLogin',
      {
        newDevicePullQrCodeSig: input.newDevicePullQrCodeSig,
        passwordMd5,
        uin,
      },
    );
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

  private normalizePollStatus(status: unknown): NewDeviceQrPollResult['status'] {
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

  private normalizeLoginSuccess(data: Record<string, unknown>) {
    if (data.needNewDevice === true) return false;
    const status = this.pickString(data.status, data.state, data.result)
      .toLowerCase()
      .replace(/[_\s-]+/g, '');
    if (['fail', 'failed', 'error', 'denied'].includes(status)) return false;
    if (['ok', 'success', 'verified'].includes(status)) return true;
    return data.success !== false;
  }

  private pickString(...values: unknown[]) {
    for (const value of values) {
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
    return '';
  }

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

  private async toQrcodeDataUrl(text: string) {
    const normalized = this.pickString(text);
    if (!normalized) return '';
    if (normalized.startsWith('data:image/')) return normalized;
    return this.createQrcode(normalized);
  }

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
