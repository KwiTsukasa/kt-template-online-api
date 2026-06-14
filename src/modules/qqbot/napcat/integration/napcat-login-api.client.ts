export type NewDeviceQrStatus =
  | 'confirming'
  | 'expired'
  | 'failed'
  | 'qr-pending'
  | 'scanned'
  | 'verified';

export type NewDeviceQrCode = {
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
    if (!qrcodeUrl) {
      throw new Error('NapCat 未返回新设备验证二维码');
    }

    return {
      pullQrCodeSig: this.pickString(data.newDevicePullQrCodeSig, data.sig),
      qrcodeUrl,
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
}
