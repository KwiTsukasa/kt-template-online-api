import * as http from 'http';
import * as https from 'https';
import { createHash, randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { throwVbenError } from '@/common';
import type { QqbotLoginScanMode, QqbotLoginScanStatus } from '../qqbot.types';
import {
  QqbotNapcatContainerService,
  type QqbotNapcatRuntime,
} from '../napcat/qqbot-napcat-container.service';
import { QqbotAccountService } from './qqbot-account.service';

type NapcatApiResponse<T> = {
  code: number;
  data?: T;
  message?: string;
};

type NapcatCredential = {
  Credential?: string;
};

type NapcatLoginInfo = Record<string, any> & {
  avatarUrl?: string;
  nick?: string;
  nickname?: string;
  online?: boolean;
  uin?: number | string;
};

type NapcatLoginStatus = {
  isLogin?: boolean;
  isOffline?: boolean;
  loginError?: string;
  qrcodeurl?: string;
};

type NapcatQrcode = {
  qrcode?: string;
};

type QqbotLoginScanSession = {
  accountId?: string;
  containerId?: string;
  containerName?: string;
  createdAt: number;
  errorMessage?: string;
  expiresAt: number;
  expectedSelfId?: string;
  id: string;
  mode: QqbotLoginScanMode;
  qrcode?: string;
  status: QqbotLoginScanStatus;
  webuiPort?: null | number;
};

export type QqbotLoginScanResult = {
  accountId?: string;
  containerId?: string;
  containerName?: string;
  errorMessage?: string;
  expiresAt?: number;
  mode: QqbotLoginScanMode;
  qrcode?: string;
  selfId?: string;
  sessionId?: string;
  status: QqbotLoginScanStatus;
  webuiPort?: null | number;
};

@Injectable()
export class QqbotNapcatLoginService {
  private readonly sessions = new Map<string, QqbotLoginScanSession>();
  private readonly credentials = new Map<
    string,
    { credential: string; expiresAt: number }
  >();

  constructor(
    private readonly configService: ConfigService,
    private readonly accountService: QqbotAccountService,
    private readonly containerService: QqbotNapcatContainerService,
  ) {}

  async startCreate() {
    const container = await this.containerService.prepareCreateContainer();
    return this.startScan({ mode: 'create' }, container);
  }

  async startRefresh(accountId: string) {
    const account = await this.accountService.findById(accountId);
    if (!account) {
      throwVbenError('QQBot 账号不存在');
    }
    const container = await this.containerService.prepareAccountContainer(
      account,
    );

    return this.startScan(
      {
        accountId: account.id,
        expectedSelfId: account.selfId,
        mode: 'refresh',
      },
      container,
    );
  }

  async refreshQrcode(sessionId: string) {
    const session = this.getSession(sessionId);
    if (session.status !== 'pending') {
      return this.toResult(session);
    }

    const container = await this.getSessionContainer(session);
    await this.callRefreshQrcode(container);
    session.qrcode = await this.getQrcode(container);
    session.expiresAt = Date.now() + this.getSessionTtlMs();
    this.sessions.set(session.id, session);
    return this.toResult(session);
  }

  async status(sessionId: string) {
    const session = this.getSession(sessionId);
    if (Date.now() > session.expiresAt) {
      return this.expireSession(session);
    }

    const container = await this.getSessionContainer(session);
    const status = await this.getLoginStatus(container);
    if (!status.isLogin) {
      session.errorMessage = status.loginError || undefined;
      session.qrcode = status.qrcodeurl || session.qrcode;
      this.sessions.set(session.id, session);
      return this.toResult(session);
    }

    return this.completeLogin(session, container);
  }

  async cancel(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.delete(sessionId);
      await this.cleanupSessionContainer(session);
    }
    return true;
  }

  private async startScan(
    options: {
      accountId?: string;
      expectedSelfId?: string;
      mode: QqbotLoginScanMode;
    },
    container: QqbotNapcatRuntime,
  ): Promise<QqbotLoginScanResult> {
    await this.cleanupSessions();

    try {
      const loginStatus = await this.getLoginStatus(container, true);
      if (loginStatus.isLogin) {
        const session = this.createSession({
          ...options,
          container,
          qrcode: loginStatus.qrcodeurl,
          status: 'success',
        });
        return this.completeLogin(session, container);
      }

      let qrcode = this.isExpiredQrcodeStatus(loginStatus)
        ? ''
        : loginStatus.qrcodeurl || '';
      if (!qrcode) {
        await this.callRefreshQrcode(container, true);
        qrcode = await this.getQrcode(container, true);
      }
      const session = this.createSession({
        ...options,
        container,
        qrcode,
        status: 'pending',
      });
      this.sessions.set(session.id, session);
      return this.toResult(session);
    } catch (err) {
      const cleanupError = await this.cleanupRuntimeContainer(container);
      if (cleanupError) {
        throwVbenError(
          `${this.getErrorMessage(err)}；清理未绑定容器失败：${cleanupError}`,
        );
      }
      throw err;
    }
  }

  private async completeLogin(
    session: QqbotLoginScanSession,
    container: QqbotNapcatRuntime,
  ): Promise<QqbotLoginScanResult> {
    const loginInfo = await this.getLoginInfo(container);
    const selfId = this.getSelfId(loginInfo);
    if (!selfId) {
      return this.failSession(session, 'NapCat 已登录但未返回 QQ 号');
    }
    if (session.expectedSelfId && session.expectedSelfId !== selfId) {
      return this.failSession(
        session,
        `当前扫码账号 ${selfId} 与目标账号 ${session.expectedSelfId} 不一致`,
      );
    }

    const accountId = await this.accountService.ensureScannedAccount({
      accountId: session.accountId,
      name: this.getNickname(loginInfo),
      selfId,
    });
    await this.containerService.bindAccount(accountId, session.containerId);
    session.accountId = accountId;
    session.status = 'success';
    session.errorMessage = undefined;
    this.sessions.set(session.id, session);
    return {
      ...this.toResult(session),
      accountId,
      selfId,
    };
  }

  private createSession(input: {
    accountId?: string;
    container: QqbotNapcatRuntime;
    expectedSelfId?: string;
    mode: QqbotLoginScanMode;
    qrcode?: string;
    status: QqbotLoginScanStatus;
  }): QqbotLoginScanSession {
    const now = Date.now();
    return {
      accountId: input.accountId,
      containerId: input.container.id,
      containerName: input.container.name,
      createdAt: now,
      expectedSelfId: input.expectedSelfId,
      expiresAt: now + this.getSessionTtlMs(),
      id: randomUUID(),
      mode: input.mode,
      qrcode: input.qrcode,
      status: input.status,
      webuiPort: input.container.webuiPort,
    };
  }

  private toResult(session: QqbotLoginScanSession): QqbotLoginScanResult {
    return {
      accountId: session.accountId,
      containerId: session.containerId,
      containerName: session.containerName,
      errorMessage: session.errorMessage,
      expiresAt: session.expiresAt,
      mode: session.mode,
      qrcode: session.qrcode,
      sessionId: session.id,
      status: session.status,
      webuiPort: session.webuiPort,
    };
  }

  private getSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throwVbenError('扫码会话不存在或已过期');
    }
    return session;
  }

  private async getSessionContainer(session: QqbotLoginScanSession) {
    return this.containerService.findRuntimeById(session.containerId);
  }

  private async cleanupSessions() {
    const now = Date.now();
    const expiredSessions: QqbotLoginScanSession[] = [];
    this.sessions.forEach((session, sessionId) => {
      if (session.status !== 'pending' || now > session.expiresAt) {
        this.sessions.delete(sessionId);
        expiredSessions.push(session);
      }
    });
    await Promise.all(
      expiredSessions.map((session) => this.cleanupSessionContainer(session)),
    );
  }

  private async expireSession(session: QqbotLoginScanSession) {
    session.status = 'expired';
    session.errorMessage = session.errorMessage || '扫码会话已过期';
    this.sessions.delete(session.id);
    await this.cleanupSessionContainer(session);
    return this.toResult(session);
  }

  private async failSession(
    session: QqbotLoginScanSession,
    errorMessage: string,
  ) {
    session.status = 'error';
    session.errorMessage = errorMessage;
    this.sessions.delete(session.id);
    await this.cleanupSessionContainer(session);
    return this.toResult(session);
  }

  private async cleanupSessionContainer(session: QqbotLoginScanSession) {
    const cleanupError = await this.cleanupRuntimeContainer({
      baseUrl: '',
      id: session.containerId,
      name: session.containerName || '',
      webuiPort: session.webuiPort,
    });
    if (cleanupError) {
      session.errorMessage = session.errorMessage
        ? `${session.errorMessage}；清理未绑定容器失败：${cleanupError}`
        : `清理未绑定容器失败：${cleanupError}`;
    }
  }

  private async cleanupRuntimeContainer(container: QqbotNapcatRuntime) {
    try {
      await this.containerService.removeUnboundContainer(container.id);
      return null;
    } catch (err) {
      return this.getErrorMessage(err);
    }
  }

  private async getLoginStatus(container: QqbotNapcatRuntime, retry = false) {
    if (!retry) {
      return this.postNapcat<NapcatLoginStatus>(
        container,
        '/api/QQLogin/CheckLoginStatus',
      );
    }

    let lastError: unknown;
    const attempts = Number(
      this.configService.get('NAPCAT_WEBUI_READY_RETRIES') || 10,
    );
    for (let index = 0; index < attempts; index += 1) {
      try {
        return await this.postNapcat<NapcatLoginStatus>(
          container,
          '/api/QQLogin/CheckLoginStatus',
        );
      } catch (err) {
        lastError = err;
        if (!this.isTemporaryNapcatError(err)) break;
        await this.sleep(1500);
      }
    }
    throw lastError;
  }

  private async getLoginInfo(container: QqbotNapcatRuntime) {
    return this.postNapcat<NapcatLoginInfo>(
      container,
      '/api/QQLogin/GetQQLoginInfo',
    );
  }

  private async callRefreshQrcode(
    container: QqbotNapcatRuntime,
    retry = false,
  ) {
    await this.executeNapcatRequest(retry, async () => {
      try {
        await this.postNapcat<null>(container, '/api/QQLogin/RefreshQRcode');
      } catch (err) {
        if (this.isAlreadyLoggedIn(err)) return;
        throw err;
      }
    });
  }

  private async getQrcode(container: QqbotNapcatRuntime, retry = false) {
    return this.executeNapcatRequest(retry, async () => {
      try {
        const data = await this.postNapcat<NapcatQrcode>(
          container,
          '/api/QQLogin/GetQQLoginQrcode',
        );
        if (!data.qrcode) {
          return this.getQrcodeFromStatus(container);
        }
        return data.qrcode;
      } catch (err) {
        if (this.isAlreadyLoggedIn(err)) {
          const status = await this.getLoginStatus(container);
          return status.qrcodeurl || '';
        }
        if (this.isQrcodePending(err)) {
          return this.getQrcodeFromStatus(container);
        }
        throw err;
      }
    });
  }

  private async getQrcodeFromStatus(container: QqbotNapcatRuntime) {
    const status = await this.getLoginStatus(container);
    if (status.qrcodeurl && !this.isExpiredQrcodeStatus(status)) {
      return status.qrcodeurl;
    }
    throwVbenError('NapCat 未返回登录二维码');
  }

  private async postNapcat<T>(
    container: QqbotNapcatRuntime,
    path: string,
    body: Record<string, any> = {},
  ) {
    const credential = await this.getCredential(container);
    return this.requestNapcat<T>(container, path, body, credential);
  }

  private async getCredential(container: QqbotNapcatRuntime) {
    const cacheKey = container.id || container.baseUrl;
    const cached = this.credentials.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.credential;
    }

    const token = this.getWebuiToken(container);
    const hash = createHash('sha256').update(`${token}.napcat`).digest('hex');
    const data = await this.requestNapcat<NapcatCredential>(
      container,
      '/api/auth/login',
      { hash },
    );
    if (!data.Credential) {
      throwVbenError('NapCat WebUI 登录失败');
    }
    this.credentials.set(cacheKey, {
      credential: data.Credential,
      expiresAt: Date.now() + 50 * 60 * 1000,
    });
    return data.Credential;
  }

  private requestNapcat<T>(
    container: QqbotNapcatRuntime,
    path: string,
    body: Record<string, any> = {},
    credential?: string,
  ): Promise<T> {
    const baseUrl = container.baseUrl;
    const target = new URL(path, baseUrl);
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
          timeout: this.getTimeout(),
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
    }).catch((err): never => {
      const message = this.getErrorMessage(err);
      return throwVbenError(message || 'NapCat 请求失败');
    });
  }

  private getWebuiToken(container: QqbotNapcatRuntime) {
    const value = container.webuiToken || '';
    const token = `${value}`.trim();
    if (!token) {
      throwVbenError('NapCat WebUI token 未配置');
    }
    return token;
  }

  private getSessionTtlMs() {
    return Number(
      this.configService.get('NAPCAT_LOGIN_QR_EXPIRE_MS') || 2 * 60 * 1000,
    );
  }

  private getTimeout() {
    return Number(this.configService.get('NAPCAT_WEBUI_TIMEOUT_MS') || 8000);
  }

  private getSelfId(info: NapcatLoginInfo) {
    return `${info.uin || info.self_id || info.selfId || ''}`.trim();
  }

  private getNickname(info: NapcatLoginInfo) {
    return `${info.nick || info.nickname || info.name || ''}`.trim();
  }

  private isAlreadyLoggedIn(err: unknown) {
    return this.getErrorMessage(err).includes('QQ Is Logined');
  }

  private isTemporaryNapcatError(err: unknown) {
    const message = this.getErrorMessage(err);
    return [
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      'NapCat 请求超时',
      'NapCat 未返回登录二维码',
      'QRCode Get Error',
      'socket hang up',
    ].some((keyword) => message.includes(keyword));
  }

  private isQrcodePending(err: unknown) {
    const message = this.getErrorMessage(err);
    return message.includes('QRCode Get Error');
  }

  private isExpiredQrcodeStatus(status: NapcatLoginStatus) {
    const message = status.loginError || '';
    return (
      message.includes('二维码') &&
      (message.includes('过期') || message.includes('失效'))
    );
  }

  private async executeNapcatRequest<T>(
    retry: boolean,
    action: () => Promise<T>,
  ) {
    if (!retry) return action();

    let lastError: unknown;
    const attempts = Number(
      this.configService.get('NAPCAT_WEBUI_READY_RETRIES') || 10,
    );
    for (let index = 0; index < attempts; index += 1) {
      try {
        return await action();
      } catch (err) {
        lastError = err;
        if (!this.isTemporaryNapcatError(err)) break;
        await this.sleep(1500);
      }
    }
    throw lastError;
  }

  private getErrorMessage(err: unknown) {
    const response = (err as any)?.getResponse?.();
    if (typeof response?.msg === 'string') return response.msg;
    if (typeof response?.message === 'string') return response.message;
    return err instanceof Error ? err.message : `${err}`;
  }

  private sleep(ms: number) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
