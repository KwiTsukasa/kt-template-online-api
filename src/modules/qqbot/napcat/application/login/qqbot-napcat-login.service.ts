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
  QqbotLoginCaptchaSubmitInput,
  QqbotLoginScanMode,
  QqbotLoginScanEvent,
  QqbotLoginScanResult,
  QqbotLoginScanSession,
  QqbotLoginScanStatus,
  QqbotNapcatRuntime,
  QrcodeLookupOptions,
  QrcodeRefreshOptions,
} from '@/modules/qqbot/core/contract/qqbot.types';
import { QqbotAccountService } from '@/modules/qqbot/core/application/account/qqbot-account.service';
import { NapcatLoginStateStoreService } from '../../infrastructure/persistence/napcat-login-state-store.service';
import { QqbotNapcatContainerService } from '../../infrastructure/integration/container/qqbot-napcat-container.service';

@Injectable()
export class QqbotNapcatLoginService {
  private readonly fallbackLoginSessionStore =
    new NapcatLoginStateStoreService();
  private readonly sessionEventLogCache: Record<string, QqbotLoginScanEvent[]> =
    {};
  private readonly sessionEventListenerCache: Record<
    string,
    Set<(event: QqbotLoginScanEvent) => void>
  > = {};
  private readonly refreshStartTasks: Record<
    string,
    Promise<QqbotLoginScanResult> | undefined
  > = {};
  readonly sessions = {
    /**
     * 清理 NapCat回调状态。
     */
    clear: () => this.loginSessionStore.clear(),
    /**
     * 读取 NapCat回调数据。
     * @param sessionId - NapCat ID；定位本次读取、更新、删除或关联的NapCat。
     */
    get: (sessionId: string) => this.loginSessionStore.getCached(sessionId),
    /**
     * 判断 NapCat回调条件。
     * @param sessionId - NapCat ID；定位本次读取、更新、删除或关联的NapCat。
     */
    has: (sessionId: string) => this.loginSessionStore.has(sessionId),
    /**
     * 写入 NapCat回调数据。
     * @param sessionId - NapCat ID；定位本次读取、更新、删除或关联的NapCat。
     * @param session - session 输入；使用 `id` 字段生成结果。
     */
    set: (sessionId: string, session: QqbotLoginScanSession) => {
      if (!session.id) session.id = sessionId;
      this.loginSessionStore.set(session);
    },
  };
  readonly sessionEventLogs = {
    /**
     * 清理 NapCat回调状态。
     */
    clear: () =>
      Object.keys(this.sessionEventLogCache).forEach((sessionId) => {
        delete this.sessionEventLogCache[sessionId];
      }),
    /**
     * 读取 NapCat回调数据。
     * @param sessionId - NapCat ID；定位本次读取、更新、删除或关联的NapCat。
     */
    get: (sessionId: string) => this.sessionEventLogCache[sessionId],
  };
  readonly sessionEventListeners = {
    /**
     * 清理 NapCat回调状态。
     */
    clear: () =>
      Object.keys(this.sessionEventListenerCache).forEach((sessionId) => {
        delete this.sessionEventListenerCache[sessionId];
      }),
  };
  private readonly webuiClient = new NapcatWebuiHttpClient({
    /**
     * 读取 NapCat回调数据。
     */
    getTimeoutMs: () => this.getTimeout(),
  });

  /**
   * 初始化 QqbotNapcatLoginService 实例。
   * @param configService - Nest ConfigService 依赖；影响 constructor 的返回值。
   * @param accountService - accountService 服务依赖；影响 constructor 的返回值。
   * @param containerService - containerService 服务依赖；影响 constructor 的返回值。
   * @param toolsService - ToolsService 依赖；影响 constructor 的返回值。
   * @param loginStateStore - loginStateStore 输入；影响 constructor 的返回值。
   */
  constructor(
    private readonly configService: ConfigService,
    private readonly accountService: QqbotAccountService,
    private readonly containerService: QqbotNapcatContainerService,
    private readonly toolsService: ToolsService,
    @Optional()
    private readonly loginStateStore?: NapcatLoginStateStoreService,
  ) {}

  /**
   * 执行 NapCat 登录运行态流程。
   */
  private get loginSessionStore() {
    return this.loginStateStore || this.fallbackLoginSessionStore;
  }

  /**
   * 启动Create。
   */
  async startCreate() {
    const container = await this.containerService.prepareCreateContainer();
    return this.startScan({ mode: 'create' }, container);
  }

  /**
   * 启动Refresh。
   * @param accountId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   */
  async startRefresh(accountId: string) {
    const activeSession = this.findActiveRefreshSession(accountId);
    if (activeSession) return this.toResult(activeSession);

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
   * 启动账号更新登录会话。
   * @param accountId - 账号 ID；定位账号、主容器和可选登录密码。
   * @returns 创建后的扫码/更新登录会话快照。
   */
  private async createRefreshScan(accountId: string) {
    const account =
      await this.accountService.findByIdWithNapcatLoginSecret(accountId);
    if (!account) {
      throwVbenError('QQBot 账号不存在');
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
      loginPassword?: string;
      mode: 'refresh';
      sourceContainerOnline?: boolean;
    } = {
      accountId: account.id,
      expectedSelfId: account.selfId,
      forceRelogin: true,
      hasExistingPrimaryBinding: container.hasExistingPrimaryBinding,
      loginPassword,
      mode: 'refresh',
    };
    if (container.sourceContainerOnline !== undefined) {
      scanOptions.sourceContainerOnline = container.sourceContainerOnline;
    }

    return this.startScan(scanOptions, container);
  }

  /**
   * 查找可复用的账号更新登录会话。
   * @param accountId - 账号 ID；限定同一账号的 pending refresh 会话。
   * @returns 当前仍有效的 pending refresh 会话；没有时返回 undefined。
   */
  private findActiveRefreshSession(accountId: string) {
    const now = Date.now();
    let activeSession: QqbotLoginScanSession | undefined;
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
   * 执行 NapCat 登录运行态流程。
   * @param sessionId - NapCat ID；定位本次读取、更新、删除或关联的NapCat。
   */
  async refreshQrcode(sessionId: string) {
    const session = await this.getSession(sessionId);
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
      return this.keepSessionPending(
        session,
        'NapCat 通信超时，请稍后重试或确认运行容器仍在线',
        true,
      );
    }

    if (loginStatus.isOffline && session.mode !== 'refresh') {
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
   * 执行 NapCat 登录运行态流程。
   * @param sessionId - NapCat ID；定位本次读取、更新、删除或关联的NapCat。
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
      return this.expireSession(session);
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
      this.persistLoginSession(session);
      return this.toResult(session);
    }

    return this.completeLogin(session, container);
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param sessionId - NapCat ID；定位本次读取、更新、删除或关联的NapCat。
   * @param input - input 输入；使用 `ticket`、`randstr`、`sid` 字段生成结果。
   */
  async submitCaptcha(sessionId: string, input: QqbotLoginCaptchaSubmitInput) {
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
   * 执行 NapCat 登录运行态流程。
   * @param sessionId - NapCat ID；定位本次读取、更新、删除或关联的NapCat。
   */
  events(sessionId: string) {
    if (!this.loginSessionStore.getCached(sessionId)) {
      void this.loginSessionStore.get(sessionId);
    }
    return new Observable<{ data: QqbotLoginScanEvent }>((subscriber) => {
      /**
       * 监听 NapCat 登录运行态事件。
       * @param event - event 输入；限定 NapCat查询范围。
       */
      const listener = (event: QqbotLoginScanEvent) => {
        subscriber.next({ data: event });
      };
      const replayEvents = this.sessionEventLogCache[sessionId] || [];
      replayEvents.forEach(listener);
      const listeners =
        this.sessionEventListenerCache[sessionId] ||
        new Set<(event: QqbotLoginScanEvent) => void>();
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
   * 判断 NapCat 登录运行态条件。
   * @param sessionId - NapCat ID；定位本次读取、更新、删除或关联的NapCat。
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
      await this.cleanupSessionContainer(session);
      this.cleanupSessionEvents(sessionId);
    }
    return true;
  }

  /**
   * 启动Scan。
   * @param options - NapCat列表；使用 `forceRelogin`、`loginPassword`、`hasExistingPrimaryBinding` 字段生成结果。
   * @param container - NapCat WebUI 运行态；refresh 模式只通过 WebUI 登录接口推进状态。
   * @returns 异步完成后的 NapCat 登录运行态结果。
   */
  private async startScan(
    options: {
      accountId?: string;
      expectedSelfId?: string;
      forceRelogin?: boolean;
      hasExistingPrimaryBinding?: boolean;
      loginPassword?: string;
      mode: QqbotLoginScanMode;
      sourceContainerOnline?: boolean;
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
      void reloginTask;
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
   * 执行 NapCat 登录运行态流程。
   * @param session - session 输入；使用 `expectedSelfId`、`accountId`、`containerId`、`captchaUrl` 字段生成结果。
   * @param container - container 输入；驱动 `this.getLoginInfo()` 的 NapCat步骤。
   * @param options - NapCat列表；使用 `loginInfo`、`successMessage` 字段生成结果。
   * @returns 异步完成后的 NapCat 登录运行态结果。
   */
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
   * 创建 NapCat 登录运行态对象或配置。
   * @param input - input 输入；使用 `accountId`、`container`、`expectedSelfId`、`mode` 字段生成结果。
   * @returns 创建后的 NapCat 登录运行态对象或配置。
   */
  private createSession(input: {
    accountId?: string;
    container: QqbotNapcatRuntime;
    expectedSelfId?: string;
    mode: QqbotLoginScanMode;
    preparingRelogin?: boolean;
    qrcode?: string;
    runtimeRebuildCount?: number;
    sourceContainerOnline?: boolean;
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
      runtimeRebuildCount:
        input.runtimeRebuildCount ?? input.container.runtimeRebuildCount,
      sourceContainerOnline:
        input.sourceContainerOnline ?? input.container.sourceContainerOnline,
      status: input.status,
      webuiPort: input.container.webuiPort,
    };
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param session - session 输入；使用 `accountId`、`captchaUrl`、`containerId`、`containerName` 字段生成结果。
   * @returns NapCat 登录运行态产出的 QqbotLoginScanResult。
   */
  private toResult(session: QqbotLoginScanSession): QqbotLoginScanResult {
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
   * 启动New Device Verification。
   * @param session - session 输入；使用 `status`、`captchaUrl`、`qrcode`、`deviceVerifyUrl` 字段生成结果。
   * @param container - container 输入；驱动 `this.postNapcat()`、`this.refreshNewDeviceQrcode()` 的 NapCat步骤。
   * @param captchaResult - captchaResult 输入；使用 `jumpUrl`、`newDevicePullQrCodeSig` 字段生成结果。
   */
  private async startNewDeviceVerification(
    session: QqbotLoginScanSession,
    container: QqbotNapcatRuntime,
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
        /**
         * 发送 NapCat回调消息。
         * @param path - 路由或文件路径；驱动 `this.postNapcat()` 的 NapCat步骤。
         * @param body - 请求体 DTO；承载 NapCat新增、更新、导入或执行字段。
         */
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
   * 轮询New Device Verification。
   * @param session - session 输入；使用 `newDeviceBytesToken`、`expectedSelfId`、`newDevicePullQrCodeSig`、`newDeviceQrcode` 字段生成结果。
   * @param container - container 输入；驱动 `this.postNapcat()`、`this.refreshNewDeviceQrcode()`、`this.failNewDeviceVerification()`、`this.startNewDeviceVerification()` 的 NapCat步骤。
   */
  private async pollNewDeviceVerification(
    session: QqbotLoginScanSession,
    container: QqbotNapcatRuntime,
  ) {
    const client = new NapcatLoginApiClient({
      /**
       * 发送 NapCat回调消息。
       * @param path - 路由或文件路径；驱动 `this.postNapcat()` 的 NapCat步骤。
       * @param body - 请求体 DTO；承载 NapCat新增、更新、导入或执行字段。
       */
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
   * 解析New Device Password Md5。
   * @param session - session 输入；使用 `passwordMd5`、`accountId` 字段生成结果。
   */
  private async resolveNewDevicePasswordMd5(session: QqbotLoginScanSession) {
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
   * 执行 NapCat 登录运行态流程。
   * @param session - session 输入；驱动 `this.getNewDeviceQrRequest()`、`this.failNewDeviceVerification()`、`this.applyNewDeviceQrcode()`、`this.persistLoginSession()` 的 NapCat步骤。
   * @param container - container 输入；驱动 `this.failNewDeviceVerification()` 的 NapCat步骤。
   * @param client - client 输入；执行 `client.getNewDeviceQRCode()` 对应的 NapCat步骤。
   */
  private async refreshNewDeviceQrcode(
    session: QqbotLoginScanSession,
    container: QqbotNapcatRuntime,
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
   * 执行 NapCat 登录运行态流程。
   * @param session - session 输入；使用 `newDeviceQrcode`、`newDeviceBytesToken`、`deviceVerifyUrl`、`newDevicePullQrCodeSig` 字段生成结果。
   * @param qrcode - qrcode 输入；使用 `qrcodeUrl`、`bytesToken`、`deviceVerifyUrl`、`pullQrCodeSig` 字段生成结果。
   */
  private applyNewDeviceQrcode(
    session: QqbotLoginScanSession,
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
   * 查询 NapCat 登录运行态数据。
   * @param session - session 输入；使用 `expectedSelfId`、`deviceVerifyUrl` 字段生成结果。
   * @returns NapCat 登录运行态查询结果。
   */
  private getNewDeviceQrRequest(
    session: QqbotLoginScanSession,
  ): NewDeviceQrRequest | null {
    const uin = this.toolsService.toTrimmedString(session.expectedSelfId);
    const jumpUrl = this.toolsService.toTrimmedString(session.deviceVerifyUrl);
    if (!uin || !jumpUrl) return null;
    return { jumpUrl, uin };
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param value - 待转换值；驱动 `toolsService.toTrimmedString()` 的 NapCat步骤。
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
   * 判断 NapCat 登录运行态条件。
   * @param session - session 输入；使用 `newDevicePullQrCodeSig` 字段计算判断结果。
   */
  private hasNewDevicePullQrCodeSig(session: QqbotLoginScanSession) {
    return (
      this.pickNewDevicePullQrCodeSig(session.newDevicePullQrCodeSig) !==
      undefined
    );
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param session - session 输入；使用 `newDeviceStatus`、`errorMessage`、`status`、`captchaUrl` 字段生成结果。
   * @param status - NapCat列表；影响 keepNewDevicePending 的返回值。
   * @param message - message 输入；驱动 `this.publishScanResultEvent()` 的 NapCat步骤。
   * @param step - step 输入；驱动 `this.publishScanResultEvent()` 的 NapCat步骤。
   */
  private keepNewDevicePending(
    session: QqbotLoginScanSession,
    status: NonNullable<QqbotLoginScanSession['newDeviceStatus']>,
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
   * 执行 NapCat 登录运行态流程。
   * @param session - session 输入；使用 `newDeviceQrcode`、`newDeviceBytesToken`、`newDeviceStatus`、`errorMessage` 字段生成结果。
   * @param container - container 输入；驱动 `this.failCaptchaLogin()` 的 NapCat步骤。
   * @param message - message 输入；驱动 `this.failCaptchaLogin()` 的 NapCat步骤。
   */
  private async failNewDeviceVerification(
    session: QqbotLoginScanSession,
    container: QqbotNapcatRuntime,
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
   * 执行 NapCat 登录运行态流程。
   * @param session - session 输入；使用 `expectedSelfId` 字段生成结果。
   * @param container - container 输入；驱动 `this.waitForPasswordLoginStatus()`、`this.failCaptchaLogin()`、`this.getLoginInfo()` 的 NapCat步骤。
   * @param successMessage - successMessage 输入；影响 completePasswordLoginAfterChallenge 的返回值。
   */
  private async completePasswordLoginAfterChallenge(
    session: QqbotLoginScanSession,
    container: QqbotNapcatRuntime,
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
        loginInfo.online === false
          ? 'NapCat 当前账号已离线'
          : 'NapCat 未返回 QQ 号',
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
   * 投递 NapCat 登录运行态消息或任务。
   * @param session - session 输入；使用 `id` 字段生成结果。
   * @param input - input 输入；影响 publishScanEvent 的返回值。
   */
  private publishScanEvent(
    session: QqbotLoginScanSession,
    input: Omit<QqbotLoginScanEvent, 'createdAt'>,
  ) {
    const event: QqbotLoginScanEvent = {
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
   * 投递 NapCat 登录运行态消息或任务。
   * @param session - session 输入；使用 `status`、`expiresAt` 字段生成结果。
   * @param step - step 输入；驱动 `this.toResult()` 的 NapCat步骤。
   * @param status - NapCat列表；驱动 `this.toResult()` 的 NapCat步骤。
   * @param message - message 输入；影响 publishScanResultEvent 的返回值。
   */
  private publishScanResultEvent(
    session: QqbotLoginScanSession,
    step: string,
    status: QqbotLoginScanEvent['status'],
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
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param sessionId - NapCat ID；定位本次读取、更新、删除或关联的NapCat。
   * @param listener - listener 输入；影响 emitCurrentSessionSnapshot 的返回值。
   */
  private async emitCurrentSessionSnapshot(
    sessionId: string,
    listener: (event: QqbotLoginScanEvent) => void,
  ) {
    const session = await this.loginSessionStore.get(sessionId);
    if (!session) return;
    listener(this.toSessionSnapshotEvent(session));
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param session - session 输入；驱动 `Date.now()` 的 NapCat步骤。
   * @returns NapCat 登录运行态产出的 QqbotLoginScanEvent。
   */
  private toSessionSnapshotEvent(
    session: QqbotLoginScanSession,
  ): QqbotLoginScanEvent {
    return {
      createdAt: Date.now(),
      message: this.getSessionSnapshotMessage(session),
      result: this.toResult(session),
      status: this.getSessionSnapshotStatus(session),
      step: this.getSessionSnapshotStep(session),
    };
  }

  /**
   * 查询 NapCat 登录运行态数据。
   * @param session - session 输入；使用 `status` 字段生成结果。
   * @returns NapCat 登录运行态查询结果。
   */
  private getSessionSnapshotStatus(
    session: QqbotLoginScanSession,
  ): QqbotLoginScanEvent['status'] {
    if (session.status === 'success') return 'success';
    if (session.status === 'error' || session.status === 'expired') {
      return 'error';
    }
    return 'processing';
  }

  /**
   * 查询 NapCat 登录运行态数据。
   * @param session - session 输入；使用 `status`、`newDeviceStatus`、`captchaUrl`、`qrcode` 字段生成结果。
   */
  private getSessionSnapshotStep(session: QqbotLoginScanSession) {
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
    if (session.passwordMd5) return 'password-login';
    return 'scan-status';
  }

  /**
   * 查询 NapCat 登录运行态数据。
   * @param session - session 输入；使用 `errorMessage`、`status`、`newDeviceStatus`、`captchaUrl` 字段生成结果。
   */
  private getSessionSnapshotMessage(session: QqbotLoginScanSession) {
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
    return '登录处理中';
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param session - session 输入；使用 `preparingRelogin`、`errorMessage` 字段生成结果。
   */
  private recoverStaleReloginPreparation(session: QqbotLoginScanSession) {
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
   * 判断 NapCat 登录运行态条件。
   * @param session - session 输入；使用 `preparingRelogin`、`lastRestartedAt` 字段计算判断结果。
   */
  private isStaleReloginPreparation(session: QqbotLoginScanSession) {
    if (!session.preparingRelogin || !session.lastRestartedAt) return false;
    return (
      Date.now() - session.lastRestartedAt > this.getReloginPreparationStaleMs()
    );
  }

  /**
   * 查询 NapCat 登录运行态数据。
   */
  private getReloginPreparationStaleMs() {
    return this.getPositiveConfigNumber(
      'QQBOT_NAPCAT_RELOGIN_PREPARING_STALE_MS',
      this.getPasswordLoginWaitMs() +
        Math.max(this.getRestartDelayMs(), this.getTimeout()) +
        this.getLoginPollIntervalMs() * 2,
    );
  }

  /**
   * 清理 NapCat 登录运行态状态。
   * @param sessionId - NapCat ID；定位本次读取、更新、删除或关联的NapCat。
   */
  private cleanupSessionEvents(sessionId: string) {
    delete this.sessionEventLogCache[sessionId];
    delete this.sessionEventListenerCache[sessionId];
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param session - session 输入；使用 `status`、`errorMessage`、`expiresAt`、`qrcode` 字段生成结果。
   * @param errorMessage - errorMessage 输入；影响 keepSessionPending 的返回值。
   * @param clearQrcode - clearQrcode 输入；决定 NapCat条件分支。
   */
  private keepSessionPending(
    session: QqbotLoginScanSession,
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
   * 执行 NapCat 登录运行态流程。
   * @param session - session 输入；使用 `captchaUrl`、`errorMessage`、`status`、`preparingRelogin` 字段生成结果。
   * @param captchaUrl - 访问地址；影响 keepPasswordCaptchaPending 的返回值。
   * @param reason - reason 输入；驱动 `toolsService.isNapcatCaptchaRequiredMessage()` 的 NapCat步骤。
   */
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
   * 执行 NapCat 登录运行态流程。
   * @param session - session 输入；使用 `errorMessage`、`status`、`captchaUrl`、`preparingRelogin` 字段生成结果。
   * @param reason - reason 输入；驱动 `toolsService.toTrimmedString()` 的 NapCat步骤。
   */
  private keepPasswordCaptchaWaitingForUrl(
    session: QqbotLoginScanSession,
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
   * 执行 NapCat 登录运行态流程。
   * @param session - session 输入；使用 `expectedSelfId`、`status`、`captchaUrl`、`errorMessage` 字段生成结果。
   * @param container - container 输入；驱动 `this.cleanupPasswordLoginContext()` 的 NapCat步骤。
   * @param errorMessage - errorMessage 输入；影响 failCaptchaLogin 的返回值。
   */
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
   * 清理 NapCat 登录运行态状态。
   * @param session - session 输入；使用 `passwordMd5`、`captchaUrl`、`status`、`expectedSelfId` 字段生成结果。
   * @param container - container 输入；影响 cleanupPasswordLoginContext 的返回值。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   * @param cleanupFailureMessage - cleanupFailureMessage 输入；影响 cleanupPasswordLoginContext 的返回值。
   */
  private async cleanupPasswordLoginContext(
    session: QqbotLoginScanSession,
    container?: QqbotNapcatRuntime,
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
   * 保存 NapCat 登录运行态数据。
   * @param session - session 输入；驱动 `loginSessionStore.set()`、`this.persistLoginChallenge()` 的 NapCat步骤。
   */
  private persistLoginSession(session: QqbotLoginScanSession) {
    this.loginSessionStore.set(session);
    this.persistLoginChallenge(session);
  }

  /**
   * 保存 NapCat 登录运行态数据。
   * @param session - session 输入；驱动 `loginSessionStore.recordCaptchaChallenge()`、`loginSessionStore.recordNewDeviceChallenge()` 的 NapCat步骤。
   */
  private persistLoginChallenge(session: QqbotLoginScanSession) {
    this.loginSessionStore.recordCaptchaChallenge(session);
    this.loginSessionStore.recordNewDeviceChallenge(session);
  }

  /**
   * 查询 NapCat 登录运行态数据。
   * @param sessionId - NapCat ID；定位本次读取、更新、删除或关联的NapCat。
   */
  private async getSession(sessionId: string) {
    const session = await this.loginSessionStore.get(sessionId);
    if (!session) {
      throwVbenError('扫码会话不存在或已过期');
    }
    return session;
  }

  /**
   * 查询 NapCat 登录运行态数据。
   * @param session - session 输入；使用 `containerId` 字段生成结果。
   */
  private async getSessionContainer(session: QqbotLoginScanSession) {
    return this.containerService.findRuntimeById(session.containerId);
  }

  /**
   * 清理 NapCat 登录运行态状态。
   */
  private async cleanupSessions() {
    const now = Date.now();
    const expiredSessions: QqbotLoginScanSession[] = [];
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
   * 执行 NapCat 登录运行态流程。
   * @param session - session 输入；使用 `status`、`errorMessage`、`id` 字段生成结果。
   */
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
    this.loginSessionStore.delete(session.id);
    await this.closeSession(session);
    return this.toResult(session);
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param session - session 输入；使用 `status`、`captchaUrl`、`errorMessage`、`passwordMd5` 字段生成结果。
   * @param errorMessage - errorMessage 输入；驱动 `this.publishScanResultEvent()` 的 NapCat步骤。
   */
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
    this.loginSessionStore.delete(session.id);
    await this.closeSession(session);
    return this.toResult(session);
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param session - session 输入；使用 `id` 字段生成结果。
   */
  private async closeSession(session: QqbotLoginScanSession) {
    await this.cleanupPasswordLoginContext(session);
    await this.cleanupSessionContainer(session);
    this.loginSessionStore.delete(session.id);
    this.cleanupSessionEvents(session.id);
  }

  /**
   * 清理 NapCat 登录运行态状态。
   * @param session - session 输入；使用 `containerId`、`containerName`、`webuiPort`、`errorMessage` 字段生成结果。
   */
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

  /**
   * 执行 NapCat 登录运行态流程。
   * @param container - container 输入；驱动 `this.getQrcode()` 的 NapCat步骤。
   * @param session - session 输入；使用 `qrcode`、`errorMessage` 字段生成结果。
   * @param status - NapCat列表；使用 `qrcodeurl`、`loginError` 字段生成结果。
   */
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

  /**
   * 清理 NapCat 登录运行态状态。
   * @param container - container 输入；使用 `id` 字段生成结果。
   */
  private async cleanupRuntimeContainer(container: QqbotNapcatRuntime) {
    try {
      await this.containerService.removeUnboundContainer(container.id);
      return null;
    } catch (err) {
      return this.toolsService.getErrorMessage(err);
    }
  }

  /**
   * 查询 NapCat 登录运行态数据。
   * @param container - container 输入；驱动 `this.normalizeLoginStatus()` 的 NapCat步骤。
   * @param retry - retry 输入；决定 NapCat条件分支。
   */
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

  /**
   * 转换 NapCat 登录运行态输入。
   * @param container - container 输入；驱动 `this.getLoginInfo()` 的 NapCat步骤。
   * @param status - NapCat列表；使用 `isLogin` 字段生成结果。
   */
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

  /**
   * 执行 NapCat 登录运行态流程。
   * @param status - NapCat列表；使用 `loginError` 字段生成结果。
   * @param errorMessage - errorMessage 输入；影响 toOfflineLoginStatus 的返回值。
   * @returns NapCat 登录运行态产出的 NapcatLoginStatus。
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
   * 查询 NapCat 登录运行态数据。
   * @param container - container 输入；限定 NapCat查询范围。
   */
  private async getLoginInfo(container: QqbotNapcatRuntime) {
    return this.postNapcat<NapcatLoginInfo>(
      container,
      '/api/QQLogin/GetQQLoginInfo',
    );
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param container - container 输入；影响 callRefreshQrcode 的返回值。
   * @param retry - retry 输入；驱动 `this.executeNapcatRequest()` 的 NapCat步骤。
   */
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

  /**
   * 查询 NapCat 登录运行态数据。
   * @param container - container 输入；驱动 `this.getQrcodeFromStatus()`、`this.getLoginStatus()` 的 NapCat步骤。
   * @param retry - retry 输入；驱动 `this.executeNapcatRequest()` 的 NapCat步骤。
   * @param options - NapCat列表；驱动 `this.getQrcodeFromStatus()`、`toolsService.ensureFreshQrcode()` 的 NapCat步骤。
   */
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

  /**
   * 执行 NapCat 登录运行态流程。
   * @param container - NapCat WebUI 运行态；只用于调用二维码刷新/获取接口。
   * @param retry - retry 输入；驱动 `this.callRefreshQrcode()`、`this.getQrcode()` 的 NapCat步骤。
   * @param options - NapCat列表；使用 `fallbackStatus`、`requireFresh`、`staleQrcode` 字段生成结果。
   */
  private async refreshOrGetQrcode(
    container: QqbotNapcatRuntime,
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
   * 查询 NapCat 登录运行态数据。
   * @param container - container 输入；驱动 `this.getLoginStatus()` 的 NapCat步骤。
   * @param options - NapCat列表；使用 `requireFresh` 字段生成结果。
   */
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

  /**
   * 执行 NapCat 登录运行态流程。
   * @param container - container 输入；影响 postNapcat 的返回值。
   * @param path - 路由或文件路径；影响 postNapcat 的返回值。
   * @param body - 请求体 DTO；承载 NapCat新增、更新、导入或执行字段。
   */
  private async postNapcat<T>(
    container: QqbotNapcatRuntime,
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
   * 执行 NapCat 登录运行态流程。
   * @param session - 更新登录会话；保存 WebUI 登录尝试、二维码和人工验证状态。
   * @param container - NapCat WebUI 运行态；所有刷新动作都通过 WebUI 登录接口完成。
   * @param loginPassword - loginPassword 输入；驱动 `toolsService.toSecretText()` 的 NapCat步骤。
   * @param hasExistingPrimaryBinding - hasExistingPrimaryBinding 输入；决定 NapCat条件分支。
   */
  private async prepareReloginQrcode(
    session: QqbotLoginScanSession,
    container: QqbotNapcatRuntime,
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

      const passwordLoginCompleted = await this.tryPasswordRelogin(
        session,
        container,
        password,
      );
      if (passwordLoginCompleted) return;

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
   * 处理源运行容器仍在线的更新登录流程。
   * @param session - 更新登录会话；若当前容器已经登录目标账号则直接完成。
   * @param container - NapCat 运行态；用于只读检查当前 QQ 登录态。
   * @returns 当前容器已登录目标账号并完成会话时返回 true，否则返回 false 继续 WebUI 登录流程。
   */
  private async completeOnlineSourceRefresh(
    session: QqbotLoginScanSession,
    container: QqbotNapcatRuntime,
  ) {
    const loginStatus = await this.getLoginStatus(container, true);
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
   * 执行 NapCat 登录运行态流程。
   * @param session - 更新登录会话；提供目标 QQ 号并保存 quick 登录进度。
   * @param container - NapCat WebUI 运行态；接收 SetQuickLogin 并返回登录状态。
   * @param hasPasswordFallback - hasPasswordFallback 输入；驱动 `this.publishQuickLoginFallback()` 的 NapCat步骤。
   */
  private async tryQuickRelogin(
    session: QqbotLoginScanSession,
    container: QqbotNapcatRuntime,
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
   * 执行 NapCat 登录运行态流程。
   * @param session - 更新登录会话；保存密码 MD5、验证码和新设备验证上下文。
   * @param container - NapCat WebUI 运行态；接收 PasswordLogin 并返回后续人工验证要求。
   * @param loginPassword - 解密后的 QQ 密码明文；只用于本次 WebUI PasswordLogin 的 MD5 计算。
   */
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
      this.publishPasswordLoginFallback(
        session,
        errorMessage,
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
   * 轮询 NapCat WebUI 快速登录后的 QQ 登录态。
   * @param container - NapCat WebUI 运行态；用于调用 CheckLoginStatus。
   * @returns 最早出现的成功、失败或可继续二维码状态。
   */
  private async waitForQuickLoginStatus(container: QqbotNapcatRuntime) {
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
    session: QqbotLoginScanSession,
    container: QqbotNapcatRuntime,
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
    const captchaUrl = await this.waitForPasswordCaptchaUrl(
      container,
      sinceMs,
    );
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
   * 执行 NapCat 登录运行态流程。
   * @param session - session 输入；使用 `expectedSelfId`、`qrcode`、`captchaUrl`、`errorMessage` 字段生成结果。
   * @param container - container 输入；驱动 `this.refreshOrGetQrcode()` 的 NapCat步骤。
   * @param loginStatus - NapCat列表；使用 `qrcodeurl` 字段生成结果。
   */
  private async keepPasswordQrcodePending(
    session: QqbotLoginScanSession,
    container: QqbotNapcatRuntime,
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
   * 解析Password Captcha Url。
   * @param container - container 输入；驱动 `this.detectPasswordCaptchaUrl()`、`this.waitForPasswordCaptchaUrl()` 的 NapCat步骤。
   * @param loginStatus - NapCat列表；使用 `loginError` 字段生成结果。
   * @param sinceMs - NapCat列表；驱动 `this.detectPasswordCaptchaUrl()`、`this.waitForPasswordCaptchaUrl()` 的 NapCat步骤。
   */
  private async resolvePasswordCaptchaUrl(
    container: QqbotNapcatRuntime,
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
   * 解析Status Captcha Url。
   * @param session - session 输入；使用 `lastCaptchaLookupAt`、`lastRestartedAt` 字段生成结果。
   * @param container - container 输入；驱动 `this.detectPasswordCaptchaUrl()` 的 NapCat步骤。
   * @param loginStatus - NapCat列表；决定 NapCat条件分支。
   */
  private async resolveStatusCaptchaUrl(
    session: QqbotLoginScanSession,
    container: QqbotNapcatRuntime,
    loginStatus: NapcatLoginStatus,
  ) {
    if (!this.isPasswordCaptchaStillRequired(loginStatus)) return '';
    if (!this.shouldLookupStatusCaptchaUrl(session)) return '';
    session.lastCaptchaLookupAt = Date.now();
    this.persistLoginSession(session);
    return this.detectPasswordCaptchaUrl(container, session.lastRestartedAt);
  }

  /**
   * 查询 NapCat 登录运行态数据。
   * @param status - NapCat列表；使用 `captchaUrl`、`loginError` 字段生成结果。
   */
  private getCaptchaUrlFromStatus(status: NapcatLoginStatus) {
    return (
      this.toolsService.toTrimmedString(status.captchaUrl) ||
      this.toolsService.extractNapcatCaptchaUrl(status.loginError)
    );
  }

  /**
   * 判断 NapCat 登录运行态条件。
   * @param session - session 输入；使用 `lastCaptchaLookupAt` 字段生成结果。
   */
  private shouldLookupStatusCaptchaUrl(session: QqbotLoginScanSession) {
    const lastCheckedAt = Number(session.lastCaptchaLookupAt || 0);
    if (!Number.isFinite(lastCheckedAt) || lastCheckedAt <= 0) return true;
    const cooldownMs = Math.max(15_000, this.getLoginPollIntervalMs() * 5);
    return Date.now() - lastCheckedAt > cooldownMs;
  }

  /**
   * 判断 NapCat 登录运行态条件。
   * @param status - NapCat列表；使用 `loginError` 字段计算判断结果。
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
   * 执行 NapCat 登录运行态流程。
   * @param container - container 输入；驱动 `containerService.detectRuntimeCaptchaUrl()` 的 NapCat步骤。
   * @param sinceMs - NapCat列表；驱动 `containerService.detectRuntimeCaptchaUrl()` 的 NapCat步骤。
   * @param allowTailFallback - allowTailFallback 输入；决定 NapCat条件分支。
   */
  private async detectPasswordCaptchaUrl(
    container: QqbotNapcatRuntime,
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
   * 执行 NapCat 登录运行态流程。
   * @param container - container 输入；驱动 `this.detectPasswordCaptchaUrl()` 的 NapCat步骤。
   * @param sinceMs - NapCat列表；驱动 `this.detectPasswordCaptchaUrl()` 的 NapCat步骤。
   */
  private async waitForPasswordCaptchaUrl(
    container: QqbotNapcatRuntime,
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
   * 判断 NapCat 登录运行态条件。
   * @param status - NapCat列表；使用 `qrcodeurl` 字段计算判断结果。
   */
  private isPasswordQrcodeChallenge(status: NapcatLoginStatus) {
    return (
      !!this.toolsService.toTrimmedString(status.qrcodeurl) ||
      this.toolsService.isNapcatExpiredQrcodeStatus(status)
    );
  }

  /**
   * 查询 NapCat 登录运行态数据。
   * @param options - NapCat列表；使用 `hasExistingPrimaryBinding`、`loginPassword` 字段生成结果。
   */
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

  /**
   * 投递 NapCat 登录运行态消息或任务。
   * @param session - session 输入；使用 `errorMessage` 字段生成结果。
   * @param reason - reason 输入；影响 publishQuickLoginFallback 的返回值。
   * @param hasPasswordFallback - hasPasswordFallback 输入；影响 publishQuickLoginFallback 的返回值。
   */
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
    this.persistLoginSession(session);
    this.publishScanResultEvent(
      session,
      'quick-login-fallback',
      'processing',
      session.errorMessage,
    );
  }

  /**
   * 投递 NapCat 登录运行态消息或任务。
   * @param session - session 输入；使用 `errorMessage` 字段生成结果。
   * @param reason - reason 输入；影响 publishPasswordLoginFallback 的返回值。
   */
  private publishPasswordLoginFallback(
    session: QqbotLoginScanSession,
    reason?: string,
  ) {
    session.errorMessage = reason
      ? `密码登录未完成：${reason}，开始生成二维码`
      : '密码登录未完成，开始生成二维码';
    this.persistLoginSession(session);
    this.publishScanResultEvent(
      session,
      'password-login-fallback',
      'processing',
      session.errorMessage,
    );
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param container - container 输入；驱动 `containerService.restartRuntimeContainer()`、`webuiClient.clearCredential()`、`this.getLoginStatus()` 的 NapCat步骤。
   * @param options - NapCat列表；使用 `waitForReady` 字段生成结果。
   */
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

    this.webuiClient.clearCredential(container);
    if (options.waitForReady === false) return;

    await this.toolsService.sleep(this.getRestartDelayMs());
    await this.getLoginStatus(container, true);
  }

  /**
   * 查询 NapCat 登录运行态数据。
   */
  private getSessionTtlMs() {
    return Number(
      this.configService.get('NAPCAT_LOGIN_QR_EXPIRE_MS') || 2 * 60 * 1000,
    );
  }

  /**
   * 查询 NapCat 登录运行态数据。
   * @returns 人工验证码与新设备验证会话的保活窗口，至少不短于普通登录二维码窗口。
   */
  private getHumanVerificationSessionTtlMs() {
    const configured = Number(
      this.configService.get('NAPCAT_LOGIN_HUMAN_VERIFY_EXPIRE_MS') ||
        15 * 60 * 1000,
    );
    const fallback = 15 * 60 * 1000;
    const ttl =
      Number.isFinite(configured) && configured > 0 ? configured : fallback;
    return Math.max(ttl, this.getSessionTtlMs());
  }

  /**
   * 查询 NapCat 登录运行态数据。
   * @param session - 当前登录会话；根据验证码、新设备链接或新设备二维码判断是否需要人工验证保活窗口。
   */
  private getSessionRenewalTtlMs(session: QqbotLoginScanSession) {
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
   * 执行 NapCat 登录运行态流程。
   * @param session - 当前登录会话；写回下一次状态轮询前允许保持 pending 的截止时间。
   */
  private renewSessionExpiry(session: QqbotLoginScanSession) {
    session.expiresAt = Date.now() + this.getSessionRenewalTtlMs(session);
  }

  /**
   * 查询 NapCat 登录运行态数据。
   */
  private getTimeout() {
    return Number(this.configService.get('NAPCAT_WEBUI_TIMEOUT_MS') || 8000);
  }

  /**
   * 查询 NapCat 登录运行态数据。
   */
  private getRestartDelayMs() {
    return Number(
      this.configService.get('NAPCAT_WEBUI_RESTART_DELAY_MS') || 3000,
    );
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param container - container 输入；驱动 `this.getLoginStatus()`、`this.detectPasswordCaptchaUrl()`、`this.getCaptchaUrlFromStatus()` 的 NapCat步骤。
   * @param sinceMs - NapCat列表；驱动 `this.detectPasswordCaptchaUrl()`、`Number.isFinite()`、`this.getCaptchaUrlFromStatus()` 的 NapCat步骤。
   */
  private async waitForPasswordLoginStatus(
    container: QqbotNapcatRuntime,
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
   * 查询 NapCat 登录运行态数据。
   * @param waitMs - NapCat列表；驱动 `Number.isFinite()` 的 NapCat步骤。
   * @param intervalMs - NapCat列表；驱动 `Number.isFinite()` 的 NapCat步骤。
   */
  private getLoginPollAttempts(waitMs: number, intervalMs: number) {
    const normalizedWaitMs = Number.isFinite(waitMs) && waitMs > 0 ? waitMs : 1;
    const normalizedIntervalMs =
      Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 1;
    return Math.max(1, Math.ceil(normalizedWaitMs / normalizedIntervalMs));
  }

  /**
   * 查询 NapCat 登录运行态数据。
   */
  private getPasswordLoginWaitMs() {
    return this.getPositiveConfigNumber(
      'QQBOT_NAPCAT_PASSWORD_LOGIN_WAIT_MS',
      120_000,
    );
  }

  /**
   * 查询 NapCat 快速登录结果的等待窗口。
   * @returns WebUI SetQuickLogin 后最多等待 QQ 登录态变化的毫秒数。
   */
  private getQuickLoginWaitMs() {
    return this.getPositiveConfigNumber(
      'QQBOT_NAPCAT_QUICK_LOGIN_WAIT_MS',
      15_000,
    );
  }

  /**
   * 查询 NapCat 登录运行态数据。
   */
  private getLoginPollIntervalMs() {
    return this.getPositiveConfigNumber(
      'QQBOT_NAPCAT_LOGIN_POLL_INTERVAL_MS',
      3000,
    );
  }

  /**
   * 查询 NapCat 登录运行态数据。
   * @param key - 键名；驱动 `Number()` 的 NapCat步骤。
   * @param fallback - 兜底值；驱动 `Number()`、`Number.isFinite()` 的 NapCat步骤。
   */
  private getPositiveConfigNumber(key: string, fallback: number) {
    const value = Number(this.configService.get(key) || fallback);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  /**
   * 执行Napcat Request。
   * @param retry - retry 输入；决定 NapCat条件分支。
   * @param action - action 输入；影响 executeNapcatRequest 的返回值。
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
