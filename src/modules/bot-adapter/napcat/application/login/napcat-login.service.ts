import { createHash, randomUUID } from 'crypto';
import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import { throwVbenError, ToolsService } from '@/common';
import {
  NapcatLoginApiClient,
  NapcatWebuiHttpClient,
  type NewDeviceQrCode,
  type NewDeviceQrRequest,
} from '../../infrastructure/integration/napcat-login-api.client';
import type {
  NapcatCaptchaLoginResult,
  NapcatLoginInfo,
  NapcatLoginStatus,
  NapcatQrcode,
  NapcatRestartOptions,
  BotLoginCaptchaSubmitInput,
  BotLoginScanMode,
  BotLoginScanEvent,
  BotLoginScanResult,
  BotLoginScanSession,
  BotLoginScanStatus,
  NapcatRuntimeLoginStatus,
  NapcatRuntime,
  QrcodeLookupOptions,
  QrcodeRefreshOptions,
} from '@/modules/bot-adapter/core/contract/bot.types';
import { BotAccountService } from '@/modules/bot-adapter/core/application/account/bot-account.service';
import { NapcatLoginStateStoreService } from '../../infrastructure/persistence/napcat-login-state-store.service';
import { NapcatContainerService } from '../../infrastructure/integration/container/napcat-container.service';

type PendingQrcodeUpdateOptions = {
  clearStaleQrcode?: boolean;
  requireFresh?: boolean;
};
type ScanStatusMonitorDeadline = {
  expiresAt: number;
  qrcode: string;
};

@Injectable()
export class NapcatLoginService {
  private readonly fallbackLoginSessionStore =
    new NapcatLoginStateStoreService();
  private readonly sessionEventLogCache: Record<string, BotLoginScanEvent[]> =
    {};
  private readonly sessionEventListenerCache: Record<
    string,
    Set<(event: BotLoginScanEvent) => void>
  > = {};
  private readonly scanStatusMonitorTimers: Record<
    string,
    NodeJS.Timeout | undefined
  > = {};
  private readonly scanStatusMonitorDeadlines: Record<
    string,
    ScanStatusMonitorDeadline | undefined
  > = {};
  private readonly refreshStartTasks: Record<
    string,
    Promise<BotLoginScanResult> | undefined
  > = {};
  readonly sessions = {
    clear: () => {
      this.stopAllScanStatusMonitors();
      this.loginSessionStore.clear();
    },
    get: (sessionId: string) => this.loginSessionStore.getCached(sessionId),
    has: (sessionId: string) => this.loginSessionStore.has(sessionId),
    set: (sessionId: string, session: BotLoginScanSession) => {
      if (!session.id) session.id = sessionId;
      this.loginSessionStore.set(session);
    },
  };
  readonly sessionEventLogs = {
    clear: () =>
      Object.keys(this.sessionEventLogCache).forEach((sessionId) => {
        delete this.sessionEventLogCache[sessionId];
      }),
    get: (sessionId: string) => this.sessionEventLogCache[sessionId],
  };
  readonly sessionEventListeners = {
    clear: () =>
      Object.keys(this.sessionEventListenerCache).forEach((sessionId) => {
        delete this.sessionEventListenerCache[sessionId];
      }),
  };
  private readonly webuiClient = new NapcatWebuiHttpClient({
    getTimeoutMs: () => this.getTimeout(),
  });

  constructor(
    private readonly configService: ConfigService,
    private readonly accountService: BotAccountService,
    private readonly containerService: NapcatContainerService,
    private readonly toolsService: ToolsService,
    @Optional()
    private readonly loginStateStore?: NapcatLoginStateStoreService,
  ) {}

  /**
   * 根据当前运行态处理login会话Store。
   * @returns 规范化后的login会话Store；主值为空时采用 `this.fallbackLoginSessionStore` 兜底。
   */
  private get loginSessionStore() {
    return this.loginStateStore || this.fallbackLoginSessionStore;
  }

  /**
   * 按当前运行态启动创建。
   * @returns 创建。
   */
  async startCreate() {
    await this.cleanupSessions();
    const container = await this.containerService.reserveCreateContainer();
    const session = this.createSession({
      container,
      mode: 'create',
      preparingContainer: true,
      status: 'pending',
    });
    session.lastRestartedAt = Date.now();
    session.errorMessage = 'NapCat 正在创建登录容器，请稍后';
    this.persistLoginSession(session);
    this.publishScanResultEvent(
      session,
      'container-starting',
      'processing',
      session.errorMessage,
    );
    void this.prepareCreateContainerQrcode(session, container);
    return this.toResult(session);
  }

  /**
   * 按`accountId`启动刷新结果；当 `activeSession` 成立时返回 `this.refreshQrcode(activeSession.id)`。
   * @param accountId - 用于精确定位账号的标识。
   * @returns 刷新。
   */
  async startRefresh(accountId: string) {
    const activeSession = this.findActiveRefreshSession(accountId);
    if (activeSession) {
      if (
        !(await this.invalidatePasswordlessRefreshSessionWhenPasswordExists(
          accountId,
          activeSession,
        ))
      ) {
        if (activeSession.qrcode) return this.refreshQrcode(activeSession.id);
        return this.toResult(activeSession);
      }
    }

    const runningTask = this.refreshStartTasks[accountId];
    if (runningTask) return runningTask;

    const task = this.createRefreshScan(accountId);
    this.refreshStartTasks[accountId] = task;
    try {
      return await task;
    } finally {
      if (this.refreshStartTasks[accountId] === task) {
        delete this.refreshStartTasks[accountId];
      }
    }
  }

  /**
   * 根据`accountId`构造针对启动账号更新登录会话；从 `accountService.findByIdWithNapcatLoginSecret` 读取针对启动账号更新登录会话。
   * @param accountId - 用于精确定位账号的标识。
   * @returns 针对启动账号更新登录会话。
   */
  private async createRefreshScan(accountId: string) {
    const account =
      await this.accountService.findByIdWithNapcatLoginSecret(accountId);
    if (!account) {
      throwVbenError('Bot 账号不存在');
    }
    const loginPassword = this.accountService.getNapcatLoginPassword(account);
    const container = await this.containerService.prepareAccountContainer(
      account,
      loginPassword,
    );

    const scanOptions: {
      accountId: string;
      expectedSelfId: string;
      forceRelogin: true;
      hasExistingPrimaryBinding?: boolean;
      loginPasswordAvailable?: boolean;
      loginPassword?: string;
      mode: 'refresh';
      sourceContainerOnline?: boolean;
    } = {
      accountId: account.id,
      expectedSelfId: account.selfId,
      forceRelogin: true,
      hasExistingPrimaryBinding: container.hasExistingPrimaryBinding,
      loginPasswordAvailable: !!this.toolsService.toSecretText(loginPassword),
      loginPassword,
      mode: 'refresh',
    };
    if (container.sourceContainerOnline !== undefined) {
      scanOptions.sourceContainerOnline = container.sourceContainerOnline;
    }

    return this.startScan(scanOptions, container);
  }

  /**
   * 查找可复用的账号更新登录会话；通过 `loginSessionStore.forEach` 消费当前集合。
   * @param accountId - 账号 ID；限定同一账号的 pending refresh 会话。
   * @returns 当前仍有效的 pending refresh 会话；没有时返回 undefined。
   */
  private findActiveRefreshSession(accountId: string) {
    const now = Date.now();
    let activeSession: BotLoginScanSession | undefined;
    this.loginSessionStore.forEach((session) => {
      if (activeSession) return;
      if (
        session.accountId === accountId &&
        session.mode === 'refresh' &&
        session.status === 'pending' &&
        now <= session.expiresAt
      ) {
        activeSession = session;
      }
    });
    return activeSession;
  }

  /**
   * 当账号后续维护了 QQ 登录密码时，废弃旧的无密码更新登录会话。
   * @param accountId - 正在更新登录态的账号 ID，用于重新读取账号表里的最新登录密码密文。
   * @param session - 可能早于密码维护动作创建的 pending 更新登录会话。
   * @returns 旧会话已退役且调用方应重新创建更新登录会话时返回 true。
   */
  private async invalidatePasswordlessRefreshSessionWhenPasswordExists(
    accountId: string,
    session: BotLoginScanSession,
  ) {
    if (this.hasRefreshPasswordContext(session)) return false;

    const accountService = this.accountService as Partial<
      Pick<
        BotAccountService,
        'findByIdWithNapcatLoginSecret' | 'getNapcatLoginPassword'
      >
    >;
    if (
      !accountService.findByIdWithNapcatLoginSecret ||
      !accountService.getNapcatLoginPassword
    ) {
      return false;
    }

    const account =
      await accountService.findByIdWithNapcatLoginSecret(accountId);
    if (!account) return false;
    const loginPassword = accountService.getNapcatLoginPassword(account);
    if (!this.toolsService.toSecretText(loginPassword)) return false;

    await this.retireRefreshSessionForPasswordReload(session);
    return true;
  }

  /**
   * 根据会话字段判断更新登录是否已经携带或进入过密码登录上下文。
   * @param session - 待复用的 pending 更新登录会话。
   * @returns 复用该会话不会忽略账号已维护登录密码时返回 true。
   */
  private hasRefreshPasswordContext(session: BotLoginScanSession) {
    return !!(
      session.loginPasswordAvailable ||
      session.passwordMd5 ||
      session.captchaUrl ||
      session.deviceVerifyUrl ||
      session.newDeviceQrcode ||
      session.newDeviceStatus
    );
  }

  /**
   * 仅退役过期的更新登录会话记录，不移除已绑定的 NapCat 容器。
   * @param session - 不应继续提供旧二维码或旧 pending 状态的无密码更新登录会话。
   */
  private async retireRefreshSessionForPasswordReload(
    session: BotLoginScanSession,
  ) {
    session.errorMessage = '账号登录密码已更新，重新创建更新登录会话';
    session.preparingRelogin = false;
    session.qrcode = undefined;
    session.status = 'expired';
    this.persistLoginSession(session);
    this.publishScanResultEvent(
      session,
      'session-recreated',
      'processing',
      session.errorMessage,
    );
    await this.loginSessionStore.flushSessionWrites(session.id);
    this.loginSessionStore.delete(session.id);
    this.cleanupSessionEvents(session.id);
  }

  /**
   * 根据`sessionId`处理刷新结果二维码；当 `session.status !== 'pending'` 成立时返回 `this.toResult(session)`。
   * @param sessionId - 用于精确定位会话的标识。
   * @returns 刷新结果二维码。
   * @throws 当 `!this.toolsService.isNapcatTemporaryError(err)` 成立时重新抛出该入口捕获且决定公开的原异常。
   */
  async refreshQrcode(sessionId: string) {
    const session = await this.getSession(sessionId);
    if (session.status !== 'pending') {
      return this.toResult(session);
    }
    if (session.preparingRelogin) {
      if (this.recoverStaleReloginPreparation(session)) {
        return this.refreshQrcode(sessionId);
      }
      return this.keepSessionPending(
        session,
        session.errorMessage || 'NapCat 正在尝试快速登录，请稍后',
      );
    }
    if (session.preparingContainer) {
      if (Date.now() > session.expiresAt) {
        return this.expireSession(session);
      }
      if (this.recoverStaleCreateContainerPreparation(session)) {
        return this.toResult(session);
      }
      return this.keepSessionPending(
        session,
        session.errorMessage || 'NapCat 正在创建登录容器，请稍后',
      );
    }

    const container = await this.getSessionContainer(session);
    let loginStatus: NapcatLoginStatus;
    try {
      loginStatus = await this.getLoginStatus(container);
    } catch (err) {
      if (!this.toolsService.isNapcatTemporaryError(err)) throw err;
      return this.keepSessionPending(
        session,
        'NapCat 通信超时，请稍后重试或确认运行容器仍在线',
        true,
      );
    }
    if (!loginStatus.isLogin) {
      await this.syncSessionQqLoginStatus(session, loginStatus);
    }

    if (
      loginStatus.isOffline &&
      this.shouldRestartNapcatWorkerForOnlineRefresh(session)
    ) {
      loginStatus = await this.restartNapcatWorkerForOnlineRefresh(
        session,
        container,
        loginStatus.loginError || 'NapCat 账号已离线，正在重启登录服务',
      );
    } else if (loginStatus.isOffline && session.mode !== 'refresh') {
      await this.restartNapcatForLogin(container, { waitForReady: false });
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
      this.persistLoginSession(session);
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

  /**
   * 根据`sessionId`处理状态；当 `session.status !== 'pending'` 成立时返回 `this.toResult(session)`。
   * @param sessionId - 用于精确定位会话的标识。
   * @returns 状态。
   * @throws 当 `!this.toolsService.isNapcatTemporaryError(err)` 成立时重新抛出该入口捕获且决定公开的原异常。
   */
  async status(sessionId: string) {
    const session = await this.getSession(sessionId);
    if (session.status !== 'pending') {
      return this.toResult(session);
    }
    if (session.preparingRelogin) {
      if (!this.recoverStaleReloginPreparation(session)) {
        return this.keepSessionPending(
          session,
          session.errorMessage || 'NapCat 正在准备登录，请稍后',
        );
      }
    }
    if (Date.now() > session.expiresAt) {
      const recovered = await this.recoverExpiredQrcodeSession(session);
      if (recovered) return recovered;
      return this.expireSession(session);
    }
    if (session.preparingContainer) {
      if (this.recoverStaleCreateContainerPreparation(session)) {
        return this.toResult(session);
      }
      return this.keepSessionPending(
        session,
        session.errorMessage || 'NapCat 正在创建登录容器，请稍后',
      );
    }

    const container = await this.getSessionContainer(session);
    if (session.newDeviceStatus && session.newDeviceStatus !== 'verified') {
      return this.pollNewDeviceVerification(session, container);
    }
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
      await this.syncSessionQqLoginStatus(session, status);
      const captchaUrl = this.getCaptchaUrlFromStatus(status);
      if (captchaUrl) {
        return this.keepPasswordCaptchaPending(
          session,
          captchaUrl,
          status.loginError,
        );
      }
      const recoveredCaptchaUrl = await this.resolveStatusCaptchaUrl(
        session,
        container,
        status,
      );
      if (recoveredCaptchaUrl) {
        return this.keepPasswordCaptchaPending(
          session,
          recoveredCaptchaUrl,
          status.loginError,
        );
      }
      if (session.captchaUrl) {
        if (this.isPasswordCaptchaStillRequired(status)) {
          return this.keepPasswordCaptchaPending(
            session,
            session.captchaUrl,
            status.loginError || '等待 QQ 安全验证结果',
          );
        }
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
      if (this.isPasswordCaptchaStillRequired(status)) {
        return this.keepPasswordCaptchaWaitingForUrl(
          session,
          status.loginError,
        );
      }

      if (
        status.isOffline &&
        this.shouldRestartNapcatWorkerForOnlineRefresh(session)
      ) {
        status = await this.restartNapcatWorkerForOnlineRefresh(
          session,
          container,
          status.loginError || 'NapCat 账号已离线，正在重启登录服务',
        );
        if (status.isLogin) {
          return this.completeLogin(session, container);
        }
        await this.syncSessionQqLoginStatus(session, status);
      }

      if (this.shouldRefreshNearlyExpiredQrcode(status)) {
        return this.refreshNearlyExpiredQrcode(session, container, status);
      }

      if (this.shouldAutoRefreshPendingQrcode(session, status)) {
        return this.refreshPendingQrcodeFromStatus(session, container, status);
      }

      session.errorMessage = status.loginError || undefined;
      if (
        status.qrcodeurl &&
        (session.mode !== 'refresh' || !session.qrcode) &&
        !this.toolsService.isNapcatExpiredQrcodeStatus(status)
      ) {
        const qrcodeChanged = session.qrcode !== status.qrcodeurl;
        session.qrcode = status.qrcodeurl;
        session.errorMessage = undefined;
        if (qrcodeChanged) {
          this.publishScanResultEvent(
            session,
            'qrcode-ready',
            'success',
            '登录二维码已生成',
          );
        }
      } else if (status.isOffline && session.mode !== 'refresh') {
        session.qrcode = undefined;
      } else if (
        session.mode === 'refresh' &&
        session.qrcode &&
        !this.toolsService.isNapcatExpiredQrcodeStatus(status)
      ) {
        session.errorMessage = undefined;
      } else if (!this.toolsService.isNapcatExpiredQrcodeStatus(status)) {
        await this.tryUpdatePendingQrcode(container, session, status, {
          clearStaleQrcode: session.mode === 'refresh',
          requireFresh: session.mode === 'refresh',
        });
      }
      this.persistLoginSession(session);
      return this.toResult(session);
    }

    return this.completeLogin(session, container);
  }

  /**
   * 根据`sessionId`、`input`处理submit验证码；当 `session.status !== 'pending'` 成立时返回 `this.toResult(session)`。
   * @param sessionId - 用于精确定位会话的标识。
   * @param input - 用于submit验证码的结构化输入，包含 `ticket`、`randstr`、`sid` 字段。
   * @returns submit验证码。
   */
  async submitCaptcha(sessionId: string, input: BotLoginCaptchaSubmitInput) {
    const session = await this.getSession(sessionId);
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

    if (captchaResult?.needNewDevice) {
      return this.startNewDeviceVerification(session, container, captchaResult);
    }

    return this.completePasswordLoginAfterChallenge(
      session,
      container,
      '验证码登录成功',
    );
  }

  /**
   * 根据`sessionId`建立可重放的事件流；先推送缓存或当前快照，退订时移除监听器；从 `loginSessionStore.getCached` 读取事件流。
   * @param sessionId - 用于精确定位会话的标识。
   * @returns 按订阅顺序推送缓存与实时数据的事件流；调用退订函数后不再接收后续事件。
   */
  events(sessionId: string) {
    if (!this.loginSessionStore.getCached(sessionId)) {
      void this.loginSessionStore.get(sessionId);
    }
    return new Observable<{ data: BotLoginScanEvent }>((subscriber) => {
      const listener = (event: BotLoginScanEvent) => {
        subscriber.next({ data: event });
      };
      const replayEvents = this.sessionEventLogCache[sessionId] || [];
      replayEvents.forEach(listener);
      const listeners =
        this.sessionEventListenerCache[sessionId] ||
        new Set<(event: BotLoginScanEvent) => void>();
      listeners.add(listener);
      this.sessionEventListenerCache[sessionId] = listeners;
      if (replayEvents.length <= 0) {
        void this.emitCurrentSessionSnapshot(sessionId, listener).catch(
          () => undefined,
        );
      }

      return () => {
        listeners.delete(listener);
        if (listeners.size <= 0) {
          delete this.sessionEventListenerCache[sessionId];
        }
      };
    });
  }

  /**
   * 根据`sessionId`与当前约束判定cancel；从 `loginSessionStore.get` 读取cancel。
   * @param sessionId - 用于精确定位会话的标识。
   * @returns 满足cancel约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  async cancel(sessionId: string) {
    const session = await this.loginSessionStore.get(sessionId);
    if (session) {
      await this.cleanupPasswordLoginContext(session);
      this.publishScanEvent(session, {
        message: '扫码会话已取消',
        result: this.toResult(session),
        status: 'info',
        step: 'session-cancelled',
      });
      this.loginSessionStore.delete(sessionId);
      await this.loginSessionStore.flushSessionWrites(sessionId);
      await this.cleanupSessionContainer(session);
      this.cleanupSessionEvents(sessionId);
    }
    return true;
  }

  /**
   * 按`options`、`container`启动扫码会话；当 `options.forceRelogin` 成立时返回 `this.toResult(session)`。
   * @param options - 控制扫码会话筛选、缓存或输出方式的可选项，包含 `forceRelogin`、`loginPassword`、`hasExistingPrimaryBinding`、`mode` 字段。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @returns 扫码会话。
   * @throws 当 `getLoginStatus` 或 `refreshOrGetQrcode` 调用失败时重新抛出该入口捕获且决定公开的原异常。
   */
  private async startScan(
    options: {
      accountId?: string;
      expectedSelfId?: string;
      forceRelogin?: boolean;
      hasExistingPrimaryBinding?: boolean;
      loginPasswordAvailable?: boolean;
      loginPassword?: string;
      mode: BotLoginScanMode;
      sourceContainerOnline?: boolean;
    },
    container: NapcatRuntime,
  ): Promise<BotLoginScanResult> {
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
      this.persistLoginSession(session);
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
      void reloginTask.catch(() => undefined);
      return this.toResult(session);
    }

    try {
      const loginStatus = await this.getLoginStatus(container, true);
      if (loginStatus.isOffline) {
        if (options.mode === 'refresh') {
          const qrcode = await this.refreshOrGetQrcode(container, false, {
            fallbackStatus: loginStatus,
            requireFresh: true,
            staleQrcode: loginStatus.qrcodeurl,
          });
          const session = this.createSession({
            ...options,
            container,
            qrcode,
            status: 'pending',
          });
          this.persistLoginSession(session);
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
        }

        await this.restartNapcatForLogin(container, { waitForReady: false });
        const session = this.createSession({
          ...options,
          container,
          status: 'pending',
        });
        session.lastRestartedAt = Date.now();
        session.errorMessage =
          loginStatus.loginError || 'NapCat 账号已离线，已重新生成二维码';
        this.persistLoginSession(session);
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
      this.persistLoginSession(session);
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

  /**
   * 启动账号容器后确认登录会话仍存在；会话已删除时清理新容器，否则发布容器就绪事件并继续准备二维码，失败时清理容器并标记会话失败。
   * @param session - 待读取、续期或持久化的账号容器后确认登录会话仍存在会话。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   */
  private async prepareCreateContainerQrcode(
    session: BotLoginScanSession,
    container: NapcatRuntime,
  ) {
    try {
      await this.containerService.startCreateContainer(container);
      if (!this.loginSessionStore.getCached(session.id)) {
        await this.cleanupRuntimeContainer(container, {
          includeDeletedCreateContainer: true,
        });
        return;
      }

      session.preparingContainer = false;
      session.errorMessage = undefined;
      this.publishScanResultEvent(
        session,
        'container-ready',
        'processing',
        'NapCat 登录容器已启动',
      );
      await this.prepareCreateQrcodeAfterContainerReady(session, container);
    } catch (err) {
      session.preparingContainer = false;
      const cleanupError = await this.cleanupRuntimeContainer(container, {
        includeDeletedCreateContainer: true,
      });
      const message = this.toolsService.getErrorMessage(err);
      await this.failSession(
        session,
        (() => {
          if (cleanupError) {
            return `${message}；清理未绑定容器失败：${cleanupError}`;
          }
          return message;
        })(),
      );
    }
  }

  /**
   * 容器就绪后读取 QQ 登录态：已离线则保留当前扫码会话，否则按需重启并刷新二维码结果。
   * @param session - 待读取、续期或持久化的二维码After容器Ready会话。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   */
  private async prepareCreateQrcodeAfterContainerReady(
    session: BotLoginScanSession,
    container: NapcatRuntime,
  ) {
    const loginStatus = await this.getLoginStatus(container, true);
    if (loginStatus.isOffline) {
      await this.restartNapcatForLogin(container, { waitForReady: false });
      session.lastRestartedAt = Date.now();
      session.errorMessage =
        loginStatus.loginError || 'NapCat 账号已离线，已重新生成二维码';
      this.publishScanResultEvent(
        session,
        'container-restarted',
        'processing',
        session.errorMessage,
      );
      return;
    }

    if (loginStatus.isLogin) {
      await this.completeLogin(session, container);
      return;
    }

    session.qrcode = await this.refreshOrGetQrcode(container, true, {
      fallbackStatus: loginStatus,
      requireFresh: this.toolsService.isNapcatExpiredQrcodeStatus(loginStatus),
      staleQrcode: loginStatus.qrcodeurl,
    });
    session.errorMessage = undefined;
    this.persistLoginSession(session);
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

  /**
   * 根据`session`、`container`、`options`处理completeLogin；当 `loginInfo.online === false` 成立时返回 `this.failSession(session, 'NapCat 当前账号已离线，请…`。
   * @param session - 待读取、续期或持久化的completeLogin会话。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @param options - 控制completeLogin筛选、缓存或输出方式的可选项，包含 `loginInfo`、`successMessage` 字段；省略时默认采用 `{}`。
   * @returns 完成账号绑定与会话收尾后的登录结果；账号仍离线时返回已标记失败的会话结果。
   */
  private async completeLogin(
    session: BotLoginScanSession,
    container: NapcatRuntime,
    options: { loginInfo?: NapcatLoginInfo; successMessage?: string } = {},
  ): Promise<BotLoginScanResult> {
    const stalePendingResult = await this.resolveStalePendingSession(session);
    if (stalePendingResult) return stalePendingResult;

    const loginInfo = options.loginInfo ?? (await this.getLoginInfo(container));
    if (loginInfo.online === false) {
      return this.failSession(session, 'NapCat 当前账号已离线，请重新更新登录');
    }

    const selfId = this.toolsService.pickNapcatSelfId(loginInfo);
    if (!selfId) {
      return this.keepLoginSelfIdPending(session);
    }
    session.loginSelfIdMissingSince = undefined;
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
    await this.containerService.bindAccount(
      accountId,
      session.containerId,
      selfId,
    );
    session.accountId = accountId;
    session.captchaUrl = undefined;
    session.status = 'success';
    session.errorMessage = undefined;
    session.passwordMd5 = undefined;
    session.preparingContainer = false;
    session.preparingRelogin = false;
    this.persistLoginSession(session);
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

  /**
   * 根据`input`构造会话；从 `getSessionTtlMs` 读取会话。
   * @param input - 用于会话的结构化输入，包含 `accountId`、`container`、`expectedSelfId`、`loginPasswordAvailable` 字段。
   * @returns 包含 `accountId`、`containerId`、`containerName`、`createdAt`、`expectedSelfId` 字段的会话。
   */
  private createSession(input: {
    accountId?: string;
    container: NapcatRuntime;
    expectedSelfId?: string;
    mode: BotLoginScanMode;
    loginPasswordAvailable?: boolean;
    preparingContainer?: boolean;
    preparingRelogin?: boolean;
    qrcode?: string;
    runtimeRebuildCount?: number;
    sourceContainerOnline?: boolean;
    status: BotLoginScanStatus;
  }): BotLoginScanSession {
    const now = Date.now();
    return {
      accountId: input.accountId,
      containerId: input.container.id,
      containerName: input.container.name,
      createdAt: now,
      expectedSelfId: input.expectedSelfId,
      expiresAt: now + this.getSessionTtlMs(),
      id: randomUUID(),
      loginPasswordAvailable: input.loginPasswordAvailable,
      mode: input.mode,
      preparingContainer: input.preparingContainer,
      preparingRelogin: input.preparingRelogin,
      qrcode: input.qrcode,
      runtimeRebuildCount:
        input.runtimeRebuildCount ?? input.container.runtimeRebuildCount,
      sourceContainerOnline:
        input.sourceContainerOnline ?? input.container.sourceContainerOnline,
      status: input.status,
      webuiPort: input.container.webuiPort,
    };
  }

  /**
   * 从内部扫码会话挑选公开字段，并转换为轮询接口使用的登录结果快照。
   * @param session - 待读取、续期或持久化的结果会话。
   * @returns 包含 `accountId`、`captchaUrl`、`containerId`、`containerName`、`deviceVerifyUrl` 字段的结果。
   */
  private toResult(session: BotLoginScanSession): BotLoginScanResult {
    return {
      accountId: session.accountId,
      captchaUrl: session.captchaUrl,
      containerId: session.containerId,
      containerName: session.containerName,
      deviceVerifyUrl: session.deviceVerifyUrl,
      errorMessage: session.errorMessage,
      expiresAt: session.expiresAt,
      mode: session.mode,
      newDeviceQrcode: session.newDeviceQrcode,
      newDeviceStatus: session.newDeviceStatus,
      qrcode: session.qrcode,
      sessionId: session.id,
      status: session.status,
      webuiPort: session.webuiPort,
    };
  }

  /**
   * 根据`session`、`status`处理会话QQ登录状态。
   * @param session - 待读取、续期或持久化的会话QQ登录状态会话。
   * @param status - 决定会话QQ登录状态内容、边界或目标的 `status` 值。
   */
  private async syncSessionQqLoginStatus(
    session: BotLoginScanSession,
    status: NapcatLoginStatus,
  ) {
    const selfId = this.toolsService.toTrimmedString(session.expectedSelfId);
    if (!selfId) return;

    const marker = (
      this.accountService as unknown as {
        markQqLoginStatus?: (
          selfId: string,
          qqLoginStatus: NapcatRuntimeLoginStatus,
          lastError?: null | string,
        ) => Promise<void>;
      }
    ).markQqLoginStatus;
    if (!marker) return;

    const qqLoginStatus = this.toSessionQqLoginStatus(status);
    const lastError = this.toSessionQqLoginError(status, qqLoginStatus);
    await marker.call(this.accountService, selfId, qqLoginStatus, lastError);
  }

  /**
   * 根据`session`处理已过期的二维码会话；当 `typeof this.containerService.findRuntimeById !== 'function'` 成立时返回 `undefined`。
   * @param session - 待读取、续期或持久化的已过期的二维码会话。
   * @returns 已过期的二维码会话；没有可用结果或提前结束时为 `undefined`。
   * @throws 当 `!this.toolsService.isNapcatTemporaryError(err)` 成立时重新抛出该入口捕获且决定公开的原异常。
   */
  private async recoverExpiredQrcodeSession(
    session: BotLoginScanSession,
  ): Promise<BotLoginScanResult | undefined> {
    if (!session.qrcode || session.preparingContainer) return undefined;
    if (typeof this.containerService.findRuntimeById !== 'function') {
      return undefined;
    }

    const container = await this.getSessionContainer(session);
    let status: NapcatLoginStatus;
    try {
      status = await this.getLoginStatus(container);
    } catch (err) {
      if (!this.toolsService.isNapcatTemporaryError(err)) throw err;
      return this.keepSessionPending(
        session,
        'NapCat 正在确认二维码状态，请稍后',
        true,
      );
    }

    if (status.isLogin) {
      this.renewSessionExpiry(session);
      return this.completeLogin(session, container);
    }

    await this.syncSessionQqLoginStatus(session, status);
    if (this.toolsService.isNapcatExpiredQrcodeStatus(status)) {
      session.errorMessage = status.loginError || session.errorMessage;
      this.persistLoginSession(session);
      return undefined;
    }

    if (this.shouldRefreshNearlyExpiredQrcode(status)) {
      return this.refreshNearlyExpiredQrcode(session, container, status);
    }

    if (status.qrcodeurl) {
      session.qrcode = status.qrcodeurl;
      session.errorMessage = undefined;
      return this.keepSessionPending(session, '等待扫码确认');
    }

    return undefined;
  }

  /**
   * 将输入收敛并投影为会话QQ登录状态。
   * @param status - 用于会话QQ登录状态的领域对象，包含 `loginError`、`isLogin`、`qrcodeurl`、`isOffline` 字段。
   * @returns 当前状态对应的会话QQ登录状态，取值为 `'online'`、`'qrcode_expired'`、`'qrcode_pending'`、`'offline'`、`'unknown'`。
   */
  private toSessionQqLoginStatus(
    status: NapcatLoginStatus,
  ): NapcatRuntimeLoginStatus {
    const message = this.toolsService.toTrimmedString(status.loginError);
    if (status.isLogin) return 'online';
    if (
      this.toolsService.isNapcatExpiredQrcodeStatus(status) ||
      message.includes('二维码已过期')
    ) {
      return 'qrcode_expired';
    }
    if (status.qrcodeurl) return 'qrcode_pending';
    if (
      status.isOffline ||
      this.toolsService.isNapcatOfflineLoginMessage(message)
    ) {
      return 'offline';
    }
    return 'unknown';
  }

  /**
   * 将输入收敛并投影为会话QQ登录错误。
   * @param status - 用于会话QQ登录错误的领域对象，包含 `loginError` 字段。
   * @param qqLoginStatus - 决定会话QQ登录错误内容、边界或目标的 `qqLoginStatus` 值。
   * @returns 规范化后的会话QQ登录错误；主值为空时采用 `undefined` 兜底；无法解析或未命中时为 `null`，没有可用结果或提前结束时为 `undefined`。
   */
  private toSessionQqLoginError(
    status: NapcatLoginStatus,
    qqLoginStatus: NapcatRuntimeLoginStatus,
  ) {
    const message = this.toolsService.toTrimmedString(status.loginError);
    if (qqLoginStatus === 'online' || qqLoginStatus === 'qrcode_pending') {
      return message || null;
    }
    if (qqLoginStatus === 'offline') {
      return message || 'NapCat 账号已离线，请重新扫码登录';
    }
    if (qqLoginStatus === 'qrcode_expired') {
      return message || 'NapCat 登录二维码已过期';
    }
    return message || undefined;
  }

  /**
   * 按`session`、`container`、`captchaResult`启动设备验证状态；从 `toolsService.getErrorMessage` 读取设备验证状态。
   * @param session - 待读取、续期或持久化的设备验证状态会话。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @param captchaResult - 用于设备验证状态的领域对象，包含 `jumpUrl`、`newDevicePullQrCodeSig` 字段。
   * @returns 设备验证状态。
   */
  private async startNewDeviceVerification(
    session: BotLoginScanSession,
    container: NapcatRuntime,
    captchaResult: NapcatCaptchaLoginResult,
  ) {
    session.status = 'pending';
    session.captchaUrl = undefined;
    session.qrcode = undefined;
    session.deviceVerifyUrl = this.toolsService.toTrimmedString(
      captchaResult.jumpUrl,
    );
    session.newDeviceBytesToken = undefined;
    session.newDevicePullQrCodeSig = this.pickNewDevicePullQrCodeSig(
      captchaResult.newDevicePullQrCodeSig,
    );
    session.newDeviceStatus = 'qr-pending';
    session.errorMessage = '需要新设备验证二维码';
    this.persistLoginSession(session);
    this.publishScanResultEvent(
      session,
      'new-device-required',
      'processing',
      '需要新设备验证二维码',
    );

    try {
      const client = new NapcatLoginApiClient({
        post: (path, body) => this.postNapcat(container, path, body),
      });
      return this.refreshNewDeviceQrcode(session, container, client);
    } catch (err) {
      return this.keepSessionPending(
        session,
        this.toolsService.getErrorMessage(err) || '新设备二维码生成失败',
        true,
      );
    }
  }

  /**
   * 根据 NapCat 轮询结果推进新设备验证，在扫码、确认、过期、失败或登录成功分支中同步会话并发布状态事件。
   * @param session - 正在验证的登录会话；缺少 `bytesToken` 时会刷新二维码，缺少期望账号时会标记验证失败。
   * @param container - 承载该登录会话并接收 NapCat API 请求的运行时容器。
   * @returns 返回刷新、待确认、失败或完成登录后的扫码会话结果；状态未变时继续保持二维码待扫码。
   */
  private async pollNewDeviceVerification(
    session: BotLoginScanSession,
    container: NapcatRuntime,
  ) {
    const client = new NapcatLoginApiClient({
      post: (path, body) => this.postNapcat(container, path, body),
    });
    if (!session.newDeviceBytesToken) {
      return this.refreshNewDeviceQrcode(session, container, client);
    }
    const uin = this.toolsService.toTrimmedString(session.expectedSelfId);
    if (!uin) {
      return this.failNewDeviceVerification(
        session,
        container,
        '新设备验证账号上下文缺失，请重新更新登录',
      );
    }
    const poll = await client.pollNewDeviceQR({
      bytesToken: session.newDeviceBytesToken,
      uin,
    });
    if (poll.status === 'scanned') {
      return this.keepNewDevicePending(
        session,
        'scanned',
        poll.message || '新设备二维码已扫码',
        'new-device-scanned',
      );
    }
    if (poll.status === 'confirming') {
      const confirmToken = this.pickNewDevicePullQrCodeSig(poll.confirmToken);
      if (confirmToken !== undefined) {
        session.newDevicePullQrCodeSig = confirmToken;
      }
      this.keepNewDevicePending(
        session,
        'confirming',
        poll.message || '新设备确认中',
        'new-device-confirming',
      );
      const passwordMd5 = await this.resolveNewDevicePasswordMd5(session);
      if (!passwordMd5 || !this.hasNewDevicePullQrCodeSig(session)) {
        return this.failNewDeviceVerification(
          session,
          container,
          '新设备验证登录上下文缺失，请重新更新登录',
        );
      }
      const loginResult = await client.newDeviceLogin({
        newDevicePullQrCodeSig: session.newDevicePullQrCodeSig,
        passwordMd5,
        uin,
      });
      if (loginResult.needNewDevice && loginResult.jumpUrl) {
        return this.startNewDeviceVerification(session, container, {
          jumpUrl: loginResult.jumpUrl,
          needNewDevice: true,
          newDevicePullQrCodeSig: loginResult.pullQrCodeSig,
        });
      }
      if (!loginResult.success) {
        return this.failNewDeviceVerification(
          session,
          container,
          loginResult.message || '新设备验证失败',
        );
      }
      session.newDeviceBytesToken = undefined;
      session.newDeviceQrcode = undefined;
      session.newDeviceStatus = 'verified';
      session.errorMessage = '新设备验证成功，继续登录';
      this.persistLoginSession(session);
      this.publishScanResultEvent(
        session,
        'new-device-verified',
        'success',
        '新设备验证成功，继续登录',
      );
      return this.completePasswordLoginAfterChallenge(
        session,
        container,
        '新设备验证登录成功',
      );
    }
    if (poll.status === 'expired') {
      return this.failNewDeviceVerification(
        session,
        container,
        poll.message || '新设备二维码已过期',
      );
    }
    if (poll.status === 'failed') {
      return this.failNewDeviceVerification(
        session,
        container,
        poll.message || '新设备验证失败',
      );
    }
    return this.keepNewDevicePending(
      session,
      'qr-pending',
      poll.message || '新设备二维码待扫码',
      'new-device-qrcode-ready',
    );
  }

  /**
   * 从`session`解析设备密码Md5；从 `accountService.findByIdWithNapcatLoginSecret` 读取设备密码Md5。
   * @param session - 待读取、续期或持久化的设备密码Md5会话。
   * @returns 当前状态对应的设备密码Md5，取值为 `''`。
   */
  private async resolveNewDevicePasswordMd5(session: BotLoginScanSession) {
    const existing = this.toolsService.toTrimmedString(session.passwordMd5);
    if (existing) return existing;
    if (!session.accountId) return '';

    const account = await this.accountService.findByIdWithNapcatLoginSecret(
      session.accountId,
    );
    const password = this.accountService.getNapcatLoginPassword(account);
    if (!password) return '';

    session.passwordMd5 = createHash('md5')
      .update(password, 'utf8')
      .digest('hex');
    this.persistLoginSession(session);
    return session.passwordMd5;
  }

  /**
   * 根据`session`、`container`、`client`处理刷新结果设备二维码；当 `!request` 成立时返回 `this.failNewDeviceVerification( session, co…`。
   * @param session - 待读取、续期或持久化的刷新结果设备二维码会话。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @param client - 用于刷新结果设备二维码的领域对象，包含 `getNewDeviceQRCode` 字段。
   * @returns 刷新结果设备二维码。
   */
  private async refreshNewDeviceQrcode(
    session: BotLoginScanSession,
    container: NapcatRuntime,
    client: NapcatLoginApiClient,
  ) {
    const request = this.getNewDeviceQrRequest(session);
    if (!request) {
      return this.failNewDeviceVerification(
        session,
        container,
        '新设备验证上下文缺失，请重新更新登录',
      );
    }

    try {
      const qrcode = await client.getNewDeviceQRCode(request);
      this.applyNewDeviceQrcode(session, qrcode);
      this.persistLoginSession(session);
      this.publishScanResultEvent(
        session,
        'new-device-qrcode-ready',
        'processing',
        '新设备二维码待扫码',
      );
      return this.toResult(session);
    } catch (err) {
      return this.keepNewDevicePending(
        session,
        'qr-pending',
        this.toolsService.getErrorMessage(err) || '新设备二维码生成失败',
        'new-device-required',
      );
    }
  }

  /**
   * 根据`session`、`qrcode`更新设备二维码。
   * @param session - 待读取、续期或持久化的设备二维码会话。
   * @param qrcode - 用于设备二维码的领域对象，包含 `qrcodeUrl`、`bytesToken`、`deviceVerifyUrl`、`pullQrCodeSig` 字段。
   */
  private applyNewDeviceQrcode(
    session: BotLoginScanSession,
    qrcode: NewDeviceQrCode,
  ) {
    session.newDeviceQrcode = qrcode.qrcodeUrl;
    session.newDeviceBytesToken = qrcode.bytesToken;
    session.deviceVerifyUrl = qrcode.deviceVerifyUrl || session.deviceVerifyUrl;
    const pullQrCodeSig = this.pickNewDevicePullQrCodeSig(qrcode.pullQrCodeSig);
    if (pullQrCodeSig !== undefined) {
      session.newDevicePullQrCodeSig = pullQrCodeSig;
    }
    session.newDeviceStatus = qrcode.status;
    session.errorMessage = '新设备二维码待扫码';
  }

  /**
   * 按`session`读取设备二维码请求。
   * @param session - 待读取、续期或持久化的设备二维码请求会话。
   * @returns 包含 `jumpUrl`、`uin` 字段的设备二维码请求；无法解析或未命中时为 `null`。
   */
  private getNewDeviceQrRequest(
    session: BotLoginScanSession,
  ): NewDeviceQrRequest | null {
    const uin = this.toolsService.toTrimmedString(session.expectedSelfId);
    const jumpUrl = this.toolsService.toTrimmedString(session.deviceVerifyUrl);
    if (!uin || !jumpUrl) return null;
    return { jumpUrl, uin };
  }

  /**
   * 从`value`筛选设备Pull二维码请求代码Sig，并保持保留项的原有顺序与键名；当 `typeof value === 'string'` 成立时返回 `text || undefined`。
   * @param value - 参与设备Pull二维码请求代码Sig比较、格式化或输出的候选值。
   * @returns 设备Pull二维码请求代码Sig；没有可用结果或提前结束时为 `undefined`。
   */
  private pickNewDevicePullQrCodeSig(value: unknown) {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string') {
      const text = this.toolsService.toTrimmedString(value);
      return text || undefined;
    }
    return value;
  }

  /**
   * 根据`session`与当前约束判定设备Pull二维码请求代码Sig。
   * @param session - 待读取、续期或持久化的设备Pull二维码请求代码Sig会话。
   * @returns 满足设备Pull二维码请求代码Sig约束时为 `true`；不满足、未命中或显式失败分支为 `false`；没有可用结果或提前结束时为 `undefined`。
   */
  private hasNewDevicePullQrCodeSig(session: BotLoginScanSession) {
    return (
      this.pickNewDevicePullQrCodeSig(session.newDevicePullQrCodeSig) !==
      undefined
    );
  }

  /**
   * 根据`session`、`status`、`message`处理keep设备等待状态。
   * @param session - 待读取、续期或持久化的keep设备等待状态会话。
   * @param status - 决定keep设备等待状态内容、边界或目标的 `status` 值。
   * @param message - 包含正文、发送目标与账号身份的待处理消息。
   * @param step - 决定keep设备等待状态内容、边界或目标的 `step` 值。
   * @returns keep设备等待状态。
   */
  private keepNewDevicePending(
    session: BotLoginScanSession,
    status: NonNullable<BotLoginScanSession['newDeviceStatus']>,
    message: string,
    step: string,
  ) {
    const shouldPublish =
      session.newDeviceStatus !== status || session.errorMessage !== message;
    session.status = 'pending';
    session.captchaUrl = undefined;
    session.qrcode = undefined;
    session.newDeviceStatus = status;
    session.errorMessage = message;
    this.renewSessionExpiry(session);
    this.persistLoginSession(session);
    if (shouldPublish) {
      this.publishScanResultEvent(session, step, 'processing', message);
    }
    return this.toResult(session);
  }

  /**
   * 根据`session`、`container`、`message`处理fail设备验证状态。
   * @param session - 待读取、续期或持久化的fail设备验证状态会话。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @param message - 包含正文、发送目标与账号身份的待处理消息。
   * @returns fail设备验证状态。
   */
  private async failNewDeviceVerification(
    session: BotLoginScanSession,
    container: NapcatRuntime,
    message: string,
  ) {
    session.newDeviceQrcode = undefined;
    session.newDeviceBytesToken = undefined;
    session.newDeviceStatus = 'failed';
    session.errorMessage = message;
    this.persistLoginSession(session);
    return this.failCaptchaLogin(session, container, message);
  }

  /**
   * 根据`session`、`container`、`successMessage`处理complete密码LoginAfter验证挑战；当 `!loginStatus.isLogin` 成立时返回 `this.keepPasswordCaptchaPending( session, c…`。
   * @param session - 待读取、续期或持久化的complete密码LoginAfter验证挑战会话。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @param successMessage - 包含正文、发送目标与账号身份的待处理消息。
   * @returns complete密码LoginAfter验证挑战。
   */
  private async completePasswordLoginAfterChallenge(
    session: BotLoginScanSession,
    container: NapcatRuntime,
    successMessage: string,
  ) {
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
        (() => {
          if (loginInfo.online === false) {
            return 'NapCat 当前账号已离线';
          }
          return 'NapCat 未返回 QQ 号';
        })(),
      );
    }
    if (session.expectedSelfId && session.expectedSelfId !== selfId) {
      return this.failSession(
        session,
        `当前密码登录账号 ${selfId} 与目标账号 ${session.expectedSelfId} 不一致`,
      );
    }

    return this.completeLogin(session, container, {
      loginInfo,
      successMessage,
    });
  }

  /**
   * 按`session`、`input`投递扫码会话事件。
   * @param session - 待读取、续期或持久化的扫码会话事件会话。
   * @param input - 用于扫码会话事件的结构化输入。
   */
  private publishScanEvent(
    session: BotLoginScanSession,
    input: Omit<BotLoginScanEvent, 'createdAt'>,
  ) {
    const event: BotLoginScanEvent = {
      ...input,
      createdAt: Date.now(),
    };
    const logs = this.sessionEventLogCache[session.id] || [];
    logs.push(event);
    this.sessionEventLogCache[session.id] = logs.slice(-50);
    this.sessionEventListenerCache[session.id]?.forEach((listener) =>
      listener(event),
    );
  }

  /**
   * 按`session`、`step`、`status`投递扫码会话结果事件。
   * @param session - 待读取、续期或持久化的扫码会话结果事件会话。
   * @param step - 决定扫码会话结果事件内容、边界或目标的 `step` 值。
   * @param status - 决定扫码会话结果事件内容、边界或目标的 `status` 值。
   * @param message - 包含正文、发送目标与账号身份的待处理消息。
   */
  private publishScanResultEvent(
    session: BotLoginScanSession,
    step: string,
    status: BotLoginScanEvent['status'],
    message: string,
  ) {
    if (session.status === 'pending') {
      this.renewSessionExpiry(session);
      this.persistLoginSession(session);
    }
    this.publishScanEvent(session, {
      message,
      result: this.toResult(session),
      status,
      step,
    });
    if (this.shouldMonitorScanStatus(session)) {
      this.startScanStatusMonitor(session);
    }
  }

  /**
   * 按`sessionId`、`listener`投递emit会话快照；从 `loginSessionStore.get` 读取emit会话快照。
   * @param sessionId - 用于精确定位会话的标识。
   * @param listener - 负责完成emit会话快照外部交互的受控能力。
   */
  private async emitCurrentSessionSnapshot(
    sessionId: string,
    listener: (event: BotLoginScanEvent) => void,
  ) {
    const session = await this.loginSessionStore.get(sessionId);
    if (!session) return;
    listener(this.toSessionSnapshotEvent(session));
  }

  /**
   * 将`session`转换为会话快照事件；从 `getSessionSnapshotMessage` 读取会话快照事件。
   * @param session - 待读取、续期或持久化的会话快照事件会话。
   * @returns 包含 `createdAt`、`message`、`result`、`status`、`step` 字段的会话快照事件。
   */
  private toSessionSnapshotEvent(
    session: BotLoginScanSession,
  ): BotLoginScanEvent {
    return {
      createdAt: Date.now(),
      message: this.getSessionSnapshotMessage(session),
      result: this.toResult(session),
      status: this.getSessionSnapshotStatus(session),
      step: this.getSessionSnapshotStep(session),
    };
  }

  /**
   * 按`session`读取会话快照状态；当 `session.status === 'error' || session.status === 'expired'` 成立时返回 `'error'`。
   * @param session - 待读取、续期或持久化的会话快照状态会话。
   * @returns 当前状态对应的会话快照状态，取值为 `'success'`、`'error'`、`'processing'`。
   */
  private getSessionSnapshotStatus(
    session: BotLoginScanSession,
  ): BotLoginScanEvent['status'] {
    if (session.status === 'success') return 'success';
    if (session.status === 'error' || session.status === 'expired') {
      return 'error';
    }
    return 'processing';
  }

  /**
   * 按`session`读取会话快照Step；当 `session.newDeviceStatus` 成立时返回 `'new-device-scanned'`。
   * @param session - 待读取、续期或持久化的会话快照Step会话。
   * @returns 表示会话快照Step的固定文本 `'scan-status'`。
   */
  private getSessionSnapshotStep(session: BotLoginScanSession) {
    if (session.status === 'success') return 'login-success';
    if (session.status === 'error') return 'login-failed';
    if (session.status === 'expired') return 'session-expired';
    if (session.newDeviceStatus) {
      if (session.newDeviceStatus === 'scanned') return 'new-device-scanned';
      if (session.newDeviceStatus === 'confirming') {
        return 'new-device-confirming';
      }
      if (session.newDeviceStatus === 'verified') return 'new-device-verified';
      if (['expired', 'failed'].includes(session.newDeviceStatus)) {
        return 'login-failed';
      }
      return 'new-device-qrcode-ready';
    }
    if (session.captchaUrl) return 'password-login-captcha';
    if (session.qrcode) return 'qrcode-ready';
    if (session.preparingRelogin) {
      const message = this.toolsService.toTrimmedString(session.errorMessage);
      if (message.includes('密码')) return 'password-login-start';
      if (message.includes('快速')) return 'quick-login-start';
      return 'relogin-preparing';
    }
    if (session.preparingContainer) return 'container-starting';
    if (session.passwordMd5) return 'password-login';
    return 'scan-status';
  }

  /**
   * 按会话错误、终态、新设备、安全验证、二维码和容器准备的优先级选择扫码状态文案。
   * @param session - 待读取、续期或持久化的按会话错误、终态、新设备、安全验证、二维码和容器准备的优先级选择扫码状态文案会话。
   * @returns 表示会话快照消息的固定文本 `'登录处理中'`。
   */
  private getSessionSnapshotMessage(session: BotLoginScanSession) {
    const message = this.toolsService.toTrimmedString(session.errorMessage);
    if (message) return message;
    if (session.status === 'success') return '登录成功';
    if (session.status === 'error') return '登录失败';
    if (session.status === 'expired') return '扫码会话已过期';
    if (session.newDeviceStatus === 'scanned') return '新设备二维码已扫码';
    if (session.newDeviceStatus === 'confirming') return '新设备确认中';
    if (session.newDeviceStatus) return '新设备二维码待扫码';
    if (session.captchaUrl) return '密码登录需要完成 QQ 安全验证';
    if (session.qrcode) return '登录二维码已生成';
    if (session.preparingContainer) return 'NapCat 正在创建登录容器，请稍后';
    return '登录处理中';
  }

  /**
   * 通过 `isStaleReloginPreparation` 判断输入是否满足函数约束。
   * @param session - 待读取、续期或持久化的恢复StaleReloginPreparation会话。
   * @returns 满足恢复StaleReloginPreparation约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private recoverStaleReloginPreparation(session: BotLoginScanSession) {
    if (!this.isStaleReloginPreparation(session)) return false;
    session.preparingRelogin = false;
    session.errorMessage = '更新登录任务已恢复，继续检测 NapCat 登录状态';
    this.publishScanResultEvent(
      session,
      'relogin-recovered',
      'processing',
      session.errorMessage,
    );
    return true;
  }

  /**
   * 根据`session`处理过期的创建容器准备。
   * @param session - 待读取、续期或持久化的过期的创建容器准备会话。
   * @returns 满足过期的创建容器准备约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private recoverStaleCreateContainerPreparation(
    session: BotLoginScanSession,
  ) {
    if (!this.isStaleCreateContainerPreparation(session)) return false;
    session.lastRestartedAt = Date.now();
    session.errorMessage = 'NapCat 创建任务已恢复，继续创建登录容器';
    this.publishScanResultEvent(
      session,
      'container-start-recovered',
      'processing',
      session.errorMessage,
    );
    void this.resumeCreateContainerPreparation(session).catch(() => undefined);
    return true;
  }

  /**
   * 从已持久化状态恢复创建容器准备。
   * @param session - 待读取、续期或持久化的从已持久化状态恢复创建容器准备会话。
   */
  private async resumeCreateContainerPreparation(
    session: BotLoginScanSession,
  ) {
    const container = await this.getSessionContainer(session);
    await this.prepareCreateContainerQrcode(session, container);
  }

  /**
   * 根据`session`与当前约束判定StaleReloginPreparation；从 `getReloginPreparationStaleMs` 读取StaleReloginPreparation。
   * @param session - 待读取、续期或持久化的StaleReloginPreparation会话。
   * @returns 满足StaleReloginPreparation约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isStaleReloginPreparation(session: BotLoginScanSession) {
    if (!session.preparingRelogin || !session.lastRestartedAt) return false;
    return (
      Date.now() - session.lastRestartedAt > this.getReloginPreparationStaleMs()
    );
  }

  /**
   * 根据`session`与当前约束判定过期的创建容器准备；从 `getCreateContainerPreparationStaleMs` 读取过期的创建容器准备。
   * @param session - 待读取、续期或持久化的过期的创建容器准备会话。
   * @returns 满足过期的创建容器准备约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isStaleCreateContainerPreparation(session: BotLoginScanSession) {
    if (!session.preparingContainer) return false;
    const startedAt = session.lastRestartedAt || session.createdAt;
    if (!startedAt) return false;
    return Date.now() - startedAt > this.getCreateContainerPreparationStaleMs();
  }

  /**
   * 按当前运行态读取ReloginPreparationStaleMs；从 `getPositiveConfigNumber` 读取ReloginPreparationStaleMs。
   * @returns 判定重新登录准备状态过期的毫秒阈值；配置缺失或非法时使用固定默认值。
   */
  private getReloginPreparationStaleMs() {
    return this.getPositiveConfigNumber(
      'NAPCAT_RELOGIN_PREPARING_STALE_MS',
      this.getPasswordLoginWaitMs() +
        Math.max(this.getRestartDelayMs(), this.getTimeout()) +
        this.getLoginPollIntervalMs() * 2,
    );
  }

  /**
   * 按当前运行态读取创建容器准备过期的毫秒；从 `getPositiveConfigNumber` 读取创建容器准备过期的毫秒。
   * @returns 创建容器准备过期的毫秒。
   */
  private getCreateContainerPreparationStaleMs() {
    return this.getPositiveConfigNumber(
      'NAPCAT_CREATE_PREPARING_STALE_MS',
      Math.max(
        this.getSessionTtlMs(),
        this.getTimeout() * 3 + this.getLoginPollIntervalMs() * 2,
      ),
    );
  }

  /**
   * 停止指定登录会话的扫码监控，并删除其事件日志与监听器缓存。
   * @param sessionId - 用于精确定位会话的标识。
   */
  private cleanupSessionEvents(sessionId: string) {
    this.stopScanStatusMonitor(sessionId);
    delete this.sessionEventLogCache[sessionId];
    delete this.sessionEventListenerCache[sessionId];
  }

  /**
   * 根据`session`与当前约束判定是否应当监控扫描状态。
   * @param session - 待读取、续期或持久化的是否应当监控扫描状态会话。
   * @returns 满足是否应当监控扫描状态约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private shouldMonitorScanStatus(session: BotLoginScanSession) {
    return (
      session.status === 'pending' &&
      !!session.qrcode &&
      !session.preparingContainer &&
      !session.preparingRelogin
    );
  }

  /**
   * 按`session`启动扫描状态监控；当 `this.hasScanStatusMonitorDeadlinePassed(session)` 成立时直接结束且不产生返回值。
   * @param session - 待读取、续期或持久化的扫描状态监控会话。
   */
  private startScanStatusMonitor(session: BotLoginScanSession) {
    this.ensureScanStatusMonitorDeadline(session);
    if (this.hasScanStatusMonitorDeadlinePassed(session)) {
      void this.expireSession(session);
      return;
    }
    if (this.scanStatusMonitorTimers[session.id]) return;
    const timer = setTimeout(() => {
      this.scanStatusMonitorTimers[session.id] = undefined;
      void this.runScanStatusMonitor(session.id);
    }, this.getLoginPollIntervalMs());
    timer.unref?.();
    this.scanStatusMonitorTimers[session.id] = timer;
  }

  /**
   * 按`sessionId`停止扫描状态监控并清理该入口拥有的运行态资源。
   * @param sessionId - 用于精确定位会话的标识。
   */
  private stopScanStatusMonitor(sessionId: string) {
    const timer = this.scanStatusMonitorTimers[sessionId];
    if (timer) clearTimeout(timer);
    delete this.scanStatusMonitorTimers[sessionId];
    delete this.scanStatusMonitorDeadlines[sessionId];
  }

  /**
   * 按当前运行态停止全部扫描状态监控器并清理该入口拥有的运行态资源。
   */
  private stopAllScanStatusMonitors() {
    Object.keys(this.scanStatusMonitorTimers).forEach((sessionId) => {
      this.stopScanStatusMonitor(sessionId);
    });
  }

  /**
   * 确保扫描状态监控截止时间存在且保持一致；缺失时根据`session`补齐对应状态。
   * @param session - 待读取、续期或持久化的扫描状态监控截止时间会话。
   */
  private ensureScanStatusMonitorDeadline(session: BotLoginScanSession) {
    if (!session.qrcode) return;
    const current = this.scanStatusMonitorDeadlines[session.id];
    if (current?.qrcode === session.qrcode) return;
    this.scanStatusMonitorDeadlines[session.id] = {
      expiresAt: session.expiresAt,
      qrcode: session.qrcode,
    };
  }

  /**
   * 比较当前时间与扫码监控截止时间，并在首次检查时补建该截止时间。
   * @param session - 待读取、续期或持久化的扫码会话状态MonitorDeadlinePassed会话。
   * @returns 满足扫码会话状态MonitorDeadlinePassed约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private hasScanStatusMonitorDeadlinePassed(
    session: BotLoginScanSession,
  ) {
    const deadline = this.scanStatusMonitorDeadlines[session.id];
    if (deadline && session.qrcode && deadline.qrcode !== session.qrcode) {
      this.ensureScanStatusMonitorDeadline(session);
      return false;
    }
    return !!deadline && Date.now() > deadline.expiresAt;
  }

  /**
   * 根据`sessionId`处理扫描状态监控；当 `this.hasScanStatusMonitorDeadlinePassed(session)` 成立时直接结束且不产生返回值。
   * @param sessionId - 用于精确定位会话的标识。
   */
  private async runScanStatusMonitor(sessionId: string) {
    try {
      const session = await this.loginSessionStore.get(sessionId);
      if (!session || !this.shouldMonitorScanStatus(session)) return;
      if (this.hasScanStatusMonitorDeadlinePassed(session)) {
        await this.expireSession(session);
        return;
      }
      const result = await this.status(sessionId);
      if (result.status !== 'pending') return;
      const current =
        this.loginSessionStore.getCached(sessionId) ||
        (await this.loginSessionStore.get(sessionId));
      if (current && this.shouldMonitorScanStatus(current)) {
        if (this.hasScanStatusMonitorDeadlinePassed(current)) {
          await this.expireSession(current);
          return;
        }
        this.startScanStatusMonitor(current);
      }
    } catch {
      const current = this.loginSessionStore.getCached(sessionId);
      if (current && this.shouldMonitorScanStatus(current)) {
        if (this.hasScanStatusMonitorDeadlinePassed(current)) {
          await this.expireSession(current);
          return;
        }
        this.startScanStatusMonitor(current);
      }
    }
  }

  /**
   * 根据`session`、`errorMessage`、`clearQrcode`处理keep会话等待状态。
   * @param session - 待读取、续期或持久化的keep会话等待状态会话。
   * @param errorMessage - 包含正文、发送目标与账号身份的待处理消息。
   * @param clearQrcode - 决定keep会话等待状态内容、边界或目标的 `clearQrcode` 值；省略时默认采用 `false`。
   * @returns keep会话等待状态。
   */
  private keepSessionPending(
    session: BotLoginScanSession,
    errorMessage: string,
    clearQrcode = false,
  ) {
    session.status = 'pending';
    session.errorMessage = errorMessage;
    this.renewSessionExpiry(session);
    if (clearQrcode) session.qrcode = undefined;
    this.persistLoginSession(session);
    return this.toResult(session);
  }

  /**
   * 根据`session`、`captchaUrl`、`reason`处理keep密码验证码等待状态。
   * @param session - 待读取、续期或持久化的keep密码验证码等待状态会话。
   * @param captchaUrl - 待规范化、请求或同源校验的验证码URL 地址 URL。
   * @param reason - 决定keep密码验证码等待状态内容、边界或目标的 `reason` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns keep密码验证码等待状态。
   */
  private keepPasswordCaptchaPending(
    session: BotLoginScanSession,
    captchaUrl: string,
    reason?: string,
  ) {
    const captchaMessage = '密码登录需要完成 QQ 安全验证';
    const detail = (() => {
      if (this.toolsService.isNapcatCaptchaRequiredMessage(reason)) {
        return '';
      }
      return this.toolsService.toTrimmedString(reason);
    })();
    const message = (() => {
      if (detail) {
        return `${captchaMessage}：${detail}`;
      }
      return captchaMessage;
    })();
    const shouldPublish =
      session.captchaUrl !== captchaUrl ||
      !session.errorMessage?.includes(captchaMessage);

    session.status = 'pending';
    session.captchaUrl = captchaUrl;
    session.preparingRelogin = false;
    session.qrcode = undefined;
    session.errorMessage = message;
    this.renewSessionExpiry(session);
    this.persistLoginSession(session);
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

  /**
   * 根据`session`、`reason`拼接稳定的keep密码验证码WaitingURL 地址，用于隔离对应资源或存储记录。
   * @param session - 待读取、续期或持久化的keep密码验证码WaitingURL 地址会话。
   * @param reason - 决定keep密码验证码WaitingURL 地址内容、边界或目标的 `reason` 值；为空时采用 `'密码登录需要完成 QQ 安全验证'` 作为兜底。
   * @returns keep密码验证码WaitingURL 地址。
   */
  private keepPasswordCaptchaWaitingForUrl(
    session: BotLoginScanSession,
    reason?: string,
  ) {
    const message =
      this.toolsService.toTrimmedString(reason) ||
      '密码登录需要完成 QQ 安全验证';
    const shouldPublish = session.errorMessage !== message;
    session.status = 'pending';
    session.captchaUrl = undefined;
    session.preparingRelogin = false;
    session.qrcode = undefined;
    session.errorMessage = message;
    this.renewSessionExpiry(session);
    this.persistLoginSession(session);
    if (shouldPublish) {
      this.publishScanResultEvent(
        session,
        'password-login-captcha',
        'processing',
        message,
      );
    }
    return this.toResult(session);
  }

  /**
   * 清理密码登录上下文后把会话标记为验证码登录失败，持久化错误并发布失败事件。
   * @param session - 待读取、续期或持久化的fail验证码Login会话。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @param errorMessage - 包含正文、发送目标与账号身份的待处理消息。
   * @returns fail验证码Login。
   */
  private async failCaptchaLogin(
    session: BotLoginScanSession,
    container: NapcatRuntime,
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
    session.preparingContainer = false;
    session.preparingRelogin = false;
    this.persistLoginSession(session);
    this.publishScanEvent(session, {
      message: errorMessage,
      result: this.toResult(session),
      status: 'error',
      step: 'password-login-captcha-failed',
    });
    return this.toResult(session);
  }

  /**
   * 将`session`、`container`、`selfId`规范为cleanup密码LoginContext，使等价输入得到一致表示。
   * @param session - 待读取、续期或持久化的cleanup密码LoginContext会话。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @param selfId - 用于精确定位QQ 账号的标识；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @param cleanupFailureMessage - 包含正文、发送目标与账号身份的待处理消息；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 满足cleanup密码LoginContext约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private async cleanupPasswordLoginContext(
    session: BotLoginScanSession,
    container?: NapcatRuntime,
    selfId?: string,
    cleanupFailureMessage?: string,
  ) {
    if (!session.passwordMd5 && !session.captchaUrl) return true;
    void container;
    void selfId;
    void cleanupFailureMessage;

    session.captchaUrl = undefined;
    session.passwordMd5 = undefined;
    this.persistLoginSession(session);
    return true;
  }

  /**
   * 将登录会话写入状态存储，并同时记录验证码与新设备验证挑战。
   * @param session - 待读取、续期或持久化的persistLogin会话。
   */
  private persistLoginSession(session: BotLoginScanSession) {
    this.loginSessionStore.set(session);
    this.persistLoginChallenge(session);
  }

  /**
   * 根据当前登录会话同时记录验证码与新设备验证挑战，供后续状态查询复用。
   * @param session - 待读取、续期或持久化的根据当前登录会话同时记录验证码与新设备验证挑战，供后续状态查询复用会话。
   */
  private persistLoginChallenge(session: BotLoginScanSession) {
    this.loginSessionStore.recordCaptchaChallenge(session);
    this.loginSessionStore.recordNewDeviceChallenge(session);
  }

  /**
   * 按`sessionId`读取会话；从 `loginSessionStore.get` 读取会话。
   * @param sessionId - 用于精确定位会话的标识。
   * @returns 会话。
   */
  private async getSession(sessionId: string) {
    const session = await this.loginSessionStore.get(sessionId);
    if (!session) {
      throwVbenError('扫码会话不存在或已过期');
    }
    return session;
  }

  /**
   * 按`session`读取会话容器；从 `containerService.findRuntimeById` 读取会话容器。
   * @param session - 待读取、续期或持久化的会话容器会话。
   * @returns 会话容器。
   */
  private async getSessionContainer(session: BotLoginScanSession) {
    return this.containerService.findRuntimeById(session.containerId);
  }

  /**
   * 将当前运行态规范为cleanupSessions，使等价输入得到一致表示。
   */
  private async cleanupSessions() {
    const now = Date.now();
    const expiredSessions: BotLoginScanSession[] = [];
    this.loginSessionStore.forEach((session, sessionId) => {
      if (session.status !== 'pending' || now > session.expiresAt) {
        this.loginSessionStore.delete(sessionId);
        expiredSessions.push(session);
      }
    });
    await Promise.all(
      expiredSessions.map((session) => this.closeSession(session)),
    );
  }

  /**
   * 根据`session`处理过期状态会话。
   * @param session - 待读取、续期或持久化的过期状态会话。
   * @returns 过期状态会话。
   */
  private async expireSession(session: BotLoginScanSession) {
    const cleaned = await this.cleanupPasswordLoginContext(session);
    if (!cleaned) return this.toResult(session);
    session.status = 'expired';
    session.errorMessage = session.errorMessage || '扫码会话已过期';
    this.persistLoginSession(session);
    await this.loginSessionStore.flushSessionWrites(session.id);
    this.publishScanResultEvent(
      session,
      'session-expired',
      'error',
      session.errorMessage,
    );
    this.loginSessionStore.delete(session.id);
    await this.closeSession(session);
    return this.toResult(session);
  }

  /**
   * 在 QQ 登录成功但 selfId 尚未出现时保留待确认会话；超过等待上限才标记失败。
   * @param session - 待读取、续期或持久化的在 QQ 登录成功但 selfId 尚未出现时保留待确认会话。
   * @returns 返回更新后的扫码会话结果；超过 selfId 等待上限时返回失败会话结果。
   */
  private async keepLoginSelfIdPending(session: BotLoginScanSession) {
    const now = Date.now();
    session.loginSelfIdMissingSince ??= now;
    if (now - session.loginSelfIdMissingSince > this.getLoginSelfIdWaitMs()) {
      return this.failSession(session, 'NapCat 已登录但未返回 QQ 号');
    }

    const message = 'NapCat 已登录，正在读取 QQ 号';
    const shouldPublish = session.errorMessage !== message;
    session.status = 'pending';
    session.captchaUrl = undefined;
    session.errorMessage = message;
    session.preparingContainer = false;
    session.preparingRelogin = false;
    session.qrcode = undefined;
    this.renewSessionExpiry(session);
    this.persistLoginSession(session);
    if (shouldPublish) {
      this.publishScanResultEvent(
        session,
        'login-self-id-wait',
        'processing',
        message,
      );
    }
    return this.toResult(session);
  }

  /**
   * 从`session`解析过期的待处理会话；从 `loginSessionStore.getCached` 读取过期的待处理会话。
   * @param session - 待读取、续期或持久化的过期的待处理会话。
   * @returns 过期的待处理会话；没有可用结果或提前结束时为 `undefined`。
   */
  private async resolveStalePendingSession(session: BotLoginScanSession) {
    if (session.status !== 'pending') return undefined;
    if (Date.now() > session.expiresAt) return this.expireSession(session);

    const current = this.loginSessionStore.getCached(session.id);
    if (current === session) return undefined;
    if (current) return this.toResult(current);

    session.errorMessage = '登录会话已失效，请重新发起更新登录';
    return this.toResult(session);
  }

  /**
   * 把扫码会话标记为失败并清理敏感上下文，等待写入完成后发布错误、删除会话并关闭资源。
   * @param session - 待读取、续期或持久化的fail会话。
   * @param errorMessage - 包含正文、发送目标与账号身份的待处理消息。
   * @returns fail会话。
   */
  private async failSession(
    session: BotLoginScanSession,
    errorMessage: string,
  ) {
    session.status = 'error';
    session.captchaUrl = undefined;
    session.errorMessage = errorMessage;
    session.passwordMd5 = undefined;
    session.preparingRelogin = false;
    this.persistLoginSession(session);
    await this.loginSessionStore.flushSessionWrites(session.id);
    this.publishScanResultEvent(session, 'login-error', 'error', errorMessage);
    this.loginSessionStore.delete(session.id);
    await this.closeSession(session);
    return this.toResult(session);
  }

  /**
   * 按`session`停止close会话并清理该入口拥有的运行态资源。
   * @param session - 待读取、续期或持久化的close会话。
   */
  private async closeSession(session: BotLoginScanSession) {
    await this.cleanupPasswordLoginContext(session);
    await this.cleanupSessionContainer(session);
    this.loginSessionStore.delete(session.id);
    this.cleanupSessionEvents(session.id);
  }

  /**
   * 清理登录会话关联的临时 NapCat 容器，失败时在会话中保留或追加清理错误原因。
   * @param session - 提供容器标识、名称、端口和登录模式的会话；清理错误会写入其 `errorMessage`。
   */
  private async cleanupSessionContainer(session: BotLoginScanSession) {
    const cleanupError = await this.cleanupRuntimeContainer(
      {
        baseUrl: '',
        id: session.containerId,
        name: session.containerName || '',
        webuiPort: session.webuiPort,
      },
      {
        includeDeletedCreateContainer: session.mode === 'create',
      },
    );
    if (cleanupError) {
      if (session.errorMessage) {
        session.errorMessage = `${session.errorMessage}；清理未绑定容器失败：${cleanupError}`;
      } else {
        session.errorMessage = `清理未绑定容器失败：${cleanupError}`;
      }
    }
  }

  /**
   * 根据`container`、`session`、`status`处理try等待状态二维码；从 `getQrcode` 读取try等待状态二维码。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @param session - 待读取、续期或持久化的try等待状态二维码会话。
   * @param status - 用于try等待状态二维码的领域对象，包含 `qrcodeurl`、`loginError` 字段。
   * @param options - 控制try等待状态二维码筛选、缓存或输出方式的可选项，包含 `requireFresh`、`clearStaleQrcode` 字段；省略时默认采用 `{}`。
   * @throws 当 `!this.toolsService.isNapcatTemporaryError(err)` 成立时重新抛出该入口捕获且决定公开的原异常。
   */
  private async tryUpdatePendingQrcode(
    container: NapcatRuntime,
    session: BotLoginScanSession,
    status: NapcatLoginStatus,
    options: PendingQrcodeUpdateOptions = {},
  ) {
    const requireFresh = options.requireFresh ?? !!session.qrcode;
    try {
      const qrcode = await this.getQrcode(container, false, {
        requireFresh,
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
      if (options.clearStaleQrcode || requireFresh) {
        session.qrcode = undefined;
      }
      session.errorMessage =
        session.errorMessage || 'NapCat 正在重新生成二维码，请稍后';
    }
  }

  /**
   * 将`container`、`options`规范为运行态容器，使等价输入得到一致表示；当 `options.includeDeletedCreateContainer` 成立时返回 `null`。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @param options - 控制运行态容器筛选、缓存或输出方式的可选项，包含 `includeDeletedCreateContainer` 字段；省略时默认采用 `{}`。
   * @returns 运行态容器；无法解析或未命中时为 `null`。
   */
  private async cleanupRuntimeContainer(
    container: NapcatRuntime,
    options: { includeDeletedCreateContainer?: boolean } = {},
  ) {
    try {
      if (options.includeDeletedCreateContainer) {
        await this.containerService.removeUnboundCreateContainer(container.id);
        return null;
      }
      await this.containerService.removeUnboundContainer(container.id);
      return null;
    } catch (err) {
      return this.toolsService.getErrorMessage(err);
    }
  }

  /**
   * 按`container`、`retry`读取Login状态；当 `!retry` 成立时返回 `this.normalizeLoginStatus(container, status)`。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @param retry - 决定Login状态内容、边界或目标的 `retry` 值；省略时默认采用 `false`。
   * @returns Login状态。
   * @throws 当前函数此前所有接受或成功分支均未返回时拒绝当前输入并抛出 `lastError`。
   */
  private async getLoginStatus(container: NapcatRuntime, retry = false) {
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

  /**
   * 通过 `toolsService.isNapcatOfflineLoginStatus` 判断输入是否满足函数约束。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @param status - 用于Login状态的领域对象，包含 `isLogin` 字段。
   * @returns Login状态。
   * @throws 当 `getLoginInfo` 或 `toOfflineLoginStatus` 调用失败时重新抛出该入口捕获且决定公开的原异常。
   */
  private async normalizeLoginStatus(
    container: NapcatRuntime,
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

  /**
   * 在保留原状态字段的同时强制标记 QQ 离线，并优先保留已有登录错误文本。
   * @param status - 用于OfflineLogin状态的领域对象，包含 `loginError` 字段。
   * @param errorMessage - 包含正文、发送目标与账号身份的待处理消息；省略时默认采用 `'NapCat 账号已离线，请重新扫码登录'`。
   * @returns 包含 `isLogin`、`isOffline`、`loginError` 字段的OfflineLogin状态。
   */
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

  /**
   * 根据`session`、`container`、`status`处理接近已过期的二维码。
   * @param session - 待读取、续期或持久化的接近已过期的二维码会话。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @param status - 用于接近已过期的二维码的领域对象，包含 `qrcodeurl` 字段。
   * @returns 接近已过期的二维码。
   * @throws 当 `!this.toolsService.isNapcatTemporaryError(err)` 成立时重新抛出该入口捕获且决定公开的原异常。
   */
  private async refreshNearlyExpiredQrcode(
    session: BotLoginScanSession,
    container: NapcatRuntime,
    status: NapcatLoginStatus,
  ) {
    try {
      session.qrcode = await this.refreshOrGetQrcode(container, false, {
        fallbackStatus: status,
        requireFresh: true,
        staleQrcode: status.qrcodeurl,
      });
      session.errorMessage = undefined;
      this.publishScanResultEvent(
        session,
        'qrcode-ready',
        'success',
        '登录二维码已刷新',
      );
      return this.toResult(session);
    } catch (err) {
      if (!this.toolsService.isNapcatTemporaryError(err)) throw err;
      session.qrcode = undefined;
      return this.keepSessionPending(
        session,
        '登录二维码即将过期，NapCat 正在重新生成二维码',
      );
    }
  }

  /**
   * 根据`status`与当前约束判定是否应当刷新接近已过期的二维码；当 `!status.qrcodeurl || this.toolsService.isNapcatExpiredQrcodeS…` 成立时返回 `false`。
   * @param status - 用于是否应当刷新接近已过期的二维码的领域对象，包含 `qrcodeurl`、`qrcodeUpdatedAt` 字段。
   * @returns 满足是否应当刷新接近已过期的二维码约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private shouldRefreshNearlyExpiredQrcode(status: NapcatLoginStatus) {
    if (
      !status.qrcodeurl ||
      this.toolsService.isNapcatExpiredQrcodeStatus(status)
    ) {
      return false;
    }
    const updatedAt = Number(status.qrcodeUpdatedAt);
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) return false;
    const ageMs = Date.now() - updatedAt;
    return ageMs >= this.getNativeQrcodeTtlMs() - this.getQrcodeSafeScanMs();
  }

  /**
   * 根据`session`、`status`与当前约束判定是否应当自动刷新待处理二维码；从 `getQrcodeAutoRefreshCooldownMs` 读取是否应当自动刷新待处理二维码。
   * @param session - 待读取、续期或持久化的是否应当自动刷新待处理二维码会话。
   * @param status - 用于是否应当自动刷新待处理二维码的领域对象，包含 `qrcodeurl`、`isLogin` 字段。
   * @returns 满足是否应当自动刷新待处理二维码约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private shouldAutoRefreshPendingQrcode(
    session: BotLoginScanSession,
    status: NapcatLoginStatus,
  ) {
    if (session.preparingContainer || session.preparingRelogin) return false;
    if (session.captchaUrl || session.newDeviceStatus) return false;
    if (session.qrcode || status.qrcodeurl || status.isLogin) return false;
    if (this.toolsService.isNapcatExpiredQrcodeStatus(status)) return false;

    const lastRefreshAt = Number(session.lastQrcodeRefreshAt || 0);
    if (!Number.isFinite(lastRefreshAt) || lastRefreshAt <= 0) return true;
    return Date.now() - lastRefreshAt >= this.getQrcodeAutoRefreshCooldownMs();
  }

  /**
   * 根据`session`、`container`、`status`处理待处理二维码来自状态；从 `getSessionTtlMs` 读取待处理二维码来自状态。
   * @param session - 待读取、续期或持久化的待处理二维码来自状态会话。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @param status - 用于待处理二维码来自状态的领域对象，包含 `qrcodeurl` 字段。
   * @returns 待处理二维码来自状态。
   * @throws 当 `!this.toolsService.isNapcatTemporaryError(err)` 成立时重新抛出该入口捕获且决定公开的原异常。
   */
  private async refreshPendingQrcodeFromStatus(
    session: BotLoginScanSession,
    container: NapcatRuntime,
    status: NapcatLoginStatus,
  ) {
    session.lastQrcodeRefreshAt = Date.now();
    this.persistLoginSession(session);
    this.publishScanResultEvent(
      session,
      'qrcode-fetch',
      'processing',
      '正在重新生成登录二维码',
    );

    try {
      session.qrcode = await this.refreshOrGetQrcode(container, false, {
        fallbackStatus: status,
        requireFresh:
          session.mode === 'refresh' ||
          !!session.qrcode ||
          this.toolsService.isNapcatExpiredQrcodeStatus(status),
        staleQrcode: session.qrcode || status.qrcodeurl,
      });
      session.errorMessage = undefined;
      session.expiresAt = Date.now() + this.getSessionTtlMs();
      this.persistLoginSession(session);
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
      if (!this.toolsService.isNapcatTemporaryError(err)) throw err;
      session.qrcode = undefined;
      session.errorMessage =
        'NapCat 正在重新生成二维码，请稍后刷新或等待自动更新';
      this.persistLoginSession(session);
      return this.toResult(session);
    }
  }

  /**
   * 读取原生的二维码有效期毫秒；通过 `getPositiveConfigNumber` 读取对应运行配置。
   * @returns 返回原生的二维码有效期毫秒；通过 `getPositiveConfigNumber` 读取对应运行配置。
   */
  private getNativeQrcodeTtlMs() {
    return this.getPositiveConfigNumber(
      'NAPCAT_LOGIN_NATIVE_QR_EXPIRE_MS',
      2 * 60 * 1000,
    );
  }

  /**
   * 读取二维码安全扫描毫秒；通过 `getPositiveConfigNumber` 读取对应运行配置。
   * @returns 返回二维码安全扫描毫秒；通过 `getPositiveConfigNumber` 读取对应运行配置。
   */
  private getQrcodeSafeScanMs() {
    return this.getPositiveConfigNumber(
      'NAPCAT_LOGIN_QR_SAFE_SCAN_MS',
      45 * 1000,
    );
  }

  /**
   * 按当前运行态读取二维码自动刷新冷却时间毫秒；从 `getPositiveConfigNumber` 读取二维码自动刷新冷却时间毫秒。
   * @returns 二维码自动刷新冷却时间毫秒。
   */
  private getQrcodeAutoRefreshCooldownMs() {
    return this.getPositiveConfigNumber(
      'NAPCAT_LOGIN_QR_AUTO_REFRESH_COOLDOWN_MS',
      Math.max(5000, this.getLoginPollIntervalMs() * 2),
    );
  }

  /**
   * 读取 QQ 登录后等待 selfId 出现的毫秒上限，缺失配置使用固定默认值。
   * @returns 返回等待 selfId 的配置毫秒数；无有效配置时返回固定默认值。
   */
  private getLoginSelfIdWaitMs() {
    return this.getPositiveConfigNumber(
      'NAPCAT_LOGIN_SELF_ID_WAIT_MS',
      30_000,
    );
  }

  /**
   * 通过指定 NapCat 容器调用 `GetQQLoginInfo` 接口，并返回当前 QQ 登录资料。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @returns NapCat `GetQQLoginInfo` 接口返回的当前账号登录资料。
   */
  private async getLoginInfo(container: NapcatRuntime) {
    return this.postNapcat<NapcatLoginInfo>(
      container,
      '/api/QQLogin/GetQQLoginInfo',
    );
  }

  /**
   * 通过可选重试调用 NapCat 刷新二维码接口；已登录错误转为空字符串，其他错误继续抛出。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @param retry - 决定通过可选重试调用 NapCat 刷新二维码接口内容、边界或目标的 `retry` 值；省略时默认采用 `false`。
   * @returns 通过可选重试调用 NapCat 刷新二维码接口。
   */
  private async callRefreshQrcode(
    container: NapcatRuntime,
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

  /**
   * 通过可选重试读取 NapCat 登录二维码；结果缺失或仍在生成时回退到登录状态，已登录时按新鲜度要求处理。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @param retry - 决定通过可选重试读取 NapCat 登录二维码内容、边界或目标的 `retry` 值；省略时默认采用 `false`。
   * @param options - 控制通过可选重试读取 NapCat 登录二维码筛选、缓存或输出方式的可选项，包含 `requireFresh` 字段；省略时默认采用 `{}`。
   * @returns 通过可选重试读取 NapCat 登录二维码。
   */
  private async getQrcode(
    container: NapcatRuntime,
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
          if (options.requireFresh) {
            throw new Error('NapCat WebUI 登录态仍阻止生成新二维码');
          }
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

  /**
   * 通过 `callRefreshQrcode` 调用受控主机能力。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @param retry - 决定刷新结果二维码内容、边界或目标的 `retry` 值；省略时默认采用 `false`。
   * @param options - 控制刷新结果二维码筛选、缓存或输出方式的可选项，包含 `fallbackStatus`、`requireFresh`、`staleQrcode` 字段；省略时默认采用 `{}`。
   * @returns 刷新结果二维码。
   * @throws 当 `callRefreshQrcode` 或 `toolsService.ensureFreshQrcode` 调用失败时重新抛出该入口捕获且决定公开的原异常。
   */
  private async refreshOrGetQrcode(
    container: NapcatRuntime,
    retry = false,
    options: QrcodeRefreshOptions = {},
  ) {
    const fallbackStatus = options.fallbackStatus;
    const lookupOptions: QrcodeLookupOptions = {
      requireFresh: options.requireFresh || fallbackStatus?.isOffline,
      staleQrcode: options.staleQrcode || fallbackStatus?.qrcodeurl,
    };
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

  /**
   * 按`container`、`options`读取二维码状态；当 `status.qrcodeurl && !this.toolsService.isNapcatExpiredQrcodeS…` 成立时返回 `this.toolsService.ensureFreshQrcode(status.…`。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @param options - 控制二维码状态筛选、缓存或输出方式的可选项，包含 `requireFresh` 字段；省略时默认采用 `{}`。
   * @returns 二维码状态。
   * @throws 当 `options.requireFresh && status.qrcodeurl` 成立时拒绝当前输入并抛出 `Error`。
   */
  private async getQrcodeFromStatus(
    container: NapcatRuntime,
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

  /**
   * 按`container`、`path`、`body`投递postNapCat；向目标通道投递结果（`webuiClient.post`）。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @param path - 必须保持在受控根目录内的路径。
   * @param body - 用于postNapCat的结构化输入；省略时默认采用 `{}`。
   * @returns NapCat WebUI POST 响应解包后的业务数据。
   */
  private async postNapcat<T>(
    container: NapcatRuntime,
    path: string,
    body: Record<string, any> = {},
  ) {
    return this.webuiClient
      .post<T>(container, path, body)
      .catch((err): never => {
        const message = this.toolsService.getErrorMessage(err);
        return throwVbenError(message || 'NapCat 请求失败');
      });
  }

  /**
   * 根据`session`、`container`、`loginPassword`构造Relogin二维码；当 `session.sourceContainerOnline === true` 成立时直接结束且不产生返回值。
   * @param session - 待读取、续期或持久化的Relogin二维码会话。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @param loginPassword - 决定Relogin二维码内容、边界或目标的 `loginPassword` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @param hasExistingPrimaryBinding - 决定是否启用“ExistingPrimary绑定”分支的布尔选项；省略时默认采用 `true`。
   */
  private async prepareReloginQrcode(
    session: BotLoginScanSession,
    container: NapcatRuntime,
    loginPassword?: string,
    hasExistingPrimaryBinding = true,
  ) {
    try {
      const password = this.toolsService.toSecretText(loginPassword);
      if (session.sourceContainerOnline === true) {
        const completed = await this.completeOnlineSourceRefresh(
          session,
          container,
        );
        if (completed) return;
      }
      if (hasExistingPrimaryBinding) {
        const quickLoginCompleted = await this.tryQuickRelogin(
          session,
          container,
          !!password,
        );
        if (quickLoginCompleted) return;
      }
      if (await this.resolveStalePendingSession(session)) return;

      const passwordLoginCompleted = await this.tryPasswordRelogin(
        session,
        container,
        password,
      );
      if (passwordLoginCompleted) return;
      if (await this.resolveStalePendingSession(session)) return;

      this.publishScanResultEvent(
        session,
        'qrcode-fetch',
        'processing',
        '正在获取登录二维码',
      );
      session.qrcode = await this.refreshOrGetQrcode(container, false, {
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
      await this.syncSessionQqLoginStatus(session, {
        isLogin: false,
        qrcodeurl: session.qrcode,
      });
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
      const current = this.loginSessionStore.getCached(session.id);
      if (current === session && current.status === 'pending') {
        current.preparingRelogin = false;
        this.persistLoginSession(current);
      }
    }
  }

  /**
   * 当源容器仍在线时核对 QQ 登录态；离线且未重启过则重启工作进程，已登录目标账号则直接完成会话，其余情况返回 false 继续 WebUI 登录。
   * @param session - 更新登录会话；若当前容器已经登录目标账号则直接完成。
   * @param container - NapCat 运行态；用于只读检查当前 QQ 登录态。
   * @returns 当前容器已登录目标账号并完成会话时返回 true，否则返回 false 继续 WebUI 登录流程。
   */
  private async completeOnlineSourceRefresh(
    session: BotLoginScanSession,
    container: NapcatRuntime,
  ) {
    const loginStatus = await this.getLoginStatus(container, true);
    if (
      loginStatus.isOffline &&
      this.shouldRestartNapcatWorkerForOnlineRefresh(session)
    ) {
      await this.restartNapcatWorkerForOnlineRefresh(
        session,
        container,
        loginStatus.loginError || 'NapCat 账号已离线，正在重启登录服务',
      );
      return false;
    }
    if (!loginStatus.isLogin) return false;

    const loginInfo = await this.getLoginInfo(container);
    if (loginInfo.online === false) return false;

    const selfId = this.toolsService.pickNapcatSelfId(loginInfo);
    if (!selfId) return false;
    if (session.expectedSelfId && session.expectedSelfId !== selfId) {
      return false;
    }

    await this.completeLogin(session, container, {
      loginInfo,
      successMessage: '当前 NapCat 容器已在线，无需重建登录',
    });
    return true;
  }

  /**
   * 根据`session`、`container`、`hasPasswordFallback`处理try快速登录Relogin；当 `!uin` 成立时返回 `false`。
   * @param session - 待读取、续期或持久化的try快速登录Relogin会话。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @param hasPasswordFallback - 决定是否启用“密码Fallback”分支的布尔选项；省略时默认采用 `false`。
   * @returns 满足try快速登录Relogin约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private async tryQuickRelogin(
    session: BotLoginScanSession,
    container: NapcatRuntime,
    hasPasswordFallback = false,
  ) {
    let loginInfo: NapcatLoginInfo;
    session.errorMessage = 'NapCat 正在尝试快速登录，请稍后';
    this.persistLoginSession(session);
    this.publishScanResultEvent(
      session,
      'quick-login-start',
      'processing',
      '正在尝试 NapCat 快速登录',
    );

    try {
      const uin = this.toolsService.toTrimmedString(session.expectedSelfId);
      if (!uin) {
        this.publishQuickLoginFallback(
          session,
          '缺少目标 QQ 号',
          hasPasswordFallback,
        );
        return false;
      }
      await this.postNapcat<null>(container, '/api/QQLogin/SetQuickLogin', {
        uin,
      });
      this.publishScanResultEvent(
        session,
        'quick-login-wait',
        'processing',
        '等待 NapCat 快速登录结果',
      );
      const loginStatus = await this.waitForQuickLoginStatus(container);
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
      if (this.toolsService.isNapcatAlreadyLoggedInError(err)) {
        return this.completeAlreadyLoggedInQuickRelogin(
          session,
          container,
          hasPasswordFallback,
        );
      }
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

  /**
   * 只有在线容器的刷新会话尚未尝试工作进程重启时返回 `true`。
   * @param session - 待读取、续期或持久化的只有在线容器的刷新会话尚未尝试工作进程重启时返回 `true`会话。
   * @returns 满足只有在线容器的刷新会话尚未尝试工作进程重启时返回 `true`约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private shouldRestartNapcatWorkerForOnlineRefresh(
    session: BotLoginScanSession,
  ) {
    return (
      session.mode === 'refresh' &&
      session.sourceContainerOnline === true &&
      session.onlineSourceWorkerRestartAttempted !== true
    );
  }

  /**
   * 标记在线刷新重启尝试并持久化会话状态，随后重启对应 NapCat 容器并发布扫描结果。
   * @param session - 待读取、续期或持久化的标记在线刷新重启尝试并持久化会话状态，随后重启对应 NapCat 容器并发布扫描结果会话。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @param reason - 决定标记在线刷新重启尝试并持久化会话状态，随后重启对应 NapCat 容器并发布扫描结果内容、边界或目标的 `reason` 值。
   * @returns NapCat工作进程Online刷新结果。
   */
  private async restartNapcatWorkerForOnlineRefresh(
    session: BotLoginScanSession,
    container: NapcatRuntime,
    reason: string,
  ) {
    session.lastRestartedAt = Date.now();
    session.onlineSourceWorkerRestartAttempted = true;
    session.errorMessage = reason;
    this.persistLoginSession(session);
    this.publishScanResultEvent(
      session,
      'napcat-worker-restart',
      'processing',
      reason,
    );
    await this.restartNapcatForLogin(container, {
      processOnly: true,
      waitForReady: true,
    });
    return this.getLoginStatus(container, true);
  }

  /**
   * 在 NapCat WebUI 拒绝重复 quick 登录时读取真实 QQ 在线态。
   * @param session - 当前更新登录会话；成功时直接完成会话，失败时写入 fallback 进度。
   * @param container - 当前 NapCat WebUI 容器；只读调用 CheckLoginStatus/GetQQLoginInfo。
   * @param hasPasswordFallback - 是否还有密码登录分支；决定 fallback 文案里的下一步。
   * @returns 真实 QQ 在线且账号匹配时返回 true，否则返回 false 继续后续登录分支。
   */
  private async completeAlreadyLoggedInQuickRelogin(
    session: BotLoginScanSession,
    container: NapcatRuntime,
    hasPasswordFallback: boolean,
  ) {
    this.publishScanResultEvent(
      session,
      'quick-login-status-check',
      'processing',
      'NapCat 报告账号已登录，正在确认真实在线状态',
    );

    let loginInfo: NapcatLoginInfo;
    try {
      const loginStatus = await this.getLoginStatus(container, true);
      if (!loginStatus.isLogin) {
        await this.syncSessionQqLoginStatus(session, loginStatus);
        this.publishQuickLoginFallback(
          session,
          loginStatus.loginError || 'NapCat 已登录标记残留但真实 QQ 已离线',
          hasPasswordFallback,
        );
        return false;
      }

      loginInfo = await this.getLoginInfo(container);
      if (loginInfo.online === false) {
        this.publishQuickLoginFallback(
          session,
          'NapCat 已登录标记残留但真实 QQ 已离线',
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
          `当前已登录账号 ${selfId} 与目标账号 ${session.expectedSelfId} 不一致`,
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
      successMessage: 'NapCat 已登录，已确认真实在线状态',
    });
    return true;
  }

  /**
   * 根据`session`、`container`、`loginPassword`处理try密码Relogin；当 `!password` 成立时返回 `false`。
   * @param session - 待读取、续期或持久化的try密码Relogin会话。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @param loginPassword - 决定try密码Relogin内容、边界或目标的 `loginPassword` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 满足try密码Relogin约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private async tryPasswordRelogin(
    session: BotLoginScanSession,
    container: NapcatRuntime,
    loginPassword?: string,
  ) {
    const password = this.toolsService.toSecretText(loginPassword);
    if (!password) {
      this.publishPasswordLoginFallback(session, '未配置 QQ 登录密码');
      return false;
    }

    let loginInfo: NapcatLoginInfo | undefined;
    const passwordLogSinceMs = Date.now();
    session.passwordMd5 = createHash('md5')
      .update(password, 'utf8')
      .digest('hex');
    session.lastRestartedAt = passwordLogSinceMs;
    session.errorMessage = 'NapCat 正在尝试密码登录，请稍后';
    this.persistLoginSession(session);
    this.publishScanResultEvent(
      session,
      'password-login-start',
      'processing',
      '正在尝试 NapCat 密码登录',
    );

    let loginStatus: NapcatLoginStatus;
    try {
      const uin = this.toolsService.toTrimmedString(session.expectedSelfId);
      if (!uin) {
        this.publishPasswordLoginFallback(session, '缺少目标 QQ 号');
        return false;
      }
      const passwordResult =
        await this.postNapcat<NapcatCaptchaLoginResult | null>(
          container,
          '/api/QQLogin/PasswordLogin',
          {
            passwordMd5: session.passwordMd5,
            uin,
          },
        );
      const passwordResultPending = await this.applyPasswordLoginResult(
        session,
        container,
        passwordResult,
        passwordLogSinceMs,
      );
      if (passwordResultPending) return true;
      this.publishScanResultEvent(
        session,
        'password-login-wait',
        'processing',
        '等待 NapCat 密码登录结果',
      );
      loginStatus = await this.waitForPasswordLoginStatus(
        container,
        passwordLogSinceMs,
      );

      if (loginStatus.isLogin) {
        loginInfo = await this.getLoginInfo(container);
      }
    } catch (err) {
      const errorMessage = this.toolsService.getErrorMessage(err);
      if (this.toolsService.isNapcatCaptchaRequiredMessage(errorMessage)) {
        const captchaUrl = await this.waitForPasswordCaptchaUrl(
          container,
          passwordLogSinceMs,
        );
        if (captchaUrl) {
          this.keepPasswordCaptchaPending(session, captchaUrl, errorMessage);
        } else {
          this.keepPasswordCaptchaWaitingForUrl(session, errorMessage);
        }
        return true;
      }
      this.publishPasswordLoginFallback(session, errorMessage);
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
        passwordLogSinceMs,
      );
      if (captchaUrl) {
        this.keepPasswordCaptchaPending(
          session,
          captchaUrl,
          loginStatus.loginError,
        );
        return true;
      }

      this.publishPasswordLoginFallback(session, loginStatus.loginError);
      return false;
    }

    if (loginInfo?.online === false) {
      this.publishPasswordLoginFallback(session, 'NapCat 当前账号已离线');
      return false;
    }
    if (!loginInfo) {
      this.publishPasswordLoginFallback(session, 'NapCat 未返回登录信息');
      return false;
    }

    const selfId = this.toolsService.pickNapcatSelfId(loginInfo);
    if (!selfId) {
      this.publishPasswordLoginFallback(session, 'NapCat 未返回 QQ 号');
      return false;
    }
    if (session.expectedSelfId && session.expectedSelfId !== selfId) {
      this.publishPasswordLoginFallback(
        session,
        `当前密码登录账号 ${selfId} 与目标账号 ${session.expectedSelfId} 不一致`,
      );
      return false;
    }

    await this.completeLogin(session, container, {
      loginInfo,
      successMessage: '密码登录成功',
    });
    return true;
  }

  /**
   * 根据参数 `container`，轮询 NapCat WebUI 快速登录后的 QQ 登录态。
   * @param container - NapCat WebUI 运行态；用于调用 CheckLoginStatus。
   * @returns 最早出现的成功、失败或可继续二维码状态。
   */
  private async waitForQuickLoginStatus(container: NapcatRuntime) {
    let latestStatus: NapcatLoginStatus = { isLogin: false };
    const attempts = this.getLoginPollAttempts(
      this.getQuickLoginWaitMs(),
      this.getLoginPollIntervalMs(),
    );
    for (let index = 0; index < attempts; index += 1) {
      if (index > 0) {
        await this.toolsService.sleep(this.getLoginPollIntervalMs());
      }
      latestStatus = await this.getLoginStatus(container, true);
      if (
        latestStatus.isLogin ||
        latestStatus.isOffline ||
        latestStatus.loginError ||
        latestStatus.qrcodeurl
      ) {
        return latestStatus;
      }
    }
    return latestStatus;
  }

  /**
   * 处理 NapCat WebUI PasswordLogin 的同步返回结果。
   * @param session - 更新登录会话；保存验证码、新设备二维码和密码 MD5 上下文。
   * @param container - NapCat WebUI 运行态；新设备二维码和验证码后续提交都回到同一容器。
   * @param result - PasswordLogin 返回体；官方用它声明验证码或新设备验证。
   * @param sinceMs - PasswordLogin 发起时间；限定容器日志验证码 URL 的读取窗口。
   * @returns 已进入人工验证 pending 态时返回 true；没有同步挑战时返回 false。
   */
  private async applyPasswordLoginResult(
    session: BotLoginScanSession,
    container: NapcatRuntime,
    result: NapcatCaptchaLoginResult | null,
    sinceMs: number,
  ) {
    if (!result) return false;
    if (result.needNewDevice) {
      await this.startNewDeviceVerification(session, container, result);
      return true;
    }

    const proofWaterUrl = this.toolsService.toTrimmedString(
      result.proofWaterUrl,
    );
    if (!result.needCaptcha && !proofWaterUrl) return false;

    if (proofWaterUrl) {
      this.keepPasswordCaptchaPending(session, proofWaterUrl);
      return true;
    }
    const captchaUrl = await this.waitForPasswordCaptchaUrl(container, sinceMs);
    if (captchaUrl) {
      this.keepPasswordCaptchaPending(session, captchaUrl);
      return true;
    }
    this.keepPasswordCaptchaWaitingForUrl(
      session,
      '密码登录需要完成 QQ 安全验证',
    );
    return true;
  }

  /**
   * 通过 `publishScanResultEvent` 发布领域状态。
   * @param session - 待读取、续期或持久化的keep密码二维码等待状态会话。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @param loginStatus - 用于keep密码二维码等待状态的领域对象，包含 `qrcodeurl` 字段。
   */
  private async keepPasswordQrcodePending(
    session: BotLoginScanSession,
    container: NapcatRuntime,
    loginStatus: NapcatLoginStatus,
  ) {
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
    session.passwordMd5 = undefined;
    this.persistLoginSession(session);
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

  /**
   * 从`container`、`loginStatus`、`sinceMs`解析密码验证码URL 地址；当 `!this.toolsService.isNapcatCaptchaRequiredMessage(loginStatus…` 成立时返回 `''`。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @param loginStatus - 用于密码验证码URL 地址的领域对象，包含 `loginError` 字段。
   * @param sinceMs - 用于密码验证码URL 地址超时、有效期或退避计算的毫秒数；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 当前状态对应的密码验证码URL 地址，取值为 `''`。
   */
  private async resolvePasswordCaptchaUrl(
    container: NapcatRuntime,
    loginStatus: NapcatLoginStatus,
    sinceMs?: number,
  ) {
    const statusCaptchaUrl = this.getCaptchaUrlFromStatus(loginStatus);
    if (statusCaptchaUrl) return statusCaptchaUrl;
    const runtimeCaptchaUrl = await this.detectPasswordCaptchaUrl(
      container,
      sinceMs,
      false,
    );
    if (runtimeCaptchaUrl) return runtimeCaptchaUrl;
    if (
      !this.toolsService.isNapcatCaptchaRequiredMessage(loginStatus.loginError)
    ) {
      return '';
    }
    return this.waitForPasswordCaptchaUrl(container, sinceMs);
  }

  /**
   * 通过 `isPasswordCaptchaStillRequired` 判断输入是否满足函数约束。
   * @param session - 待读取、续期或持久化的状态验证码URL 地址会话。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @param loginStatus - 决定状态验证码URL 地址内容、边界或目标的 `loginStatus` 值。
   * @returns 当前状态对应的状态验证码URL 地址，取值为 `''`。
   */
  private async resolveStatusCaptchaUrl(
    session: BotLoginScanSession,
    container: NapcatRuntime,
    loginStatus: NapcatLoginStatus,
  ) {
    if (!this.isPasswordCaptchaStillRequired(loginStatus)) return '';
    if (!this.shouldLookupStatusCaptchaUrl(session)) return '';
    session.lastCaptchaLookupAt = Date.now();
    this.persistLoginSession(session);
    return this.detectPasswordCaptchaUrl(container, session.lastRestartedAt);
  }

  /**
   * 按`status`读取验证码URL 地址状态。
   * @param status - 用于验证码URL 地址状态的领域对象，包含 `captchaUrl`、`loginError` 字段。
   * @returns 规范化后的验证码URL 地址状态；主值为空时采用 `this.toolsService.extractNapcatCaptchaUrl(status.lo…` 兜底。
   */
  private getCaptchaUrlFromStatus(status: NapcatLoginStatus) {
    return (
      this.toolsService.toTrimmedString(status.captchaUrl) ||
      this.toolsService.extractNapcatCaptchaUrl(status.loginError)
    );
  }

  /**
   * 通过 `Math.max` 收敛数值边界。
   * @param session - 待读取、续期或持久化的Lookup状态验证码URL 地址会话。
   * @returns 满足Lookup状态验证码URL 地址约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private shouldLookupStatusCaptchaUrl(session: BotLoginScanSession) {
    const lastCheckedAt = Number(session.lastCaptchaLookupAt || 0);
    if (!Number.isFinite(lastCheckedAt) || lastCheckedAt <= 0) return true;
    const cooldownMs = Math.max(15_000, this.getLoginPollIntervalMs() * 5);
    return Date.now() - lastCheckedAt > cooldownMs;
  }

  /**
   * 根据`status`与当前约束判定密码验证码StillRequired；当 `this.toolsService.includesAny(message, [ '失败', '错误', '过期', '失…` 成立时返回 `false`。
   * @param status - 用于密码验证码StillRequired的领域对象，包含 `loginError` 字段。
   * @returns 满足密码验证码StillRequired约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isPasswordCaptchaStillRequired(status: NapcatLoginStatus) {
    if (this.getCaptchaUrlFromStatus(status)) return true;
    const message = this.toolsService.toTrimmedString(status.loginError);
    if (
      this.toolsService.includesAny(message, [
        '失败',
        '错误',
        '过期',
        '失效',
        '拒绝',
        '取消',
      ])
    ) {
      return false;
    }
    return (
      message.includes('proofWaterUrl') ||
      message.includes('需要验证码') ||
      message.includes('继续完成验证') ||
      message.includes('需要安全验证') ||
      message.includes('继续安全验证') ||
      message.includes('完成安全验证')
    );
  }

  /**
   * 仅在容器服务提供检测能力时查找密码验证地址；近期日志未命中且允许时，回退到无时间边界的尾部检测。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @param sinceMs - 用于仅在容器服务提供检测能力时查找密码验证地址超时、有效期或退避计算的毫秒数；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @param allowTailFallback - 决定是否启用“allowTailFallback”分支的布尔选项；省略时默认采用 `true`。
   * @returns 规范化后的仅在容器服务提供检测能力时查找密码验证地址；主值为空时采用 `''` 兜底。
   */
  private async detectPasswordCaptchaUrl(
    container: NapcatRuntime,
    sinceMs?: number,
    allowTailFallback = true,
  ) {
    if (typeof this.containerService.detectRuntimeCaptchaUrl !== 'function') {
      return '';
    }
    const recentCaptchaUrl =
      await this.containerService.detectRuntimeCaptchaUrl(container, sinceMs);
    if (recentCaptchaUrl) return recentCaptchaUrl;
    if (!allowTailFallback) return '';
    return (
      (await this.containerService.detectRuntimeCaptchaUrl(container)) || ''
    );
  }

  /**
   * 根据`container`、`sinceMs`计算并预留密码验证码URL 地址；等待超过配置上限时拒绝，否则延迟到可用时间；从 `getLoginPollIntervalMs` 读取密码验证码URL 地址。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @param sinceMs - 用于密码验证码URL 地址超时、有效期或退避计算的毫秒数；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 当前状态对应的密码验证码URL 地址，取值为 `''`。
   */
  private async waitForPasswordCaptchaUrl(
    container: NapcatRuntime,
    sinceMs?: number,
  ) {
    const attempts = 5;
    for (let index = 0; index < attempts; index += 1) {
      if (index > 0) {
        await this.toolsService.sleep(this.getLoginPollIntervalMs());
      }
      const captchaUrl = await this.detectPasswordCaptchaUrl(
        container,
        sinceMs,
        true,
      );
      if (captchaUrl) return captchaUrl;
    }
    return '';
  }

  /**
   * 根据`status`与当前约束判定密码二维码验证挑战。
   * @param status - 用于密码二维码验证挑战的领域对象，包含 `qrcodeurl` 字段。
   * @returns 满足密码二维码验证挑战约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isPasswordQrcodeChallenge(status: NapcatLoginStatus) {
    return (
      !!this.toolsService.toTrimmedString(status.qrcodeurl) ||
      this.toolsService.isNapcatExpiredQrcodeStatus(status)
    );
  }

  /**
   * 根据是否存在主绑定及是否提供密码，选择快速登录、密码登录或二维码准备文案。
   * @param options - 控制根据是否存在主绑定及是否提供密码，选择快速登录、密码登录或二维码准备文案筛选、缓存或输出方式的可选项，包含 `hasExistingPrimaryBinding`、`loginPassword` 字段。
   * @returns 当前状态对应的根据是否存在主绑定及是否提供密码，选择快速登录、密码登录或二维码准备文案，取值为 `'NapCat 正在尝试快速登录，请稍后'`、`'NapCat 正在尝试密码登录，请稍后'`、`'NapCat 正在准备登录二维码，请稍后'`。
   */
  private getReloginPreparingMessage(options: {
    hasExistingPrimaryBinding?: boolean;
    loginPassword?: string;
  }) {
    if (options.hasExistingPrimaryBinding !== false) {
      return 'NapCat 正在尝试快速登录，请稍后';
    }
    if (this.toolsService.toSecretText(options.loginPassword)) {
      return 'NapCat 正在尝试密码登录，请稍后';
    }
    return 'NapCat 正在准备登录二维码，请稍后';
  }

  /**
   * 记录快速登录未完成的原因与下一步密码或二维码流程，并持久化会话后发布进度事件。
   * @param session - 待读取、续期或持久化的快速登录LoginFallback会话。
   * @param reason - 决定快速登录LoginFallback内容、边界或目标的 `reason` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @param hasPasswordFallback - 决定是否启用“密码Fallback”分支的布尔选项；省略时默认采用 `false`。
   */
  private publishQuickLoginFallback(
    session: BotLoginScanSession,
    reason?: string,
    hasPasswordFallback = false,
  ) {
    const nextStepMessage = (() => {
      if (hasPasswordFallback) {
        return '开始尝试密码登录';
      }
      return '开始生成二维码';
    })();
    if (reason) {
      session.errorMessage = `快速登录未完成：${reason}，${nextStepMessage}`;
    } else {
      session.errorMessage = `快速登录未完成，${nextStepMessage}`;
    }
    this.persistLoginSession(session);
    this.publishScanResultEvent(
      session,
      'quick-login-fallback',
      'processing',
      session.errorMessage,
    );
  }

  /**
   * 记录密码登录未完成的原因与二维码回退步骤，并持久化会话后发布进度事件。
   * @param session - 待读取、续期或持久化的密码LoginFallback会话。
   * @param reason - 决定密码LoginFallback内容、边界或目标的 `reason` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   */
  private publishPasswordLoginFallback(
    session: BotLoginScanSession,
    reason?: string,
  ) {
    if (reason) {
      session.errorMessage = `密码登录未完成：${reason}，开始生成二维码`;
    } else {
      session.errorMessage = '密码登录未完成，开始生成二维码';
    }
    this.persistLoginSession(session);
    this.publishScanResultEvent(
      session,
      'password-login-fallback',
      'processing',
      session.errorMessage,
    );
  }

  /**
   * 按`container`、`options`重启NapCatLogin；可选择仅重启工作进程，并按配置等待服务恢复就绪；从 `getRestartDelayMs` 读取NapCatLogin。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @param options - 控制NapCatLogin筛选、缓存或输出方式的可选项，包含 `processOnly`、`waitForReady` 字段；省略时默认采用 `{}`。
   * @throws 当 `!this.toolsService.isNapcatTemporaryError(err)` 成立时重新抛出该入口捕获且决定公开的原异常。
   */
  private async restartNapcatForLogin(
    container: NapcatRuntime,
    options: NapcatRestartOptions = {},
  ) {
    const restartedByContainer = await (async () => {
      if (options.processOnly) {
        return false;
      }
      return await this.containerService.restartRuntimeContainer(container);
    })();
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

    this.webuiClient.clearCredential(container);
    if (options.waitForReady === false) return;

    await this.toolsService.sleep(this.getRestartDelayMs());
    await this.getLoginStatus(container, true);
  }

  /**
   * 按当前运行态读取会话有效期Ms；从 `configService.get` 读取会话有效期Ms。
   * @returns 会话有效期Ms。
   */
  private getSessionTtlMs() {
    return Number(
      this.configService.get('NAPCAT_LOGIN_QR_EXPIRE_MS') || 2 * 60 * 1000,
    );
  }

  /**
   * 按当前运行态读取Human验证状态会话有效期Ms；从 `configService.get` 读取Human验证状态会话有效期Ms。
   * @returns Human验证状态会话有效期Ms。
   */
  private getHumanVerificationSessionTtlMs() {
    const configured = Number(
      this.configService.get('NAPCAT_LOGIN_HUMAN_VERIFY_EXPIRE_MS') ||
        15 * 60 * 1000,
    );
    const fallback = 15 * 60 * 1000;
    const ttl =
      (() => {
        if (Number.isFinite(configured) && configured > 0) {
          return configured;
        }
        return fallback;
      })();
    return Math.max(ttl, this.getSessionTtlMs());
  }

  /**
   * 按`session`读取会话Renewal有效期Ms；当 `session.captchaUrl || session.deviceVerifyUrl || session.newD…` 成立时返回 `this.getHumanVerificationSessionTtlMs()`。
   * @param session - 待读取、续期或持久化的会话Renewal有效期Ms会话。
   * @returns 会话Renewal有效期Ms。
   */
  private getSessionRenewalTtlMs(session: BotLoginScanSession) {
    if (
      session.captchaUrl ||
      session.deviceVerifyUrl ||
      session.newDeviceQrcode ||
      session.newDeviceStatus
    ) {
      return this.getHumanVerificationSessionTtlMs();
    }
    return this.getSessionTtlMs();
  }

  /**
   * 根据`session`处理renew会话Expiry；从 `getSessionRenewalTtlMs` 读取renew会话Expiry。
   * @param session - 待读取、续期或持久化的renew会话Expiry会话。
   */
  private renewSessionExpiry(session: BotLoginScanSession) {
    session.expiresAt = Date.now() + this.getSessionRenewalTtlMs(session);
  }

  /**
   * 按当前运行态读取超时；从 `configService.get` 读取超时。
   * @returns 超时。
   */
  private getTimeout() {
    return Number(this.configService.get('NAPCAT_WEBUI_TIMEOUT_MS') || 8000);
  }

  /**
   * 按当前运行态读取延迟时长Ms；从 `configService.get` 读取延迟时长Ms。
   * @returns 延迟时长Ms。
   */
  private getRestartDelayMs() {
    return Number(
      this.configService.get('NAPCAT_WEBUI_RESTART_DELAY_MS') || 3000,
    );
  }

  /**
   * 根据`container`、`sinceMs`计算并预留密码Login状态；等待超过配置上限时拒绝，否则延迟到可用时间；当 `this.toolsService.isNapcatCaptchaRequiredMessage(errorMessage)` 成立时返回 `{ captchaUrl: await this.detectPasswordCapt…`。
   * @param container - 要检查、重启或更新登录状态的 NapCat 容器。
   * @param sinceMs - 用于密码Login状态超时、有效期或退避计算的毫秒数；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 密码Login状态。
   * @throws 当 `getLoginStatus` 调用失败时重新抛出该入口捕获且决定公开的原异常。
   */
  private async waitForPasswordLoginStatus(
    container: NapcatRuntime,
    sinceMs?: number,
  ) {
    let latestStatus: NapcatLoginStatus = { isLogin: false };
    const attempts = this.getLoginPollAttempts(
      this.getPasswordLoginWaitMs(),
      this.getLoginPollIntervalMs(),
    );
    for (let index = 0; index < attempts; index += 1) {
      if (index > 0) {
        await this.toolsService.sleep(this.getLoginPollIntervalMs());
      }
      try {
        latestStatus = await this.getLoginStatus(container, true);
      } catch (err) {
        const errorMessage = this.toolsService.getErrorMessage(err);
        if (this.toolsService.isNapcatCaptchaRequiredMessage(errorMessage)) {
          return {
            captchaUrl: await this.detectPasswordCaptchaUrl(container, sinceMs),
            isLogin: false,
            loginError: errorMessage,
          };
        }
        throw err;
      }
      const qrcodeChallenge = this.isPasswordQrcodeChallenge(latestStatus);
      const captchaRequired = this.toolsService.isNapcatCaptchaRequiredMessage(
        latestStatus.loginError,
      );
      const hasRestartTimestamp =
        typeof sinceMs === 'number' && Number.isFinite(sinceMs);
      if (
        !latestStatus.isLogin &&
        !qrcodeChallenge &&
        (hasRestartTimestamp || captchaRequired)
      ) {
        latestStatus.captchaUrl =
          this.getCaptchaUrlFromStatus(latestStatus) ||
          (await this.detectPasswordCaptchaUrl(
            container,
            sinceMs,
            captchaRequired,
          ));
      }
      if (latestStatus.isLogin || qrcodeChallenge || captchaRequired) {
        if (!this.getCaptchaUrlFromStatus(latestStatus) && captchaRequired) {
          latestStatus.captchaUrl = await this.detectPasswordCaptchaUrl(
            container,
            sinceMs,
            true,
          );
        }
        return latestStatus;
      }
      if (latestStatus.captchaUrl) return latestStatus;
    }
    return latestStatus;
  }

  /**
   * 通过 `Math.max` 收敛数值边界。
   * @param waitMs - 用于Login轮询Attempts超时、有效期或退避计算的毫秒数。
   * @param intervalMs - 用于Login轮询Attempts超时、有效期或退避计算的毫秒数。
   * @returns Login轮询Attempts。
   */
  private getLoginPollAttempts(waitMs: number, intervalMs: number) {
    const normalizedWaitMs = (() => {
      if (Number.isFinite(waitMs) && waitMs > 0) {
        return waitMs;
      }
      return 1;
    })();
    const normalizedIntervalMs =
      (() => {
        if (Number.isFinite(intervalMs) && intervalMs > 0) {
          return intervalMs;
        }
        return 1;
      })();
    return Math.max(1, Math.ceil(normalizedWaitMs / normalizedIntervalMs));
  }

  /**
   * 按当前运行态读取密码LoginMs；从 `getPositiveConfigNumber` 读取密码LoginMs。
   * @returns 密码LoginMs。
   */
  private getPasswordLoginWaitMs() {
    return this.getPositiveConfigNumber(
      'NAPCAT_PASSWORD_LOGIN_WAIT_MS',
      120_000,
    );
  }

  /**
   * 根据当前领域状态，查询 NapCat 快速登录结果的等待窗口。
   * @returns WebUI SetQuickLogin 后最多等待 QQ 登录态变化的毫秒数。
   */
  private getQuickLoginWaitMs() {
    return this.getPositiveConfigNumber(
      'NAPCAT_QUICK_LOGIN_WAIT_MS',
      15_000,
    );
  }

  /**
   * 按当前运行态读取Login轮询间隔Ms；从 `getPositiveConfigNumber` 读取Login轮询间隔Ms。
   * @returns Login轮询间隔Ms。
   */
  private getLoginPollIntervalMs() {
    return this.getPositiveConfigNumber(
      'NAPCAT_LOGIN_POLL_INTERVAL_MS',
      3000,
    );
  }

  /**
   * 按`key`、`fallback`读取Positive配置数值；当 `Number.isFinite(value) && value > 0` 成立时返回 `value`。
   * @param key - 用于读取或更新Positive配置数值的稳定键。
   * @param fallback - 主值缺失、为空或不合法时采用的兜底结果。
   * @returns Positive配置数值。
   */
  private getPositiveConfigNumber(key: string, fallback: number) {
    const value = Number(this.configService.get(key) || fallback);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
    return fallback;
  }

  /**
   * 执行 NapCat 请求回调；关闭重试时只调用一次，开启时仅对临时错误按配置次数重试并等待固定间隔；从 `configService.get` 读取NapCat。
   * @param retry - 是否对 NapCat 临时错误启用有次数上限的重试。
   * @param action - 发起一次 NapCat 请求并返回其业务结果的异步回调。
   * @returns 首次成功执行的请求结果；非临时错误或重试耗尽时不会返回，而是抛出最后一次异常。
   * @throws 当前函数此前所有接受或成功分支均未返回时拒绝当前输入并抛出 `lastError`。
   */
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
