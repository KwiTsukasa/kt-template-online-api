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
  deviceVerifyUrl?: string;
  pullQrCodeSig?: string;
  qrcodeUrl: string;
  sessionId: string;
  status: 'qr-pending';
};

export type NewDeviceQrPollResult = {
  message?: string;
  sessionId: string;
  status: Exclude<NewDeviceQrStatus, 'verified'>;
};

export type NewDeviceLoginResult = {
  message?: string;
  sessionId: string;
  status: 'failed' | 'verified';
  success: boolean;
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

  async getNewDeviceQRCode(sessionId: string): Promise<NewDeviceQrCode> {
    const data = (await this.transport.post(
      '/api/QQLogin/GetNewDeviceQRCode',
      { sessionId },
    )) as Record<string, unknown>;
    const qrcodeUrl = this.pickString(
      data.qrcodeUrl,
      data.qrcodeurl,
      data.qrcode,
      data.url,
    );
    const jumpUrl = this.pickString(data.jumpUrl, data.verifyUrl);
    const newDeviceQrcodeUrl = qrcodeUrl || (await this.createQrcode(jumpUrl));
    if (!newDeviceQrcodeUrl) {
      throw new Error('NapCat 未返回新设备验证二维码');
    }

    return {
      deviceVerifyUrl: jumpUrl || undefined,
      pullQrCodeSig: this.pickString(data.newDevicePullQrCodeSig, data.sig),
      qrcodeUrl: newDeviceQrcodeUrl,
      sessionId,
      status: 'qr-pending',
    };
  }

  async pollNewDeviceQR(sessionId: string): Promise<NewDeviceQrPollResult> {
    const data = (await this.transport.post(
      '/api/QQLogin/PollNewDeviceQR',
      { sessionId },
    )) as Record<string, unknown>;
    const status = this.normalizePollStatus(
      this.pickString(data.status, data.state, data.result),
    );

    return {
      message: this.pickString(data.message, data.reason) || undefined,
      sessionId,
      status,
    };
  }

  async newDeviceLogin(sessionId: string): Promise<NewDeviceLoginResult> {
    const data = (await this.transport.post(
      '/api/QQLogin/NewDeviceLogin',
      { sessionId },
    )) as Record<string, unknown>;
    const success = data.success !== false;

    return {
      message: this.pickString(data.message, data.reason) || undefined,
      sessionId,
      status: success ? 'verified' : 'failed',
      success,
    };
  }

  private normalizePollStatus(status: string): NewDeviceQrPollResult['status'] {
    const normalized = status.toLowerCase().replace(/[_\s-]+/g, '');
    if (['scan', 'scanned'].includes(normalized)) return 'scanned';
    if (['confirm', 'confirming'].includes(normalized)) return 'confirming';
    if (['expire', 'expired', 'timeout'].includes(normalized)) return 'expired';
    if (['fail', 'failed', 'error', 'denied'].includes(normalized)) {
      return 'failed';
    }
    return 'qr-pending';
  }

  private pickString(...values: unknown[]) {
    for (const value of values) {
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
    return '';
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
