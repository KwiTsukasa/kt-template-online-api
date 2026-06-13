import * as http from 'http';
import * as https from 'https';
import { createHash, randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import { throwVbenError, ToolsService } from '@/common';
import type {
  NapcatApiResponse,
  NapcatCaptchaLoginResult,
  NapcatCredential,
  NapcatLoginInfo,
  NapcatLoginStatus,
  NapcatQrcode,
  NapcatRestartOptions,
  QqbotLoginCaptchaSubmitInput,
  QqbotLoginScanMode,
  QqbotLoginScanEvent,
  QqbotLoginScanResult,
  QqbotLoginScanSession,
  QqbotLoginScanStatus,
  QqbotNapcatRuntime,
  QrcodeLookupOptions,
  QrcodeRefreshOptions,
} from '../qqbot.types';
import { QqbotNapcatContainerService } from '../napcat/qqbot-napcat-container.service';
import { QqbotAccountService } from './qqbot-account.service';

@Injectable()
export class QqbotNapcatLoginService {
  private readonly sessions = new Map<string, QqbotLoginScanSession>();
  private readonly sessionEventLogs = new Map<string, QqbotLoginScanEvent[]>();
  private readonly sessionEventListeners = new Map<
    string,
    Set<(event: QqbotLoginScanEvent) => void>
  >();
  private readonly credentials = new Map<
    string,
    { credential: string; expiresAt: number }
  >();

  constructor(
    private readonly configService: ConfigService,
    private readonly accountService: QqbotAccountService,
    private readonly containerService: QqbotNapcatContainerService,
    private readonly toolsService: ToolsService,
  ) {}

  async startCreate() {
    const container = await this.containerService.prepareCreateContainer();
    return this.startScan({ mode: 'create' }, container);
  }

  async startRefresh(accountId: string) {
    const account =
      await this.accountService.findByIdWithNapcatLoginSecret(accountId);
    if (!account) {
      throwVbenError('QQBot 账号不存在');
    }
    const loginPassword = this.accountService.getNapcatLoginPassword(account);
    const container =
      await this.containerService.prepareAccountContainer(account);

    return this.startScan(
      {
        accountId: account.id,
        expectedSelfId: account.selfId,
        forceRelogin: true,
        hasExistingPrimaryBinding: container.hasExistingPrimaryBinding,
        loginPassword,
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
    if (session.preparingRelogin) {
      return this.keepSessionPending(
        session,
        session.errorMessage || 'NapCat 正在尝试快速登录，请稍后',
      );
    }

    const container = await this.getSessionContainer(session);
    let loginStatus: NapcatLoginStatus;
    try {
      loginStatus = await this.getLoginStatus(container);
    } catch (err) {
      if (!this.toolsService.isNapcatTemporaryError(err)) throw err;
      await this.restartNapcatForLogin(container, { waitForReady: false });
      session.lastRestartedAt = Date.now();
      return this.keepSessionPending(
        session,
        'NapCat 通信超时，已尝试重启容器并重新生成二维码',
        true,
      );
    }

    if (loginStatus.isOffline) {
      if (session.mode === 'refresh') {
        this.publishScanResultEvent(
          session,
          'relogin-reset-start',
          'processing',
          '开始重置 NapCat 登录态',
        );
        await this.resetNapcatForLogin(
          container,
          { waitForReady: false },
          (step, message) => {
            this.publishScanResultEvent(session, step, 'processing', message);
          },
        );
      } else {
        await this.restartNapcatForLogin(container, { waitForReady: false });
      }
      session.lastRestartedAt = Date.now();
      return this.keepSessionPending(
        session,
        loginStatus.loginError || 'NapCat 账号已离线，已重新生成二维码',
        true,
      );
    }

    try {
      session.qrcode = await this.refreshOrGetQrcode(container, false, {
        fallbackStatus: loginStatus,
        requireFresh: true,
        staleQrcode: session.qrcode || loginStatus.qrcodeurl,
      });
      session.expiresAt = Date.now() + this.getSessionTtlMs();
      session.errorMessage = undefined;
      this.sessions.set(session.id, session);
      this.publishScanResultEvent(
        session,
        'qrcode-ready',
        'success',
        '登录二维码已刷新',
      );
      return this.toResult(session);
    } catch (err) {
      if (!this.toolsService.isNapcatTemporaryError(err)) throw err;
      return this.keepSessionPending(
        session,
        'NapCat 正在重新生成二维码，请稍后刷新或等待自动更新',
        true,
      );
    }
  }

  async status(sessionId: string) {
    const session = this.getSession(sessionId);
    if (session.status !== 'pending') {
      return this.toResult(session);
    }
    if (session.preparingRelogin) {
      return this.keepSessionPending(
        session,
        session.errorMessage || 'NapCat 正在准备登录，请稍后',
      );
    }
    if (Date.now() > session.expiresAt) {
      return this.expireSession(session);
    }

    const container = await this.getSessionContainer(session);
    let status: NapcatLoginStatus;
    try {
      status = await this.getLoginStatus(container);
    } catch (err) {
      if (!this.toolsService.isNapcatTemporaryError(err)) throw err;
      return this.keepSessionPending(
        session,
        'NapCat 正在重启或生成二维码，请稍后',
      );
    }
    if (!status.isLogin) {
      const captchaUrl = this.getCaptchaUrlFromStatus(status);
      if (captchaUrl) {
        return this.keepPasswordCaptchaPending(
          session,
          captchaUrl,
          status.loginError,
        );
      }
      if (session.captchaUrl) {
        if (!status.isOffline && !status.loginError) {
          return this.keepPasswordCaptchaPending(
            session,
            session.captchaUrl,
            '等待 QQ 安全验证结果',
          );
        }
        return this.failCaptchaLogin(
          session,
          container,
          status.loginError || '验证码登录未完成',
        );
      }

      session.errorMessage = status.loginError || undefined;
      if (
        status.qrcodeurl &&
        !this.toolsService.isNapcatExpiredQrcodeStatus(status)
      ) {
        const qrcodeChanged = session.qrcode !== status.qrcodeurl;
        session.qrcode = status.qrcodeurl;
        if (qrcodeChanged) {
          this.publishScanResultEvent(
            session,
            'qrcode-ready',
            'success',
            '登录二维码已生成',
          );
        }
      } else if (status.isOffline) {
        session.qrcode = undefined;
      } else if (!this.toolsService.isNapcatExpiredQrcodeStatus(status)) {
        await this.tryUpdatePendingQrcode(container, session, status);
      }
      this.sessions.set(session.id, session);
      return this.toResult(session);
    }

    return this.completeLogin(session, container);
  }

  async submitCaptcha(sessionId: string, input: QqbotLoginCaptchaSubmitInput) {
    const session = this.getSession(sessionId);
    if (session.status !== 'pending') {
      return this.toResult(session);
    }

    const ticket = this.toolsService.toTrimmedString(input.ticket);
    const randstr = this.toolsService.toTrimmedString(input.randstr);
    const sid = this.toolsService.toTrimmedString(input.sid);
    if (!ticket || !randstr) {
      throwVbenError('验证码结果缺失，请重新验证');
    }
    if (!session.captchaUrl) {
      throwVbenError('当前登录会话不需要验证码');
    }
    if (!session.expectedSelfId || !session.passwordMd5) {
      throwVbenError('验证码登录上下文已失效，请重新更新登录');
    }

    const container = await this.getSessionContainer(session);
    this.publishScanResultEvent(
      session,
      'password-login-captcha-submit',
      'processing',
      '正在提交 QQ 安全验证结果',
    );

    let captchaResult: NapcatCaptchaLoginResult | null;
    try {
      captchaResult = await this.postNapcat<NapcatCaptchaLoginResult | null>(
        container,
        '/api/QQLogin/CaptchaLogin',
        {
          passwordMd5: session.passwordMd5,
          randstr,
          sid,
          ticket,
          uin: session.expectedSelfId,
        },
      );
    } catch (err) {
      return this.keepPasswordCaptchaPending(
        session,
        session.captchaUrl,
        this.toolsService.getErrorMessage(err) || '验证码登录失败',
      );
    }

    if (captchaResult?.needNewDevice && captchaResult.jumpUrl) {
      return this.keepSessionPending(
        session,
        '验证码已通过，但 QQ 仍要求新设备验证，请在 NapCat WebUI 继续完成',
        true,
      );
    }

    const loginStatus = await this.waitForPasswordLoginStatus(container);
    if (!loginStatus.isLogin) {
      const captchaUrl = this.getCaptchaUrlFromStatus(loginStatus);
      if (captchaUrl) {
        return this.keepPasswordCaptchaPending(
          session,
          captchaUrl,
          loginStatus.loginError,
        );
      }
      return this.failCaptchaLogin(
        session,
        container,
        `验证码登录未完成：${loginStatus.loginError || 'NapCat 未返回登录成功'}`,
      );
    }

    const loginInfo = await this.getLoginInfo(container);
    const selfId = this.toolsService.pickNapcatSelfId(loginInfo);
    if (loginInfo.online === false || !selfId) {
      return this.failCaptchaLogin(
        session,
        container,
        loginInfo.online === false
          ? 'NapCat 当前账号已离线'
          : 'NapCat 未返回 QQ 号',
      );
    }
    if (session.expectedSelfId && session.expectedSelfId !== selfId) {
      await this.clearRuntimeLoginPasswordAfterFailedPassword(
        session,
        container,
        selfId,
      );
      return this.failSession(
        session,
        `当前密码登录账号 ${selfId} 与目标账号 ${session.expectedSelfId} 不一致`,
      );
    }

    try {
      await this.clearRuntimeLoginPasswordAfterSuccess(
        session,
        container,
        selfId,
      );
    } catch {
      return this.toResult(session);
    }
    return this.completeLogin(session, container, {
      loginInfo,
      successMessage: '验证码登录成功',
    });
  }

  events(sessionId: string) {
    this.getSession(sessionId);
    return new Observable<{ data: QqbotLoginScanEvent }>((subscriber) => {
      const listener = (event: QqbotLoginScanEvent) => {
        subscriber.next({ data: event });
      };
      (this.sessionEventLogs.get(sessionId) || []).forEach(listener);
      const listeners =
        this.sessionEventListeners.get(sessionId) ||
        new Set<(event: QqbotLoginScanEvent) => void>();
      listeners.add(listener);
      this.sessionEventListeners.set(sessionId, listeners);

      return () => {
        listeners.delete(listener);
        if (listeners.size <= 0) {
          this.sessionEventListeners.delete(sessionId);
        }
      };
    });
  }

  async cancel(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session) {
      await this.cleanupPasswordLoginContext(session);
      this.publishScanEvent(session, {
        message: '扫码会话已取消',
        result: this.toResult(session),
        status: 'info',
        step: 'session-cancelled',
      });
      this.sessions.delete(sessionId);
      await this.cleanupSessionContainer(session);
      this.cleanupSessionEvents(sessionId);
    }
    return true;
  }

  private async startScan(
    options: {
      accountId?: string;
      expectedSelfId?: string;
      forceRelogin?: boolean;
      hasExistingPrimaryBinding?: boolean;
      loginPassword?: string;
      mode: QqbotLoginScanMode;
    },
    container: QqbotNapcatRuntime,
  ): Promise<QqbotLoginScanResult> {
    await this.cleanupSessions();

    if (options.forceRelogin) {
      const session = this.createSession({
        ...options,
        container,
        preparingRelogin: true,
        status: 'pending',
      });
      session.lastRestartedAt = Date.now();
      session.errorMessage = this.getReloginPreparingMessage(options);
      this.sessions.set(session.id, session);
      this.publishScanResultEvent(
        session,
        'session-created',
        'processing',
        '已创建更新登录会话',
      );
      const reloginTask = this.prepareReloginQrcode(
        session,
        container,
        options.loginPassword,
        options.hasExistingPrimaryBinding,
      );
      void reloginTask;
      return this.toResult(session);
    }

    try {
      const loginStatus = await this.getLoginStatus(container, true);
      if (loginStatus.isOffline) {
        await this.restartNapcatForLogin(container, { waitForReady: false });
        const session = this.createSession({
          ...options,
          container,
          status: 'pending',
        });
        session.lastRestartedAt = Date.now();
        session.errorMessage =
          loginStatus.loginError || 'NapCat 账号已离线，已重新生成二维码';
        this.sessions.set(session.id, session);
        this.publishScanResultEvent(
          session,
          'container-restarted',
          'processing',
          session.errorMessage,
        );
        return this.toResult(session);
      }

      if (loginStatus.isLogin) {
        const session = this.createSession({
          ...options,
          container,
          qrcode: loginStatus.qrcodeurl,
          status: 'success',
        });
        return this.completeLogin(session, container);
      }

      const qrcode = await this.refreshOrGetQrcode(container, true, {
        fallbackStatus: loginStatus,
        requireFresh:
          this.toolsService.isNapcatExpiredQrcodeStatus(loginStatus),
        staleQrcode: loginStatus.qrcodeurl,
      });
      const session = this.createSession({
        ...options,
        container,
        qrcode,
        status: 'pending',
      });
      this.sessions.set(session.id, session);
      this.publishScanResultEvent(
        session,
        'qrcode-ready',
        'success',
        '登录二维码已生成',
      );
      this.publishScanResultEvent(
        session,
        'waiting-scan',
        'processing',
        '等待扫码确认',
      );
      return this.toResult(session);
    } catch (err) {
      const cleanupError = await this.cleanupRuntimeContainer(container);
      if (cleanupError) {
        throwVbenError(
          `${this.toolsService.getErrorMessage(
            err,
          )}；清理未绑定容器失败：${cleanupError}`,
        );
      }
      throw err;
    }
  }

  private async completeLogin(
    session: QqbotLoginScanSession,
    container: QqbotNapcatRuntime,
    options: { loginInfo?: NapcatLoginInfo; successMessage?: string } = {},
  ): Promise<QqbotLoginScanResult> {
    const loginInfo = options.loginInfo ?? (await this.getLoginInfo(container));
    if (loginInfo.online === false) {
      return this.failSession(session, 'NapCat 当前账号已离线，请重新更新登录');
    }

    const selfId = this.toolsService.pickNapcatSelfId(loginInfo);
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
      name: this.toolsService.pickNapcatNickname(loginInfo),
      selfId,
    });
    await this.containerService.bindAccount(accountId, session.containerId);
    session.accountId = accountId;
    session.captchaUrl = undefined;
    session.status = 'success';
    session.errorMessage = undefined;
    session.passwordMd5 = undefined;
    session.preparingRelogin = false;
    this.sessions.set(session.id, session);
    const result = {
      ...this.toResult(session),
      accountId,
      selfId,
    };
    this.publishScanEvent(session, {
      message: options.successMessage || '扫码登录成功',
      result,
      status: 'success',
      step: 'login-success',
    });
    return result;
  }

  private createSession(input: {
    accountId?: string;
    container: QqbotNapcatRuntime;
    expectedSelfId?: string;
    mode: QqbotLoginScanMode;
    preparingRelogin?: boolean;
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
      preparingRelogin: input.preparingRelogin,
      qrcode: input.qrcode,
      status: input.status,
      webuiPort: input.container.webuiPort,
    };
  }

  private toResult(session: QqbotLoginScanSession): QqbotLoginScanResult {
    return {
      accountId: session.accountId,
      captchaUrl: session.captchaUrl,
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

  private publishScanEvent(
    session: QqbotLoginScanSession,
    input: Omit<QqbotLoginScanEvent, 'createdAt'>,
  ) {
    const event: QqbotLoginScanEvent = {
      ...input,
      createdAt: Date.now(),
    };
    const logs = this.sessionEventLogs.get(session.id) || [];
    logs.push(event);
    this.sessionEventLogs.set(session.id, logs.slice(-50));
    this.sessionEventListeners
      .get(session.id)
      ?.forEach((listener) => listener(event));
  }

  private publishScanResultEvent(
    session: QqbotLoginScanSession,
    step: string,
    status: QqbotLoginScanEvent['status'],
    message: string,
  ) {
    if (session.status === 'pending') {
      session.expiresAt = Date.now() + this.getSessionTtlMs();
      this.sessions.set(session.id, session);
    }
    this.publishScanEvent(session, {
      message,
      result: this.toResult(session),
      status,
      step,
    });
  }

  private cleanupSessionEvents(sessionId: string) {
    this.sessionEventLogs.delete(sessionId);
    this.sessionEventListeners.delete(sessionId);
  }

  private keepSessionPending(
    session: QqbotLoginScanSession,
    errorMessage: string,
    clearQrcode = false,
  ) {
    session.status = 'pending';
    session.errorMessage = errorMessage;
    session.expiresAt = Date.now() + this.getSessionTtlMs();
    if (clearQrcode) session.qrcode = undefined;
    this.sessions.set(session.id, session);
    return this.toResult(session);
  }

  private keepPasswordCaptchaPending(
    session: QqbotLoginScanSession,
    captchaUrl: string,
    reason?: string,
  ) {
    const captchaMessage = '密码登录需要完成 QQ 安全验证';
    const detail = this.toolsService.isNapcatCaptchaRequiredMessage(reason)
      ? ''
      : this.toolsService.toTrimmedString(reason);
    const message = detail ? `${captchaMessage}：${detail}` : captchaMessage;
    const shouldPublish =
      session.captchaUrl !== captchaUrl ||
      !session.errorMessage?.includes(captchaMessage);

    session.status = 'pending';
    session.captchaUrl = captchaUrl;
    session.qrcode = undefined;
    session.errorMessage = message;
    session.expiresAt = Date.now() + this.getSessionTtlMs();
    this.sessions.set(session.id, session);
    if (shouldPublish) {
      this.publishScanResultEvent(
        session,
        'password-login-captcha',
        'processing',
        `${message}，请完成验证码验证`,
      );
    }
    return this.toResult(session);
  }

  private async failCaptchaLogin(
    session: QqbotLoginScanSession,
    container: QqbotNapcatRuntime,
    errorMessage: string,
  ) {
    const cleaned = await this.cleanupPasswordLoginContext(
      session,
      container,
      session.expectedSelfId,
    );
    if (!cleaned) return this.toResult(session);

    session.status = 'error';
    session.captchaUrl = undefined;
    session.errorMessage = errorMessage;
    session.passwordMd5 = undefined;
    session.preparingRelogin = false;
    this.sessions.set(session.id, session);
    this.publishScanEvent(session, {
      message: errorMessage,
      result: this.toResult(session),
      status: 'error',
      step: 'password-login-captcha-failed',
    });
    return this.toResult(session);
  }

  private async cleanupPasswordLoginContext(
    session: QqbotLoginScanSession,
    container?: QqbotNapcatRuntime,
    selfId?: string,
    cleanupFailureMessage?: string,
  ) {
    if (!session.passwordMd5 && !session.captchaUrl) return true;
    const runtime = container || (await this.getSessionContainer(session));
    const failureMessage =
      cleanupFailureMessage ||
      (session.status === 'success'
        ? 'NapCat 密码登录已完成，但运行态密码清理失败，请重试更新登录'
        : 'NapCat 密码登录未完成，且运行态密码清理失败，请重试更新登录');

    this.publishScanResultEvent(
      session,
      'password-env-cleanup',
      'processing',
      '正在移除运行态登录密码',
    );
    const cleaned = await this.containerService.ensureRuntimeLoginEnv(runtime, {
      clearLoginPassword: true,
      selfId: selfId || session.expectedSelfId,
    });
    if (!cleaned.ok) {
      session.status = 'error';
      session.captchaUrl = undefined;
      session.errorMessage = failureMessage;
      session.passwordMd5 = undefined;
      session.preparingRelogin = false;
      this.sessions.set(session.id, session);
      this.publishScanEvent(session, {
        message: failureMessage,
        result: this.toResult(session),
        status: 'error',
        step: 'password-env-cleanup-failed',
      });
      return false;
    }

    session.captchaUrl = undefined;
    session.passwordMd5 = undefined;
    this.sessions.set(session.id, session);
    return true;
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
      expiredSessions.map((session) => this.closeSession(session)),
    );
  }

  private async expireSession(session: QqbotLoginScanSession) {
    const cleaned = await this.cleanupPasswordLoginContext(session);
    if (!cleaned) return this.toResult(session);
    session.status = 'expired';
    session.errorMessage = session.errorMessage || '扫码会话已过期';
    this.publishScanResultEvent(
      session,
      'session-expired',
      'error',
      session.errorMessage,
    );
    this.sessions.delete(session.id);
    await this.closeSession(session);
    return this.toResult(session);
  }

  private async failSession(
    session: QqbotLoginScanSession,
    errorMessage: string,
  ) {
    session.status = 'error';
    session.captchaUrl = undefined;
    session.errorMessage = errorMessage;
    session.passwordMd5 = undefined;
    session.preparingRelogin = false;
    this.publishScanResultEvent(session, 'login-error', 'error', errorMessage);
    this.sessions.delete(session.id);
    await this.closeSession(session);
    return this.toResult(session);
  }

  private async closeSession(session: QqbotLoginScanSession) {
    await this.cleanupPasswordLoginContext(session);
    await this.cleanupSessionContainer(session);
    this.sessions.delete(session.id);
    this.cleanupSessionEvents(session.id);
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

  private async tryUpdatePendingQrcode(
    container: QqbotNapcatRuntime,
    session: QqbotLoginScanSession,
    status: NapcatLoginStatus,
  ) {
    try {
      const qrcode = await this.getQrcode(container, false, {
        requireFresh: !!session.qrcode,
        staleQrcode: session.qrcode || status.qrcodeurl,
      });
      if (qrcode) {
        const qrcodeChanged = session.qrcode !== qrcode;
        session.qrcode = qrcode;
        session.errorMessage = status.loginError || undefined;
        if (qrcodeChanged) {
          this.publishScanResultEvent(
            session,
            'qrcode-ready',
            'success',
            '登录二维码已生成',
          );
        }
      }
    } catch (err) {
      if (!this.toolsService.isNapcatTemporaryError(err)) throw err;
      session.errorMessage =
        session.errorMessage || 'NapCat 正在重新生成二维码，请稍后';
    }
  }

  private async cleanupRuntimeContainer(container: QqbotNapcatRuntime) {
    try {
      await this.containerService.removeUnboundContainer(container.id);
      return null;
    } catch (err) {
      return this.toolsService.getErrorMessage(err);
    }
  }

  private async getLoginStatus(container: QqbotNapcatRuntime, retry = false) {
    if (!retry) {
      const status = await this.postNapcat<NapcatLoginStatus>(
        container,
        '/api/QQLogin/CheckLoginStatus',
      );
      return this.normalizeLoginStatus(container, status);
    }

    let lastError: unknown;
    const attempts = Number(
      this.configService.get('NAPCAT_WEBUI_READY_RETRIES') || 10,
    );
    for (let index = 0; index < attempts; index += 1) {
      try {
        const status = await this.postNapcat<NapcatLoginStatus>(
          container,
          '/api/QQLogin/CheckLoginStatus',
        );
        return await this.normalizeLoginStatus(container, status);
      } catch (err) {
        lastError = err;
        if (!this.toolsService.isNapcatTemporaryError(err)) break;
        await this.toolsService.sleep(1500);
      }
    }
    throw lastError;
  }

  private async normalizeLoginStatus(
    container: QqbotNapcatRuntime,
    status: NapcatLoginStatus,
  ) {
    if (this.toolsService.isNapcatOfflineLoginStatus(status)) {
      return this.toOfflineLoginStatus(status);
    }

    if (!status.isLogin) return status;

    try {
      const loginInfo = await this.getLoginInfo(container);
      if (loginInfo.online === false) {
        return this.toOfflineLoginStatus(
          status,
          'NapCat 账号已离线，请重新扫码登录',
        );
      }
    } catch (err) {
      const errorMessage = this.toolsService.getErrorMessage(err);
      if (this.toolsService.isNapcatOfflineLoginMessage(errorMessage)) {
        return this.toOfflineLoginStatus(status, errorMessage);
      }
      throw err;
    }

    return status;
  }

  private toOfflineLoginStatus(
    status: NapcatLoginStatus,
    errorMessage = 'NapCat 账号已离线，请重新扫码登录',
  ): NapcatLoginStatus {
    return {
      ...status,
      isLogin: false,
      isOffline: true,
      loginError: status.loginError || errorMessage,
    };
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
    return this.executeNapcatRequest(retry, async () => {
      try {
        const data = await this.postNapcat<NapcatQrcode | null>(
          container,
          '/api/QQLogin/RefreshQRcode',
        );
        return this.toolsService.pickQrcode(data);
      } catch (err) {
        if (this.toolsService.isNapcatAlreadyLoggedInError(err)) return '';
        throw err;
      }
    });
  }

  private async getQrcode(
    container: QqbotNapcatRuntime,
    retry = false,
    options: QrcodeLookupOptions = {},
  ) {
    return this.executeNapcatRequest(retry, async () => {
      try {
        const data = await this.postNapcat<NapcatQrcode>(
          container,
          '/api/QQLogin/GetQQLoginQrcode',
        );
        const qrcode = this.toolsService.pickQrcode(data);
        if (!qrcode) {
          return this.getQrcodeFromStatus(container, options);
        }
        return this.toolsService.ensureFreshQrcode(qrcode, options);
      } catch (err) {
        if (this.toolsService.isNapcatAlreadyLoggedInError(err)) {
          const status = await this.getLoginStatus(container);
          return this.toolsService.ensureFreshQrcode(
            status.qrcodeurl || '',
            options,
          );
        }
        if (this.toolsService.isNapcatQrcodePendingError(err)) {
          return this.getQrcodeFromStatus(container, options);
        }
        throw err;
      }
    });
  }

  private async refreshOrGetQrcode(
    container: QqbotNapcatRuntime,
    retry = false,
    options: QrcodeRefreshOptions = {},
  ) {
    let fallbackStatus = options.fallbackStatus;
    const lookupOptions: QrcodeLookupOptions = {
      requireFresh: options.requireFresh || fallbackStatus?.isOffline,
      staleQrcode: options.staleQrcode || fallbackStatus?.qrcodeurl,
    };
    if (fallbackStatus?.isOffline) {
      await this.restartNapcatForLogin(container);
      fallbackStatus = undefined;
    }
    try {
      const refreshedQrcode = await this.callRefreshQrcode(container, retry);
      if (refreshedQrcode) {
        return this.toolsService.ensureFreshQrcode(
          refreshedQrcode,
          lookupOptions,
        );
      }
      return await this.getQrcode(container, retry, lookupOptions);
    } catch (err) {
      if (
        !lookupOptions.requireFresh &&
        fallbackStatus?.qrcodeurl &&
        !this.toolsService.isNapcatExpiredQrcodeStatus(fallbackStatus)
      ) {
        return fallbackStatus.qrcodeurl;
      }
      throw err;
    }
  }

  private async getQrcodeFromStatus(
    container: QqbotNapcatRuntime,
    options: QrcodeLookupOptions = {},
  ) {
    const status = await this.getLoginStatus(container);
    if (
      status.qrcodeurl &&
      !this.toolsService.isNapcatExpiredQrcodeStatus(status)
    ) {
      return this.toolsService.ensureFreshQrcode(status.qrcodeurl, options);
    }
    if (options.requireFresh && status.qrcodeurl) {
      throw new Error('NapCat 二维码仍未刷新');
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

  private async prepareReloginQrcode(
    session: QqbotLoginScanSession,
    container: QqbotNapcatRuntime,
    loginPassword?: string,
    hasExistingPrimaryBinding = true,
  ) {
    try {
      const password = this.toolsService.toSecretText(loginPassword);
      if (hasExistingPrimaryBinding) {
        const quickLoginCompleted = await this.tryQuickRelogin(
          session,
          container,
          !!password,
        );
        if (quickLoginCompleted) return;
      }

      const passwordLoginCompleted = await this.tryPasswordRelogin(
        session,
        container,
        password,
      );
      if (passwordLoginCompleted) return;

      this.publishScanResultEvent(
        session,
        'relogin-reset-start',
        'processing',
        '开始重置 NapCat 登录态',
      );
      await this.resetNapcatForLogin(
        container,
        { waitForReady: false },
        (step, message) => {
          this.publishScanResultEvent(session, step, 'processing', message);
        },
      );
      session.lastRestartedAt = Date.now();
      this.publishScanResultEvent(
        session,
        'napcat-ready-wait',
        'processing',
        '等待 NapCat WebUI 启动',
      );
      await this.toolsService.sleep(this.getRestartDelayMs());
      this.publishScanResultEvent(
        session,
        'qrcode-fetch',
        'processing',
        '正在获取登录二维码',
      );
      session.qrcode = await this.refreshOrGetQrcode(container, true, {
        requireFresh: true,
      });
      session.errorMessage = undefined;
      session.expiresAt = Date.now() + this.getSessionTtlMs();
      this.publishScanResultEvent(
        session,
        'qrcode-ready',
        'success',
        '登录二维码已生成',
      );
      this.publishScanResultEvent(
        session,
        'waiting-scan',
        'processing',
        '等待扫码确认',
      );
    } catch (err) {
      const message = this.toolsService.getErrorMessage(err);
      if (this.toolsService.isNapcatTemporaryError(err)) {
        session.errorMessage =
          'NapCat 正在重新生成二维码，请稍后刷新或等待自动更新';
        this.publishScanResultEvent(
          session,
          'qrcode-pending',
          'processing',
          session.errorMessage,
        );
      } else {
        session.status = 'error';
        session.errorMessage = message || 'NapCat 重置登录态失败';
        session.preparingRelogin = false;
        this.publishScanResultEvent(
          session,
          'relogin-error',
          'error',
          session.errorMessage,
        );
      }
    } finally {
      const current = this.sessions.get(session.id);
      if (current === session && current.status === 'pending') {
        current.preparingRelogin = false;
        this.sessions.set(current.id, current);
      }
    }
  }

  private async tryQuickRelogin(
    session: QqbotLoginScanSession,
    container: QqbotNapcatRuntime,
    hasPasswordFallback = false,
  ) {
    let loginInfo: NapcatLoginInfo;
    session.errorMessage = 'NapCat 正在尝试快速登录，请稍后';
    this.sessions.set(session.id, session);
    this.publishScanResultEvent(
      session,
      'quick-login-start',
      'processing',
      '正在尝试 NapCat -q 快速登录',
    );
    await this.clearRuntimeLoginPasswordBeforeQuick(session, container);

    try {
      await this.restartNapcatForLogin(container, { waitForReady: false });
      session.lastRestartedAt = Date.now();
      this.publishScanResultEvent(
        session,
        'quick-login-wait',
        'processing',
        '等待 NapCat 快速登录结果',
      );
      await this.toolsService.sleep(this.getRestartDelayMs());
      const loginStatus = await this.getLoginStatus(container, true);
      if (!loginStatus.isLogin) {
        this.publishQuickLoginFallback(
          session,
          loginStatus.loginError,
          hasPasswordFallback,
        );
        return false;
      }

      loginInfo = await this.getLoginInfo(container);
      if (loginInfo.online === false) {
        this.publishQuickLoginFallback(
          session,
          'NapCat 当前账号已离线',
          hasPasswordFallback,
        );
        return false;
      }

      const selfId = this.toolsService.pickNapcatSelfId(loginInfo);
      if (!selfId) {
        this.publishQuickLoginFallback(
          session,
          'NapCat 未返回 QQ 号',
          hasPasswordFallback,
        );
        return false;
      }
      if (session.expectedSelfId && session.expectedSelfId !== selfId) {
        this.publishQuickLoginFallback(
          session,
          `当前快速登录账号 ${selfId} 与目标账号 ${session.expectedSelfId} 不一致`,
          hasPasswordFallback,
        );
        return false;
      }
    } catch (err) {
      this.publishQuickLoginFallback(
        session,
        this.toolsService.getErrorMessage(err),
        hasPasswordFallback,
      );
      return false;
    }

    await this.completeLogin(session, container, {
      loginInfo,
      successMessage: '快速登录成功',
    });
    return true;
  }

  private async tryPasswordRelogin(
    session: QqbotLoginScanSession,
    container: QqbotNapcatRuntime,
    loginPassword?: string,
  ) {
    const password = this.toolsService.toSecretText(loginPassword);
    if (!password) {
      this.publishPasswordLoginFallback(session, '未配置 QQ 登录密码');
      return false;
    }

    let loginInfo: NapcatLoginInfo | undefined;
    let loggedInSelfId = '';
    session.passwordMd5 = createHash('md5')
      .update(password, 'utf8')
      .digest('hex');
    session.errorMessage = 'NapCat 正在尝试密码登录，请稍后';
    this.sessions.set(session.id, session);
    this.publishScanResultEvent(
      session,
      'password-login-start',
      'processing',
      '正在尝试 NapCat 密码登录',
    );

    const passwordEnv = await this.containerService.ensureRuntimeLoginEnv(
      container,
      {
        loginPassword: password,
        selfId: session.expectedSelfId,
      },
    );
    if (!passwordEnv.ok) {
      this.publishPasswordLoginFallback(session, '运行态密码环境准备失败');
      return false;
    }

    let loginStatus: NapcatLoginStatus;
    try {
      await this.restartNapcatForLogin(container, { waitForReady: false });
      session.lastRestartedAt = Date.now();
      this.publishScanResultEvent(
        session,
        'password-login-wait',
        'processing',
        '等待 NapCat 密码登录结果',
      );
      loginStatus = await this.waitForPasswordLoginStatus(container);

      if (loginStatus.isLogin) {
        loginInfo = await this.getLoginInfo(container);
      }
    } catch (err) {
      await this.clearRuntimeLoginPasswordAfterFailedPassword(
        session,
        container,
        session.expectedSelfId || loggedInSelfId,
      );
      this.publishPasswordLoginFallback(
        session,
        this.toolsService.getErrorMessage(err),
      );
      return false;
    }

    if (!loginStatus.isLogin) {
      if (this.isPasswordQrcodeChallenge(loginStatus)) {
        await this.keepPasswordQrcodePending(session, container, loginStatus);
        return true;
      }
      const captchaUrl = await this.resolvePasswordCaptchaUrl(
        container,
        loginStatus,
        session.lastRestartedAt,
      );
      if (captchaUrl) {
        this.keepPasswordCaptchaPending(
          session,
          captchaUrl,
          loginStatus.loginError,
        );
        return true;
      }

      await this.clearRuntimeLoginPasswordAfterFailedPassword(
        session,
        container,
        session.expectedSelfId,
      );
      this.publishPasswordLoginFallback(session, loginStatus.loginError);
      return false;
    }

    if (loginInfo?.online === false) {
      await this.clearRuntimeLoginPasswordAfterFailedPassword(
        session,
        container,
        session.expectedSelfId,
      );
      this.publishPasswordLoginFallback(session, 'NapCat 当前账号已离线');
      return false;
    }
    if (!loginInfo) {
      await this.clearRuntimeLoginPasswordAfterFailedPassword(
        session,
        container,
        session.expectedSelfId,
      );
      this.publishPasswordLoginFallback(session, 'NapCat 未返回登录信息');
      return false;
    }

    const selfId = this.toolsService.pickNapcatSelfId(loginInfo);
    if (!selfId) {
      await this.clearRuntimeLoginPasswordAfterFailedPassword(
        session,
        container,
        session.expectedSelfId,
      );
      this.publishPasswordLoginFallback(session, 'NapCat 未返回 QQ 号');
      return false;
    }
    loggedInSelfId = selfId;
    if (session.expectedSelfId && session.expectedSelfId !== selfId) {
      await this.clearRuntimeLoginPasswordAfterFailedPassword(
        session,
        container,
        selfId,
      );
      this.publishPasswordLoginFallback(
        session,
        `当前密码登录账号 ${selfId} 与目标账号 ${session.expectedSelfId} 不一致`,
      );
      return false;
    }

    await this.clearRuntimeLoginPasswordAfterSuccess(
      session,
      container,
      loggedInSelfId,
    );
    await this.completeLogin(session, container, {
      loginInfo,
      successMessage: '密码登录成功',
    });
    return true;
  }

  private async keepPasswordQrcodePending(
    session: QqbotLoginScanSession,
    container: QqbotNapcatRuntime,
    loginStatus: NapcatLoginStatus,
  ) {
    await this.clearRuntimeLoginPasswordAfterFailedPassword(
      session,
      container,
      session.expectedSelfId,
    );
    this.publishScanResultEvent(
      session,
      'password-login-qrcode',
      'processing',
      '密码登录未完成，已切换到扫码确认',
    );
    session.qrcode = await this.refreshOrGetQrcode(container, true, {
      fallbackStatus: loginStatus,
      requireFresh: this.toolsService.isNapcatExpiredQrcodeStatus(loginStatus),
      staleQrcode: loginStatus.qrcodeurl,
    });
    session.captchaUrl = undefined;
    session.errorMessage = undefined;
    session.expiresAt = Date.now() + this.getSessionTtlMs();
    this.sessions.set(session.id, session);
    this.publishScanResultEvent(
      session,
      'qrcode-ready',
      'success',
      '登录二维码已生成',
    );
    this.publishScanResultEvent(
      session,
      'waiting-scan',
      'processing',
      '等待扫码确认',
    );
  }

  private async resolvePasswordCaptchaUrl(
    container: QqbotNapcatRuntime,
    loginStatus: NapcatLoginStatus,
    sinceMs?: number,
  ) {
    const statusCaptchaUrl = this.getCaptchaUrlFromStatus(loginStatus);
    if (statusCaptchaUrl) return statusCaptchaUrl;
    if (typeof this.containerService.detectRuntimeCaptchaUrl !== 'function') {
      return '';
    }
    return (
      (await this.containerService.detectRuntimeCaptchaUrl(
        container,
        sinceMs,
      )) || ''
    );
  }

  private getCaptchaUrlFromStatus(status: NapcatLoginStatus) {
    return this.toolsService.extractNapcatCaptchaUrl(status.loginError);
  }

  private isPasswordQrcodeChallenge(status: NapcatLoginStatus) {
    return (
      !!this.toolsService.toTrimmedString(status.qrcodeurl) ||
      this.toolsService.isNapcatExpiredQrcodeStatus(status)
    );
  }

  private async clearRuntimeLoginPasswordBeforeQuick(
    session: QqbotLoginScanSession,
    container: QqbotNapcatRuntime,
  ) {
    this.publishScanResultEvent(
      session,
      'quick-login-cleanup',
      'processing',
      '正在清理运行态登录密码',
    );
    const cleaned = await this.containerService.ensureRuntimeLoginEnv(
      container,
      {
        clearLoginPassword: true,
        selfId: session.expectedSelfId,
      },
    );
    if (!cleaned.ok) {
      throw new Error('NapCat 快速登录前运行态密码清理失败，请重试更新登录');
    }
  }

  private async clearRuntimeLoginPasswordAfterFailedPassword(
    session: QqbotLoginScanSession,
    container: QqbotNapcatRuntime,
    selfId?: string,
  ) {
    const failureMessage =
      'NapCat 密码登录未完成，且运行态密码清理失败，请重试更新登录';
    const cleaned = await this.cleanupPasswordLoginContext(
      session,
      container,
      selfId,
      failureMessage,
    );
    if (!cleaned) {
      throw new Error(failureMessage);
    }
  }

  private async clearRuntimeLoginPasswordAfterSuccess(
    session: QqbotLoginScanSession,
    container: QqbotNapcatRuntime,
    selfId: string,
  ) {
    const failureMessage =
      'NapCat 密码登录已完成，但运行态密码清理失败，请重试更新登录';
    const cleaned = await this.cleanupPasswordLoginContext(
      session,
      container,
      selfId,
      failureMessage,
    );
    if (!cleaned) {
      throw new Error(failureMessage);
    }
  }

  private getReloginPreparingMessage(options: {
    hasExistingPrimaryBinding?: boolean;
    loginPassword?: string;
  }) {
    if (options.hasExistingPrimaryBinding !== false) {
      return 'NapCat 正在尝试快速登录，请稍后';
    }
    return this.toolsService.toSecretText(options.loginPassword)
      ? 'NapCat 正在尝试密码登录，请稍后'
      : 'NapCat 正在准备登录二维码，请稍后';
  }

  private publishQuickLoginFallback(
    session: QqbotLoginScanSession,
    reason?: string,
    hasPasswordFallback = false,
  ) {
    const nextStepMessage = hasPasswordFallback
      ? '开始尝试密码登录'
      : '开始生成二维码';
    session.errorMessage = reason
      ? `快速登录未完成：${reason}，${nextStepMessage}`
      : `快速登录未完成，${nextStepMessage}`;
    this.sessions.set(session.id, session);
    this.publishScanResultEvent(
      session,
      'quick-login-fallback',
      'processing',
      session.errorMessage,
    );
  }

  private publishPasswordLoginFallback(
    session: QqbotLoginScanSession,
    reason?: string,
  ) {
    session.errorMessage = reason
      ? `密码登录未完成：${reason}，开始生成二维码`
      : '密码登录未完成，开始生成二维码';
    this.sessions.set(session.id, session);
    this.publishScanResultEvent(
      session,
      'password-login-fallback',
      'processing',
      session.errorMessage,
    );
  }

  private async resetNapcatForLogin(
    container: QqbotNapcatRuntime,
    options: NapcatRestartOptions = {},
    onProgress?: (step: string, message: string) => void,
  ) {
    const resetByContainer = await this.containerService.resetRuntimeLoginState(
      container,
      onProgress,
    );
    if (!resetByContainer) {
      onProgress?.('napcat-restart-webui', '正在调用 NapCat 重启接口');
      await this.restartNapcatForLogin(container, options);
      return;
    }

    this.credentials.delete(this.getCredentialCacheKey(container));
    if (options.waitForReady === false) return;

    onProgress?.('napcat-ready-wait', '等待 NapCat WebUI 启动');
    await this.toolsService.sleep(this.getRestartDelayMs());
    await this.getLoginStatus(container, true);
  }

  private async restartNapcatForLogin(
    container: QqbotNapcatRuntime,
    options: NapcatRestartOptions = {},
  ) {
    const restartedByContainer =
      await this.containerService.restartRuntimeContainer(container);
    if (!restartedByContainer) {
      try {
        await this.postNapcat<Record<string, any> | null>(
          container,
          '/api/QQLogin/RestartNapCat',
        );
      } catch (err) {
        if (!this.toolsService.isNapcatTemporaryError(err)) throw err;
      }
    }

    this.credentials.delete(this.getCredentialCacheKey(container));
    if (options.waitForReady === false) return;

    await this.toolsService.sleep(this.getRestartDelayMs());
    await this.getLoginStatus(container, true);
  }

  private getCredentialCacheKey(container: QqbotNapcatRuntime) {
    return container.id || container.baseUrl;
  }

  private async getCredential(container: QqbotNapcatRuntime) {
    const cacheKey = this.getCredentialCacheKey(container);
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
      const message = this.toolsService.getErrorMessage(err);
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

  private getRestartDelayMs() {
    return Number(
      this.configService.get('NAPCAT_WEBUI_RESTART_DELAY_MS') || 3000,
    );
  }

  private async waitForPasswordLoginStatus(container: QqbotNapcatRuntime) {
    let latestStatus: NapcatLoginStatus = { isLogin: false };
    const attempts = this.getLoginPollAttempts(
      this.getPasswordLoginWaitMs(),
      this.getLoginPollIntervalMs(),
    );
    for (let index = 0; index < attempts; index += 1) {
      if (index > 0) {
        await this.toolsService.sleep(this.getLoginPollIntervalMs());
      }
      latestStatus = await this.getLoginStatus(container, true);
      if (
        latestStatus.isLogin ||
        this.isPasswordQrcodeChallenge(latestStatus) ||
        this.toolsService.isNapcatCaptchaRequiredMessage(
          latestStatus.loginError,
        )
      ) {
        return latestStatus;
      }
    }
    return latestStatus;
  }

  private getLoginPollAttempts(waitMs: number, intervalMs: number) {
    const normalizedWaitMs = Number.isFinite(waitMs) && waitMs > 0 ? waitMs : 1;
    const normalizedIntervalMs =
      Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 1;
    return Math.max(1, Math.ceil(normalizedWaitMs / normalizedIntervalMs));
  }

  private getPasswordLoginWaitMs() {
    return this.getPositiveConfigNumber(
      'QQBOT_NAPCAT_PASSWORD_LOGIN_WAIT_MS',
      120_000,
    );
  }

  private getLoginPollIntervalMs() {
    return this.getPositiveConfigNumber(
      'QQBOT_NAPCAT_LOGIN_POLL_INTERVAL_MS',
      3000,
    );
  }

  private getPositiveConfigNumber(key: string, fallback: number) {
    const value = Number(this.configService.get(key) || fallback);
    return Number.isFinite(value) && value > 0 ? value : fallback;
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
        if (!this.toolsService.isNapcatTemporaryError(err)) break;
        await this.toolsService.sleep(1500);
      }
    }
    throw lastError;
  }
}
