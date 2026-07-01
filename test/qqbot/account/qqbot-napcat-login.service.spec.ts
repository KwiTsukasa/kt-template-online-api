jest.mock('@/common', () => {
  const actualCommon = jest.requireActual('@/common');
  return {
    ...actualCommon,
    ToolsService: actualCommon.ToolsService,
    ensureSnowflakeId: jest.fn(),
    setDictDecodeCache: jest.fn(),
    /**
     * 执行 测试回调。
     * @param message - message 输入；驱动 `Error()` 的 测试步骤。
     */
    throwVbenError: (message: string) => {
      throw new Error(message);
    },
  };
});

import { ConfigService } from '@nestjs/config';
import { ToolsService } from '@/common';
import { QqbotAccountService } from '@/modules/qqbot/core/application/account/qqbot-account.service';
import { QqbotNapcatLoginService } from '@/modules/qqbot/napcat/application/login/qqbot-napcat-login.service';
import { QqbotNapcatContainerService } from '@/modules/qqbot/napcat/infrastructure/integration/container/qqbot-napcat-container.service';
import { NapcatLoginSession } from '@/modules/qqbot/napcat/infrastructure/persistence/napcat-login-session.entity';
import { NapcatLoginStateStoreService } from '@/modules/qqbot/napcat/infrastructure/persistence/napcat-login-state-store.service';

describe('QqbotNapcatLoginService', () => {
  /**
   * 为更新登录测试模拟 NapCat WebUI quick/password 登录接口。
   * @param target - 被测登录服务；其私有 postNapcat 会被替换为可控实现。
   * @param options - quick/password 分支的返回或错误，用来驱动目标状态机路径。
   * @returns Jest spy，供用例继续断言 WebUI 请求体。
   */
  const mockWebuiLoginPost = (
    target: QqbotNapcatLoginService,
    options: {
      passwordError?: string;
      passwordResult?: null | Record<string, unknown>;
      quickError?: string;
      quickResult?: null | Record<string, unknown>;
      restartError?: string;
      restartResult?: null | Record<string, unknown>;
    } = {},
  ) =>
    jest
      .spyOn(target as any, 'postNapcat')
      .mockImplementation(async (_container: unknown, path: string) => {
        if (path === '/api/QQLogin/SetQuickLogin') {
          if (options.quickError) throw new Error(options.quickError);
          return options.quickResult ?? null;
        }
        if (path === '/api/QQLogin/PasswordLogin') {
          if (options.passwordError) throw new Error(options.passwordError);
          return options.passwordResult ?? null;
        }
        if (path === '/api/QQLogin/RestartNapCat') {
          if (options.restartError) throw new Error(options.restartError);
          return options.restartResult ?? null;
        }
        return null;
      });

  const toolsService = new ToolsService();
  /**
   * 创建用于登录会话持久化断言的 TypeORM Repository 替身。
   * @returns 带内存 rows 的最小 Repository；按 sessionKey 模拟 update/save 行为。
   */
  const createLoginSessionRepository = () => {
    const rows: NapcatLoginSession[] = [];
    return {
      create: jest.fn(
        (input: Partial<NapcatLoginSession>) =>
          ({ ...input }) as NapcatLoginSession,
      ),
      findOne: jest.fn(async ({ where }: { where: Record<string, any> }) => {
        return (
          rows.find((row) =>
            Object.entries(where).every(([key, value]) => row[key] === value),
          ) || null
        );
      }),
      rows,
      save: jest.fn(async (input: NapcatLoginSession) => {
        const index = rows.findIndex(
          (row) =>
            (input.id && row.id === input.id) ||
            (input.sessionKey && row.sessionKey === input.sessionKey),
        );
        if (index >= 0) {
          rows[index] = { ...rows[index], ...input } as NapcatLoginSession;
          return rows[index];
        }
        rows.push(input);
        return input;
      }),
      update: jest.fn(
        async (
          where: Record<string, any>,
          input: Partial<NapcatLoginSession>,
        ) => {
          const row = rows.find((item) =>
            Object.entries(where).every(([key, value]) => item[key] === value),
          );
          if (row) Object.assign(row, input);
          return { affected: row ? 1 : 0 };
        },
      ),
    };
  };
  const service = new QqbotNapcatLoginService(
    { get: jest.fn() } as unknown as ConfigService,
    {} as QqbotAccountService,
    {} as QqbotNapcatContainerService,
    toolsService,
  );

  beforeEach(() => {
    (service as any).sessions.clear();
    (service as any).sessionEventLogs.clear();
    (service as any).sessionEventListeners.clear();
    jest.restoreAllMocks();
  });

  it('uses qrcode returned by NapCat refresh endpoint', async () => {
    (service as any).sessions.set('session-1', {
      containerId: 'container-1',
      containerName: 'napcat-1',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      id: 'session-1',
      mode: 'refresh',
      qrcode: 'old-qrcode',
      status: 'pending',
      webuiPort: 6100,
    });
    jest
      .spyOn(service as any, 'getSessionContainer')
      .mockResolvedValue({ id: 'container-1' });
    jest.spyOn(service as any, 'getLoginStatus').mockResolvedValue({
      isLogin: false,
    });
    jest
      .spyOn(service as any, 'callRefreshQrcode')
      .mockResolvedValue('new-qrcode-image');
    const getQrcode = jest.spyOn(service as any, 'getQrcode');

    const result = await service.refreshQrcode('session-1');

    expect(result.qrcode).toBe('new-qrcode-image');
    expect(getQrcode).not.toHaveBeenCalled();
  });

  it('reuses the existing account container when refreshing login', async () => {
    const account = {
      id: 'account-1',
      selfId: '10001',
    };
    const existingContainer = {
      id: 'container-current',
      name: 'napcat-10001',
    };
    const accountService = {
      findById: jest.fn().mockResolvedValue(account),
      findByIdWithNapcatLoginSecret: jest.fn().mockResolvedValue(account),
      getNapcatLoginPassword: jest.fn().mockReturnValue('qq-password'),
    };
    const containerService = {
      prepareAccountContainer: jest.fn().mockResolvedValue(existingContainer),
    };
    const refreshService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      accountService as unknown as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const startScan = jest
      .spyOn(refreshService as any, 'startScan')
      .mockResolvedValue({ sessionId: 'session-refresh' });

    await refreshService.startRefresh('account-1');

    expect(accountService.findByIdWithNapcatLoginSecret).toHaveBeenCalledWith(
      'account-1',
    );
    expect(accountService.getNapcatLoginPassword).toHaveBeenCalledWith(account);
    expect(containerService.prepareAccountContainer).toHaveBeenCalledWith(
      account,
      'qq-password',
    );
    expect(startScan).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account-1',
        expectedSelfId: '10001',
        forceRelogin: true,
        loginPasswordAvailable: true,
        loginPassword: 'qq-password',
        mode: 'refresh',
      }),
      existingContainer,
    );
  });

  it('returns refresh login scan immediately while trying quick login in background', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-current',
      name: 'napcat-10001',
    };
    const refreshService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      {} as QqbotAccountService,
      {} as QqbotNapcatContainerService,
      new ToolsService(),
    );
    jest
      .spyOn((refreshService as any).toolsService, 'sleep')
      .mockResolvedValue(undefined);
    jest
      .spyOn(refreshService as any, 'cleanupSessions')
      .mockResolvedValue(undefined);
    const prepareReloginQrcode = jest
      .spyOn(refreshService as any, 'prepareReloginQrcode')
      .mockResolvedValue(undefined);

    const result = await (refreshService as any).startScan(
      {
        accountId: 'account-1',
        expectedSelfId: '10001',
        forceRelogin: true,
        mode: 'refresh',
      },
      container,
    );

    expect(result.status).toBe('pending');
    expect(result.qrcode).toBeUndefined();
    expect(result.errorMessage).toBe('NapCat 正在尝试快速登录，请稍后');
    expect(prepareReloginQrcode).toHaveBeenCalledWith(
      expect.objectContaining({
        errorMessage: 'NapCat 正在尝试快速登录，请稍后',
        status: 'pending',
      }),
      container,
      undefined,
      undefined,
    );
  });

  it('reuses an active refresh session instead of starting repeated relogin during SSE retries', async () => {
    const account = {
      id: 'account-1',
      selfId: '10001',
    };
    const existingContainer = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-current',
      name: 'napcat-10001',
    };
    const accountService = {
      findByIdWithNapcatLoginSecret: jest.fn().mockResolvedValue(account),
      getNapcatLoginPassword: jest.fn().mockReturnValue('qq-password'),
    };
    const containerService = {
      prepareAccountContainer: jest.fn().mockResolvedValue(existingContainer),
    };
    const refreshService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      accountService as unknown as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const prepareReloginQrcode = jest
      .spyOn(refreshService as any, 'prepareReloginQrcode')
      .mockResolvedValue(undefined);

    const first = await refreshService.startRefresh('account-1');
    const second = await refreshService.startRefresh('account-1');

    expect(second.sessionId).toBe(first.sessionId);
    expect(accountService.findByIdWithNapcatLoginSecret).toHaveBeenCalledTimes(
      1,
    );
    expect(containerService.prepareAccountContainer).toHaveBeenCalledTimes(1);
    expect(prepareReloginQrcode).toHaveBeenCalledTimes(1);
  });

  it('starts a new refresh session after password is maintained on an account with an old pending session', async () => {
    const account = {
      id: 'account-1',
      selfId: '10001',
    };
    const existingContainer = {
      baseUrl: 'http://127.0.0.1:6103/',
      hasExistingPrimaryBinding: true,
      id: 'container-current',
      name: 'napcat-10001',
    };
    const accountService = {
      findByIdWithNapcatLoginSecret: jest.fn().mockResolvedValue(account),
      getNapcatLoginPassword: jest.fn().mockReturnValue('qq-password'),
    };
    const containerService = {
      prepareAccountContainer: jest.fn().mockResolvedValue(existingContainer),
    };
    const refreshService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      accountService as unknown as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    (refreshService as any).sessions.set('session-without-password', {
      accountId: 'account-1',
      containerId: 'container-current',
      containerName: 'napcat-10001',
      createdAt: Date.now(),
      errorMessage: '密码登录未完成：未配置 QQ 登录密码，开始生成二维码',
      expiresAt: Date.now() + 60_000,
      id: 'session-without-password',
      mode: 'refresh',
      status: 'pending',
      webuiPort: 6103,
    });
    const prepareReloginQrcode = jest
      .spyOn(refreshService as any, 'prepareReloginQrcode')
      .mockResolvedValue(undefined);

    const result = await refreshService.startRefresh('account-1');

    expect(result.sessionId).not.toBe('session-without-password');
    expect(accountService.findByIdWithNapcatLoginSecret).toHaveBeenCalledWith(
      'account-1',
    );
    expect(accountService.getNapcatLoginPassword).toHaveBeenCalledWith(account);
    expect(prepareReloginQrcode).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account-1',
        expectedSelfId: '10001',
        status: 'pending',
      }),
      existingContainer,
      'qq-password',
      existingContainer.hasExistingPrimaryBinding,
    );
  });

  it('does not return a stale qrcode when reusing an active refresh session', async () => {
    const refreshService = new QqbotNapcatLoginService(
      {
        get: jest.fn((key: string) =>
          key === 'NAPCAT_WEBUI_RESTART_DELAY_MS' ? '1' : undefined,
        ),
      } as unknown as ConfigService,
      {} as QqbotAccountService,
      {} as QqbotNapcatContainerService,
      new ToolsService(),
    );
    (refreshService as any).sessions.set('session-active-stale-qrcode', {
      accountId: 'account-1',
      containerId: 'container-1',
      containerName: 'napcat-1',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      id: 'session-active-stale-qrcode',
      mode: 'refresh',
      qrcode: 'old-qrcode',
      status: 'pending',
      webuiPort: 6101,
    });
    const refreshQrcode = jest
      .spyOn(refreshService, 'refreshQrcode')
      .mockResolvedValue({
        errorMessage: 'NapCat 正在重新生成二维码，请稍后刷新或等待自动更新',
        mode: 'refresh',
        qrcode: undefined,
        sessionId: 'session-active-stale-qrcode',
        status: 'pending',
      });

    const result = await refreshService.startRefresh('account-1');

    expect(result.sessionId).toBe('session-active-stale-qrcode');
    expect(result.qrcode).toBeUndefined();
    expect(result.errorMessage).toContain('正在重新生成二维码');
    expect(refreshQrcode).toHaveBeenCalledWith('session-active-stale-qrcode');
  });

  it('shares an in-flight refresh task before the first session is created', async () => {
    const account = {
      id: 'account-1',
      selfId: '10001',
    };
    const existingContainer = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-current',
      name: 'napcat-10001',
    };
    const accountService = {
      findByIdWithNapcatLoginSecret: jest.fn().mockResolvedValue(account),
      getNapcatLoginPassword: jest.fn().mockReturnValue('qq-password'),
    };
    let resolveContainer: (container: typeof existingContainer) => void = () =>
      undefined;
    const containerPromise = new Promise<typeof existingContainer>(
      (resolve) => {
        resolveContainer = resolve;
      },
    );
    const containerService = {
      prepareAccountContainer: jest.fn().mockReturnValue(containerPromise),
    };
    const refreshService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      accountService as unknown as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const prepareReloginQrcode = jest
      .spyOn(refreshService as any, 'prepareReloginQrcode')
      .mockResolvedValue(undefined);

    const firstTask = refreshService.startRefresh('account-1');
    const secondTask = refreshService.startRefresh('account-1');
    resolveContainer(existingContainer);

    const [first, second] = await Promise.all([firstTask, secondTask]);

    expect(second.sessionId).toBe(first.sessionId);
    expect(accountService.findByIdWithNapcatLoginSecret).toHaveBeenCalledTimes(
      1,
    );
    expect(containerService.prepareAccountContainer).toHaveBeenCalledTimes(1);
    expect(prepareReloginQrcode).toHaveBeenCalledTimes(1);
  });

  it('keeps refresh login session alive while relogin is still preparing', async () => {
    const containerService = {
      removeUnboundContainer: jest.fn().mockResolvedValue(false),
    };
    const refreshService = new QqbotNapcatLoginService(
      {
        get: jest.fn((key: string) =>
          key === 'NAPCAT_LOGIN_QR_EXPIRE_MS' ? '120000' : '',
        ),
      } as unknown as ConfigService,
      {} as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container: {
        id: 'container-ttl',
        name: 'napcat-10001',
      },
      expectedSelfId: '10001',
      mode: 'refresh',
      preparingRelogin: true,
      status: 'pending',
    });
    session.errorMessage = 'NapCat 正在尝试密码登录，请稍后';
    session.expiresAt = Date.now() - 1000;
    (refreshService as any).sessions.set(session.id, session);

    const result = await refreshService.status(session.id);

    expect(result.status).toBe('pending');
    expect(result.errorMessage).toBe('NapCat 正在尝试密码登录，请稍后');
    expect(result.expiresAt).toBeGreaterThan(Date.now());
    expect(containerService.removeUnboundContainer).not.toHaveBeenCalled();
    expect((refreshService as any).sessions.has(session.id)).toBe(true);
  });

  it('uses a longer TTL for human captcha and new-device verification states', () => {
    const now = new Date('2026-06-19T04:10:00+08:00').getTime();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const refreshService = new QqbotNapcatLoginService(
      {
        get: jest.fn((key: string) => {
          if (key === 'NAPCAT_LOGIN_QR_EXPIRE_MS') return '120000';
          if (key === 'NAPCAT_LOGIN_HUMAN_VERIFY_EXPIRE_MS') return '900000';
          return '';
        }),
      } as unknown as ConfigService,
      {} as QqbotAccountService,
      {} as QqbotNapcatContainerService,
      new ToolsService(),
    );

    const qrcodeSession = (refreshService as any).createSession({
      container: { id: 'container-qr', name: 'napcat-qr' },
      mode: 'refresh',
      status: 'pending',
    });
    const captchaSession = (refreshService as any).createSession({
      container: { id: 'container-captcha', name: 'napcat-captcha' },
      mode: 'refresh',
      status: 'pending',
    });
    const newDeviceSession = (refreshService as any).createSession({
      container: { id: 'container-device', name: 'napcat-device' },
      mode: 'refresh',
      status: 'pending',
    });

    const captcha = (refreshService as any).keepPasswordCaptchaPending(
      captchaSession,
      'https://ti.qq.com/safe/tools/captcha/sms-verify-login',
    );
    const newDevice = (refreshService as any).keepNewDevicePending(
      newDeviceSession,
      'qr-pending',
      '新设备二维码待扫码',
      'new-device-qrcode-ready',
    );

    expect(qrcodeSession.expiresAt).toBe(now + 120_000);
    expect(captcha.expiresAt).toBe(now + 900_000);
    expect(newDevice.expiresAt).toBe(now + 900_000);
  });

  it('recovers stale refresh preparation left by a restarted API pod', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-stale-preparing',
      name: 'napcat-10001',
    };
    const containerService = {
      findRuntimeById: jest.fn().mockResolvedValue(container),
      removeUnboundContainer: jest.fn().mockResolvedValue(false),
    };
    const refreshService = new QqbotNapcatLoginService(
      {
        get: jest.fn((key: string) => {
          if (key === 'NAPCAT_LOGIN_QR_EXPIRE_MS') return '120000';
          if (key === 'QQBOT_NAPCAT_PASSWORD_LOGIN_WAIT_MS') return '1000';
          if (key === 'QQBOT_NAPCAT_LOGIN_POLL_INTERVAL_MS') return '1000';
          if (key === 'NAPCAT_WEBUI_RESTART_DELAY_MS') return '100';
          if (key === 'NAPCAT_WEBUI_TIMEOUT_MS') return '100';
          return '';
        }),
      } as unknown as ConfigService,
      {} as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      preparingRelogin: true,
      status: 'pending',
    });
    session.errorMessage = 'NapCat 正在尝试密码登录，请稍后';
    session.expiresAt = Date.now() + 60_000;
    session.lastRestartedAt = Date.now() - 10_000;
    (refreshService as any).sessions.set(session.id, session);
    const getLoginStatus = jest
      .spyOn(refreshService as any, 'getLoginStatus')
      .mockResolvedValue({
        isLogin: false,
        qrcodeurl: 'fresh-qrcode-after-restart',
      });
    jest
      .spyOn(refreshService as any, 'getQrcode')
      .mockResolvedValue('fresh-qrcode-after-restart');

    const result = await refreshService.status(session.id);

    expect(getLoginStatus).toHaveBeenCalledWith(container);
    expect(result.status).toBe('pending');
    expect(result.qrcode).toBe('fresh-qrcode-after-restart');
    expect(
      (refreshService as any).sessions.get(session.id).preparingRelogin,
    ).toBe(false);
  });

  it('uses runtime logs to recover captcha url when status only says captcha required', async () => {
    const captchaUrl =
      'https://ti.qq.com/safe/tools/captcha/sms-verify-login?uin=10001';
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-status-captcha',
      name: 'napcat-10001',
    };
    const containerService = {
      detectRuntimeCaptchaUrl: jest.fn().mockResolvedValue(captchaUrl),
      findRuntimeById: jest.fn().mockResolvedValue(container),
      removeUnboundContainer: jest.fn().mockResolvedValue(false),
    };
    const refreshService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      {} as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      status: 'pending',
    });
    session.lastRestartedAt = Date.now() - 10_000;
    (refreshService as any).sessions.set(session.id, session);
    jest.spyOn(refreshService as any, 'getLoginStatus').mockResolvedValue({
      isLogin: false,
      loginError: '密码回退需要验证码，请在 WebUi 中继续完成验证',
    });

    const result = await refreshService.status(session.id);

    expect(containerService.detectRuntimeCaptchaUrl).toHaveBeenCalledWith(
      container,
      session.lastRestartedAt,
    );
    expect(result.captchaUrl).toBe(captchaUrl);
    expect(result.errorMessage).toContain('密码登录需要完成 QQ 安全验证');
  });

  it('keeps existing password captcha pending when NapCat still reports captcha without url', async () => {
    const captchaUrl =
      'https://ti.qq.com/safe/tools/captcha/sms-verify-login?uin=10001';
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-captcha-status',
      name: 'napcat-10001',
    };
    const containerService = {
      ensureRuntimeLoginEnv: jest.fn().mockResolvedValue({
        changed: true,
        ok: true,
      }),
      findRuntimeById: jest.fn().mockResolvedValue(container),
      removeUnboundContainer: jest.fn().mockResolvedValue(false),
    };
    const refreshService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      {} as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      status: 'pending',
    });
    session.captchaUrl = captchaUrl;
    session.passwordMd5 = '0123456789abcdef0123456789abcdef';
    (refreshService as any).sessions.set(session.id, session);
    jest.spyOn(refreshService as any, 'getLoginStatus').mockResolvedValue({
      isLogin: false,
      loginError: '密码回退需要验证码，请在 WebUi 中继续完成验证',
    });

    const result = await refreshService.status(session.id);

    expect(result.status).toBe('pending');
    expect(result.captchaUrl).toBe(captchaUrl);
    expect(result.errorMessage).toContain('密码登录需要完成 QQ 安全验证');
    expect(containerService.ensureRuntimeLoginEnv).not.toHaveBeenCalled();
  });

  it('does not keep existing password captcha pending when safety verification fails', async () => {
    const captchaUrl =
      'https://ti.qq.com/safe/tools/captcha/sms-verify-login?uin=10001';
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-captcha-failed-status',
      name: 'napcat-10001',
    };
    const containerService = {
      ensureRuntimeLoginEnv: jest.fn().mockResolvedValue({
        changed: true,
        ok: true,
      }),
      findRuntimeById: jest.fn().mockResolvedValue(container),
      removeUnboundContainer: jest.fn().mockResolvedValue(false),
    };
    const refreshService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      {} as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      status: 'pending',
    });
    session.captchaUrl = captchaUrl;
    session.passwordMd5 = '0123456789abcdef0123456789abcdef';
    (refreshService as any).sessions.set(session.id, session);
    jest.spyOn(refreshService as any, 'getLoginStatus').mockResolvedValue({
      isLogin: false,
      loginError: '安全验证失败，请重新登录',
    });

    const result = await refreshService.status(session.id);

    expect(result.status).toBe('error');
    expect(result.captchaUrl).toBeUndefined();
    expect(result.errorMessage).toBe('安全验证失败，请重新登录');
    expect(containerService.ensureRuntimeLoginEnv).not.toHaveBeenCalled();
  });

  it('uses NapCat WebUI quick login before generating qrcode for refresh login', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-quick',
      name: 'napcat-10001',
    };
    const accountService = {
      ensureScannedAccount: jest.fn().mockResolvedValue('account-1'),
    };
    const containerService = {
      bindAccount: jest.fn().mockResolvedValue(undefined),
      ensureRuntimeLoginEnv: jest
        .fn()
        .mockResolvedValue({ changed: false, ok: true }),
      resetRuntimeLoginState: jest.fn().mockResolvedValue(true),
      restartRuntimeContainer: jest.fn().mockResolvedValue(true),
    };
    const refreshService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      accountService as unknown as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      preparingRelogin: true,
      status: 'pending',
    });
    (refreshService as any).sessions.set(session.id, session);
    jest
      .spyOn((refreshService as any).toolsService, 'sleep')
      .mockResolvedValue(undefined);
    jest.spyOn(refreshService as any, 'getLoginStatus').mockResolvedValue({
      isLogin: true,
    });
    jest.spyOn(refreshService as any, 'getLoginInfo').mockResolvedValue({
      nickname: 'Kwi',
      online: true,
      uin: '10001',
    });
    const postNapcat = jest
      .spyOn(refreshService as any, 'postNapcat')
      .mockResolvedValue(null);
    const refreshQrcode = jest
      .spyOn(refreshService as any, 'refreshOrGetQrcode')
      .mockResolvedValue('fallback-qrcode');

    await (refreshService as any).prepareReloginQrcode(session, container);

    expect(postNapcat).toHaveBeenCalledWith(
      container,
      '/api/QQLogin/SetQuickLogin',
      { uin: '10001' },
    );
    expect(containerService.ensureRuntimeLoginEnv).not.toHaveBeenCalled();
    expect(containerService.restartRuntimeContainer).not.toHaveBeenCalled();
    expect(containerService.resetRuntimeLoginState).not.toHaveBeenCalled();
    expect(refreshQrcode).not.toHaveBeenCalled();
    expect(accountService.ensureScannedAccount).toHaveBeenCalledWith({
      accountId: 'account-1',
      name: 'Kwi',
      selfId: '10001',
    });
    expect(containerService.bindAccount).toHaveBeenCalledWith(
      'account-1',
      'container-quick',
      '10001',
    );
    expect(session.status).toBe('success');
    const events = (refreshService as any).sessionEventLogs.get(session.id);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ step: 'quick-login-start' }),
        expect.objectContaining({
          message: '快速登录成功',
          step: 'login-success',
        }),
      ]),
    );
  });

  it('completes quick login without runtime password env cleanup', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-quick-cleanup-failed',
      name: 'napcat-10001',
    };
    const accountService = {
      ensureScannedAccount: jest.fn().mockResolvedValue('account-1'),
    };
    const containerService = {
      bindAccount: jest.fn().mockResolvedValue(undefined),
      ensureRuntimeLoginEnv: jest
        .fn()
        .mockResolvedValue({ changed: false, ok: false }),
      resetRuntimeLoginState: jest.fn().mockResolvedValue(true),
      restartRuntimeContainer: jest.fn().mockResolvedValue(true),
    };
    const refreshService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      accountService as unknown as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      preparingRelogin: true,
      status: 'pending',
    });
    (refreshService as any).sessions.set(session.id, session);
    jest
      .spyOn((refreshService as any).toolsService, 'sleep')
      .mockResolvedValue(undefined);
    jest.spyOn(refreshService as any, 'getLoginStatus').mockResolvedValue({
      isLogin: true,
    });
    jest.spyOn(refreshService as any, 'getLoginInfo').mockResolvedValue({
      nickname: 'Kwi',
      online: true,
      uin: '10001',
    });
    mockWebuiLoginPost(refreshService);

    await (refreshService as any).prepareReloginQrcode(session, container);

    expect(containerService.ensureRuntimeLoginEnv).not.toHaveBeenCalled();
    expect(containerService.restartRuntimeContainer).not.toHaveBeenCalled();
    expect(containerService.resetRuntimeLoginState).not.toHaveBeenCalled();
    expect(accountService.ensureScannedAccount).toHaveBeenCalledWith({
      accountId: 'account-1',
      name: 'Kwi',
      selfId: '10001',
    });
    expect(containerService.bindAccount).toHaveBeenCalledWith(
      'account-1',
      'container-quick-cleanup-failed',
      '10001',
    );
    expect(session.status).toBe('success');
    const steps = (
      (refreshService as any).sessionEventLogs.get(session.id) ?? []
    ).map((event: { step: string }) => event.step);
    expect(steps).not.toContain('quick-login-cleanup');
    expect(steps).toContain('login-success');
  });

  it('falls back to fresh qrcode without Docker reset when WebUI quick login fails', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-fallback',
      name: 'napcat-10001',
    };
    const containerService = {
      ensureRuntimeLoginEnv: jest
        .fn()
        .mockResolvedValue({ changed: false, ok: true }),
      resetRuntimeLoginState: jest.fn().mockResolvedValue(true),
      restartRuntimeContainer: jest.fn().mockResolvedValue(true),
    };
    const refreshService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      {} as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      preparingRelogin: true,
      status: 'pending',
    });
    (refreshService as any).sessions.set(session.id, session);
    jest
      .spyOn((refreshService as any).toolsService, 'sleep')
      .mockResolvedValue(undefined);
    jest.spyOn(refreshService as any, 'getLoginStatus').mockResolvedValue({
      isLogin: false,
      loginError: '快速登录未成功',
    });
    jest
      .spyOn(refreshService as any, 'postNapcat')
      .mockRejectedValue(new Error('快速登录未成功'));
    jest
      .spyOn(refreshService as any, 'refreshOrGetQrcode')
      .mockResolvedValue('fallback-qrcode');

    await (refreshService as any).prepareReloginQrcode(session, container);

    expect(containerService.restartRuntimeContainer).not.toHaveBeenCalled();
    expect(containerService.resetRuntimeLoginState).not.toHaveBeenCalled();
    expect(session.qrcode).toBe('fallback-qrcode');
    const steps = (
      (refreshService as any).sessionEventLogs.get(session.id) ?? []
    ).map((event: { step: string }) => event.step);
    expect(steps.indexOf('quick-login-start')).toBeLessThan(
      steps.indexOf('quick-login-fallback'),
    );
    expect(steps.indexOf('quick-login-fallback')).toBeLessThan(
      steps.indexOf('qrcode-fetch'),
    );
  });

  it('returns create login scan before remote container startup finishes', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6104/',
      id: 'container-create',
      name: 'napcat-create',
      webuiPort: 6104,
    };
    const never = new Promise<never>(() => undefined);
    const containerService = {
      prepareCreateContainer: jest.fn().mockReturnValue(never),
      reserveCreateContainer: jest.fn().mockResolvedValue(container),
      startCreateContainer: jest.fn().mockReturnValue(never),
    };
    const createService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      {} as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );

    const result = await Promise.race([
      createService.startCreate(),
      new Promise((resolve) => {
        setTimeout(() => resolve({ timedOut: true }), 20);
      }),
    ]);

    expect(result).toEqual(
      expect.objectContaining({
        containerId: 'container-create',
        errorMessage: 'NapCat 正在创建登录容器，请稍后',
        mode: 'create',
        qrcode: undefined,
        status: 'pending',
      }),
    );
    expect(containerService.prepareCreateContainer).not.toHaveBeenCalled();
    expect(containerService.reserveCreateContainer).toHaveBeenCalledTimes(1);
    expect(containerService.startCreateContainer).toHaveBeenCalledWith(
      container,
    );
  });

  it('keeps create login pending while the remote container is still starting', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6104/',
      id: 'container-create',
      name: 'napcat-create',
      webuiPort: 6104,
    };
    const never = new Promise<never>(() => undefined);
    const containerService = {
      reserveCreateContainer: jest.fn().mockResolvedValue(container),
      startCreateContainer: jest.fn().mockReturnValue(never),
    };
    const createService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      {} as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const getSessionContainer = jest.spyOn(
      createService as any,
      'getSessionContainer',
    );
    const result = await createService.startCreate();

    const status = await createService.status(result.sessionId || '');

    expect(status).toEqual(
      expect.objectContaining({
        errorMessage: 'NapCat 正在创建登录容器，请稍后',
        mode: 'create',
        qrcode: undefined,
        status: 'pending',
      }),
    );
    expect(getSessionContainer).not.toHaveBeenCalled();
  });

  it('recovers stale create login preparation after the background task was lost', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6105/',
      id: 'container-create-stale',
      name: 'napcat-create-stale',
      webuiPort: 6105,
    };
    const never = new Promise<never>(() => undefined);
    const containerService = {
      findRuntimeById: jest.fn().mockResolvedValue(container),
      startCreateContainer: jest.fn().mockReturnValue(never),
    };
    const createService = new QqbotNapcatLoginService(
      {
        get: jest.fn((key: string) => {
          if (key === 'QQBOT_NAPCAT_CREATE_PREPARING_STALE_MS') return '1';
          return undefined;
        }),
      } as unknown as ConfigService,
      {} as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (createService as any).createSession({
      container,
      mode: 'create',
      preparingContainer: true,
      status: 'pending',
    });
    const old = Date.now() - 10_000;
    session.createdAt = old;
    session.errorMessage = 'NapCat 正在创建登录容器，请稍后';
    session.expiresAt = Date.now() + 60_000;
    session.lastRestartedAt = old;
    (createService as any).sessions.set(session.id, session);

    const status = await createService.status(session.id);
    await Promise.resolve();
    await Promise.resolve();

    expect(status).toEqual(
      expect.objectContaining({
        errorMessage: 'NapCat 创建任务已恢复，继续创建登录容器',
        mode: 'create',
        status: 'pending',
      }),
    );
    expect(containerService.findRuntimeById).toHaveBeenCalledWith(
      'container-create-stale',
    );
    expect(containerService.startCreateContainer).toHaveBeenCalledWith(
      container,
    );
  });

  it('confirms real login status when quick login reports the account is already logged in', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-quick-already-online',
      name: 'napcat-10001',
    };
    const accountService = {
      ensureScannedAccount: jest.fn().mockResolvedValue('account-1'),
    };
    const containerService = {
      bindAccount: jest.fn().mockResolvedValue(undefined),
      ensureRuntimeLoginEnv: jest.fn(),
      resetRuntimeLoginState: jest.fn(),
      restartRuntimeContainer: jest.fn(),
    };
    const refreshService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      accountService as unknown as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      preparingRelogin: true,
      status: 'pending',
    });
    (refreshService as any).sessions.set(session.id, session);
    mockWebuiLoginPost(refreshService, {
      quickError: 'QQ Is Logined',
    });
    const getLoginStatus = jest
      .spyOn(refreshService as any, 'getLoginStatus')
      .mockResolvedValue({ isLogin: true });
    jest.spyOn(refreshService as any, 'getLoginInfo').mockResolvedValue({
      nickname: 'Kwi',
      online: true,
      uin: '10001',
    });
    const refreshQrcode = jest
      .spyOn(refreshService as any, 'refreshOrGetQrcode')
      .mockResolvedValue('fallback-qrcode');

    await (refreshService as any).prepareReloginQrcode(session, container);

    expect(getLoginStatus).toHaveBeenCalledWith(container, true);
    expect(refreshQrcode).not.toHaveBeenCalled();
    expect(accountService.ensureScannedAccount).toHaveBeenCalledWith({
      accountId: 'account-1',
      name: 'Kwi',
      selfId: '10001',
    });
    expect(containerService.bindAccount).toHaveBeenCalledWith(
      'account-1',
      'container-quick-already-online',
      '10001',
    );
    expect(session.status).toBe('success');
    const events = (refreshService as any).sessionEventLogs.get(session.id);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ step: 'quick-login-start' }),
        expect.objectContaining({
          message: 'NapCat 已登录，已确认真实在线状态',
          step: 'login-success',
        }),
      ]),
    );
  });

  it('confirms real login status when quick login reports already logged in using the NapCat Chinese message', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-quick-already-online-cn',
      name: 'napcat-1914728559',
    };
    const accountService = {
      ensureScannedAccount: jest.fn().mockResolvedValue('account-1'),
    };
    const containerService = {
      bindAccount: jest.fn().mockResolvedValue(undefined),
      resetRuntimeLoginState: jest.fn(),
      restartRuntimeContainer: jest.fn(),
    };
    const refreshService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      accountService as unknown as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '1914728559',
      mode: 'refresh',
      preparingRelogin: true,
      status: 'pending',
    });
    (refreshService as any).sessions.set(session.id, session);
    mockWebuiLoginPost(refreshService, {
      quickError: '当前账号(1914728559)已登录,无法重复登录',
    });
    const getLoginStatus = jest
      .spyOn(refreshService as any, 'getLoginStatus')
      .mockResolvedValue({ isLogin: true });
    jest.spyOn(refreshService as any, 'getLoginInfo').mockResolvedValue({
      nickname: 'Mirror',
      online: true,
      uin: '1914728559',
    });
    const refreshQrcode = jest
      .spyOn(refreshService as any, 'refreshOrGetQrcode')
      .mockResolvedValue('fallback-qrcode');

    await (refreshService as any).prepareReloginQrcode(session, container);

    expect(getLoginStatus).toHaveBeenCalledWith(container, true);
    expect(refreshQrcode).not.toHaveBeenCalled();
    expect(session.status).toBe('success');
    const events = (refreshService as any).sessionEventLogs.get(session.id);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'NapCat 已登录，已确认真实在线状态',
          step: 'login-success',
        }),
      ]),
    );
  });

  it('keeps binding errors terminal after already-logged quick status is confirmed online', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-quick-already-bind-error',
      name: 'napcat-10001',
    };
    const accountService = {
      ensureScannedAccount: jest
        .fn()
        .mockRejectedValue(new Error('账号绑定写入失败')),
    };
    const containerService = {
      bindAccount: jest.fn().mockResolvedValue(undefined),
      resetRuntimeLoginState: jest.fn(),
      restartRuntimeContainer: jest.fn(),
    };
    const refreshService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      accountService as unknown as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      preparingRelogin: true,
      status: 'pending',
    });
    (refreshService as any).sessions.set(session.id, session);
    mockWebuiLoginPost(refreshService, {
      quickError: 'QQ Is Logined',
    });
    jest.spyOn(refreshService as any, 'getLoginStatus').mockResolvedValue({
      isLogin: true,
    });
    jest.spyOn(refreshService as any, 'getLoginInfo').mockResolvedValue({
      nickname: 'Kwi',
      online: true,
      uin: '10001',
    });
    const refreshQrcode = jest
      .spyOn(refreshService as any, 'refreshOrGetQrcode')
      .mockResolvedValue('fallback-qrcode');

    await (refreshService as any).prepareReloginQrcode(session, container);

    expect(refreshQrcode).not.toHaveBeenCalled();
    expect(session.status).toBe('error');
    expect(session.qrcode).toBeUndefined();
    expect(session.errorMessage).toBe('账号绑定写入失败');
    const steps = (
      (refreshService as any).sessionEventLogs.get(session.id) ?? []
    ).map((event: { step: string }) => event.step);
    expect(steps).toContain('quick-login-status-check');
    expect(steps).not.toContain('quick-login-fallback');
    expect(steps).toContain('relogin-error');
  });

  it('monitors a ready qrcode session and publishes login success without frontend polling', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-monitor-qrcode',
      name: 'napcat-monitor-qrcode',
    };
    const accountService = {
      ensureScannedAccount: jest.fn().mockResolvedValue('account-1'),
    };
    const containerService = {
      bindAccount: jest.fn().mockResolvedValue(undefined),
    };
    const monitorService = new QqbotNapcatLoginService(
      {
        get: jest.fn((key: string) =>
          key === 'QQBOT_NAPCAT_LOGIN_POLL_INTERVAL_MS' ? 10 : undefined,
        ),
      } as unknown as ConfigService,
      accountService as unknown as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (monitorService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '1914728559',
      mode: 'refresh',
      qrcode: 'https://txz.qq.com/p?k=ready&f=1600001615',
      status: 'pending',
    });
    (monitorService as any).sessions.set(session.id, session);
    jest
      .spyOn(monitorService as any, 'getSessionContainer')
      .mockResolvedValue(container);
    const getLoginStatus = jest
      .spyOn(monitorService as any, 'getLoginStatus')
      .mockResolvedValue({ isLogin: true });
    jest.spyOn(monitorService as any, 'getLoginInfo').mockResolvedValue({
      nick: 'Mirror',
      online: true,
      uin: '1914728559',
    });

    (monitorService as any).publishScanResultEvent(
      session,
      'qrcode-ready',
      'success',
      '登录二维码已生成',
    );
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(getLoginStatus).toHaveBeenCalledWith(container);
    expect(session.status).toBe('success');
    expect((monitorService as any).sessionEventLogs.get(session.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ step: 'login-success' }),
      ]),
    );
  });

  it('keeps scan pending when NapCat is login-positive before QQ number is readable', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-login-wait-self-id',
      name: 'napcat-login-wait-self-id',
    };
    const accountService = {
      ensureScannedAccount: jest.fn().mockResolvedValue('account-1'),
    };
    const containerService = {
      bindAccount: jest.fn().mockResolvedValue(undefined),
    };
    const loginService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      accountService as unknown as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (loginService as any).createSession({
      container,
      mode: 'create',
      qrcode: 'https://txz.qq.com/p?k=ready&f=1600001615',
      status: 'pending',
    });
    (loginService as any).sessions.set(session.id, session);
    jest
      .spyOn(loginService as any, 'getSessionContainer')
      .mockResolvedValue(container);
    jest
      .spyOn(loginService as any, 'getLoginStatus')
      .mockResolvedValue({ isLogin: true });
    jest.spyOn(loginService as any, 'getLoginInfo').mockResolvedValue({
      nick: 'Mirror',
      online: true,
    });

    const result = await loginService.status(session.id);

    expect(result.status).toBe('pending');
    expect(result.errorMessage).toBe('NapCat 已登录，正在读取 QQ 号');
    expect((loginService as any).sessions.get(session.id)).toEqual(
      expect.objectContaining({
        errorMessage: 'NapCat 已登录，正在读取 QQ 号',
        status: 'pending',
      }),
    );
    expect(accountService.ensureScannedAccount).not.toHaveBeenCalled();
    expect(containerService.bindAccount).not.toHaveBeenCalled();
  });

  it('completes scan after a login-positive session later exposes QQ number', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-login-late-self-id',
      name: 'napcat-login-late-self-id',
    };
    const accountService = {
      ensureScannedAccount: jest.fn().mockResolvedValue('account-1'),
    };
    const containerService = {
      bindAccount: jest.fn().mockResolvedValue(undefined),
    };
    const loginService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      accountService as unknown as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (loginService as any).createSession({
      container,
      mode: 'create',
      qrcode: 'https://txz.qq.com/p?k=ready&f=1600001615',
      status: 'pending',
    });
    (loginService as any).sessions.set(session.id, session);
    jest
      .spyOn(loginService as any, 'getSessionContainer')
      .mockResolvedValue(container);
    jest
      .spyOn(loginService as any, 'getLoginStatus')
      .mockResolvedValue({ isLogin: true });
    jest
      .spyOn(loginService as any, 'getLoginInfo')
      .mockResolvedValueOnce({
        nick: 'Mirror',
        online: true,
      })
      .mockResolvedValueOnce({
        nick: 'Mirror',
        online: true,
        uin: '1914728559',
      });

    const pending = await loginService.status(session.id);
    const completed = await loginService.status(session.id);

    expect(pending.status).toBe('pending');
    expect(completed.status).toBe('success');
    expect(accountService.ensureScannedAccount).toHaveBeenCalledWith({
      name: 'Mirror',
      selfId: '1914728559',
    });
    expect(containerService.bindAccount).toHaveBeenCalledWith(
      'account-1',
      'container-login-late-self-id',
      '1914728559',
    );
    expect(session.loginSelfIdMissingSince).toBeUndefined();
  });

  it('does not let the server-side qrcode monitor extend the original qrcode deadline on temporary errors', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-monitor-temporary-error',
      name: 'napcat-monitor-temporary-error',
    };
    const monitorService = new QqbotNapcatLoginService(
      {
        get: jest.fn((key: string) => {
          if (key === 'QQBOT_NAPCAT_LOGIN_POLL_INTERVAL_MS') return 10;
          if (key === 'NAPCAT_LOGIN_QR_EXPIRE_MS') return 25;
          return undefined;
        }),
      } as unknown as ConfigService,
      {
        ensureScannedAccount: jest.fn().mockResolvedValue('account-1'),
      } as unknown as QqbotAccountService,
      {
        bindAccount: jest.fn().mockResolvedValue(undefined),
      } as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (monitorService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '1914728559',
      mode: 'refresh',
      qrcode: 'https://txz.qq.com/p?k=temporary&f=1600001615',
      status: 'pending',
    });
    (monitorService as any).sessions.set(session.id, session);
    jest
      .spyOn(monitorService as any, 'getSessionContainer')
      .mockResolvedValue(container);
    jest
      .spyOn(monitorService as any, 'getLoginStatus')
      .mockRejectedValue(new Error('NapCat 请求超时'));
    const publishResult = jest.spyOn(
      monitorService as any,
      'publishScanResultEvent',
    );

    (monitorService as any).publishScanResultEvent(
      session,
      'qrcode-ready',
      'success',
      '登录二维码已生成',
    );
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(session.status).toBe('expired');
    expect(publishResult).toHaveBeenCalledWith(
      session,
      'session-expired',
      'error',
      expect.any(String),
    );
  });

  it('refreshes the monitor deadline when a new qrcode is published while a timer is already active', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-monitor-new-qrcode',
      name: 'napcat-monitor-new-qrcode',
    };
    let qrTtlReads = 0;
    const monitorService = new QqbotNapcatLoginService(
      {
        get: jest.fn((key: string) => {
          if (key === 'QQBOT_NAPCAT_LOGIN_POLL_INTERVAL_MS') return 60;
          if (key === 'NAPCAT_LOGIN_QR_EXPIRE_MS') {
            qrTtlReads += 1;
            return qrTtlReads <= 2 ? 25 : 120;
          }
          return undefined;
        }),
      } as unknown as ConfigService,
      {
        ensureScannedAccount: jest.fn().mockResolvedValue('account-1'),
      } as unknown as QqbotAccountService,
      {
        bindAccount: jest.fn().mockResolvedValue(undefined),
      } as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const firstQrcode = 'https://txz.qq.com/p?k=first&f=1600001615';
    const nextQrcode = 'https://txz.qq.com/p?k=next&f=1600001615';
    const session = (monitorService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '1914728559',
      mode: 'refresh',
      qrcode: firstQrcode,
      status: 'pending',
    });
    (monitorService as any).sessions.set(session.id, session);
    jest
      .spyOn(monitorService as any, 'getSessionContainer')
      .mockResolvedValue(container);
    jest.spyOn(monitorService as any, 'getLoginStatus').mockResolvedValue({
      isLogin: false,
      qrcodeurl: nextQrcode,
    });
    const publishResult = jest.spyOn(
      monitorService as any,
      'publishScanResultEvent',
    );

    (monitorService as any).publishScanResultEvent(
      session,
      'qrcode-ready',
      'success',
      '登录二维码已生成',
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    session.qrcode = nextQrcode;
    (monitorService as any).publishScanResultEvent(
      session,
      'qrcode-ready',
      'success',
      '登录二维码已刷新',
    );
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(session.status).toBe('pending');
    expect(
      (monitorService as any).scanStatusMonitorDeadlines[session.id]?.qrcode,
    ).toBe(nextQrcode);
    expect(
      publishResult.mock.calls.some((call) => call[1] === 'session-expired'),
    ).toBe(false);
    (monitorService as any).sessions.clear();
  });

  it('does not rebuild even when the refresh session already has a rebuild count', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-rebuild-budget',
      name: 'napcat-10001',
    };
    const containerService = {
      ensureRuntimeLoginEnv: jest
        .fn()
        .mockResolvedValue({ changed: false, ok: true }),
      resetRuntimeLoginState: jest.fn().mockResolvedValue(true),
      restartRuntimeContainer: jest.fn().mockResolvedValue(true),
    };
    const refreshService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      {} as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      preparingRelogin: true,
      runtimeRebuildCount: 1,
      status: 'pending',
    });
    (refreshService as any).sessions.set(session.id, session);
    jest
      .spyOn((refreshService as any).toolsService, 'sleep')
      .mockResolvedValue(undefined);
    jest.spyOn(refreshService as any, 'getLoginStatus').mockResolvedValue({
      isLogin: false,
      loginError: '快速登录未成功',
    });
    mockWebuiLoginPost(refreshService, {
      quickError: '快速登录未成功',
    });
    jest
      .spyOn(refreshService as any, 'refreshOrGetQrcode')
      .mockResolvedValue('budget-qrcode');

    await (refreshService as any).prepareReloginQrcode(session, container);

    expect(containerService.resetRuntimeLoginState).not.toHaveBeenCalled();
    expect(containerService.restartRuntimeContainer).not.toHaveBeenCalled();
    expect(session.status).toBe('pending');
    expect(session.qrcode).toBe('budget-qrcode');
  });

  it('restarts the NapCat worker before refreshing qrcode when source Docker is online but QQ is offline', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-online-source',
      name: 'napcat-10001',
      sourceContainerOnline: true,
    };
    const containerService = {
      ensureRuntimeLoginEnv: jest
        .fn()
        .mockResolvedValue({ changed: false, ok: true }),
      findRuntimeById: jest.fn().mockResolvedValue(container),
      resetRuntimeLoginState: jest.fn().mockResolvedValue(true),
      restartRuntimeContainer: jest.fn().mockResolvedValue(true),
    };
    const accountService = {
      ensureScannedAccount: jest.fn().mockResolvedValue('account-1'),
    };
    const refreshService = new QqbotNapcatLoginService(
      {
        get: jest.fn((key: string) =>
          key === 'NAPCAT_WEBUI_RESTART_DELAY_MS' ? '1' : undefined,
        ),
      } as unknown as ConfigService,
      accountService as unknown as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      preparingRelogin: false,
      sourceContainerOnline: true,
      status: 'pending',
    });
    (refreshService as any).sessions.set(session.id, session);
    jest
      .spyOn((refreshService as any).toolsService, 'sleep')
      .mockResolvedValue(undefined);
    jest.spyOn(refreshService as any, 'getLoginStatus').mockResolvedValue({
      isOffline: true,
      isLogin: false,
      loginError: 'NapCat 账号状态变更为离线',
    });
    const refreshOrGetQrcode = jest
      .spyOn(refreshService as any, 'refreshOrGetQrcode')
      .mockResolvedValue('online-source-qrcode');
    const postNapcat = mockWebuiLoginPost(refreshService);

    const result = await refreshService.refreshQrcode(session.id);

    expect(containerService.resetRuntimeLoginState).not.toHaveBeenCalled();
    expect(containerService.restartRuntimeContainer).not.toHaveBeenCalled();
    expect(postNapcat).toHaveBeenCalledWith(
      container,
      '/api/QQLogin/RestartNapCat',
    );
    expect(refreshOrGetQrcode).toHaveBeenCalledWith(container, false, {
      fallbackStatus: expect.objectContaining({ isOffline: true }),
      requireFresh: true,
      staleQrcode: undefined,
    });
    expect(result.status).toBe('pending');
    expect(result.qrcode).toBe('online-source-qrcode');
  });

  it('does not restart the NapCat worker repeatedly for the same online-source refresh session', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-online-source',
      name: 'napcat-10001',
      sourceContainerOnline: true,
    };
    const containerService = {
      ensureRuntimeLoginEnv: jest
        .fn()
        .mockResolvedValue({ changed: false, ok: true }),
      findRuntimeById: jest.fn().mockResolvedValue(container),
      resetRuntimeLoginState: jest.fn().mockResolvedValue(true),
      restartRuntimeContainer: jest.fn().mockResolvedValue(true),
    };
    const accountService = {
      ensureScannedAccount: jest.fn().mockResolvedValue('account-1'),
    };
    const refreshService = new QqbotNapcatLoginService(
      {
        get: jest.fn((key: string) =>
          key === 'NAPCAT_WEBUI_RESTART_DELAY_MS' ? '1' : undefined,
        ),
      } as unknown as ConfigService,
      accountService as unknown as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      preparingRelogin: false,
      sourceContainerOnline: true,
      status: 'pending',
    });
    (refreshService as any).sessions.set(session.id, session);
    jest
      .spyOn((refreshService as any).toolsService, 'sleep')
      .mockResolvedValue(undefined);
    jest.spyOn(refreshService as any, 'getLoginStatus').mockResolvedValue({
      isOffline: true,
      isLogin: false,
      loginError: 'NapCat 账号状态变更为离线',
    });
    jest
      .spyOn(refreshService as any, 'refreshOrGetQrcode')
      .mockResolvedValue('online-source-qrcode');
    const postNapcat = mockWebuiLoginPost(refreshService);

    await refreshService.refreshQrcode(session.id);
    await refreshService.refreshQrcode(session.id);

    expect(containerService.restartRuntimeContainer).not.toHaveBeenCalled();
    expect(
      postNapcat.mock.calls.filter(
        ([, path]) => path === '/api/QQLogin/RestartNapCat',
      ),
    ).toHaveLength(1);
  });

  it('does not perform runtime env rebuild inside the refresh session', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-env-budget',
      name: 'napcat-10001',
    };
    const containerService = {
      bindAccount: jest.fn().mockResolvedValue(undefined),
      ensureRuntimeLoginEnv: jest.fn(),
      resetRuntimeLoginState: jest.fn().mockResolvedValue(true),
      restartRuntimeContainer: jest.fn().mockResolvedValue(true),
      runtimeLoginEnvMatches: jest.fn().mockResolvedValue(false),
    };
    const accountService = {
      ensureScannedAccount: jest.fn().mockResolvedValue('account-1'),
    };
    const refreshService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      accountService as unknown as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      preparingRelogin: true,
      runtimeRebuildCount: 1,
      status: 'pending',
    });
    (refreshService as any).sessions.set(session.id, session);
    jest
      .spyOn(refreshService as any, 'getLoginStatus')
      .mockResolvedValueOnce({
        isLogin: false,
        loginError: '快速登录未找到历史会话',
      })
      .mockResolvedValueOnce({
        isLogin: true,
      });
    jest.spyOn(refreshService as any, 'getLoginInfo').mockResolvedValue({
      nickname: 'Kwi',
      online: true,
      uin: '10001',
    });
    mockWebuiLoginPost(refreshService);

    await (refreshService as any).prepareReloginQrcode(
      session,
      container,
      'qq-password',
    );

    expect(containerService.runtimeLoginEnvMatches).not.toHaveBeenCalled();
    expect(containerService.ensureRuntimeLoginEnv).not.toHaveBeenCalled();
    expect(containerService.resetRuntimeLoginState).not.toHaveBeenCalled();
    expect(accountService.ensureScannedAccount).toHaveBeenCalledWith({
      accountId: 'account-1',
      name: 'Kwi',
      selfId: '10001',
    });
    expect(session.status).toBe('success');
  });

  it('prepares qrcode through WebUI when the source Docker container is online', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-online-env',
      name: 'napcat-10001',
      sourceContainerOnline: true,
    };
    const containerService = {
      ensureRuntimeLoginEnv: jest.fn(),
      resetRuntimeLoginState: jest.fn().mockResolvedValue(true),
      restartRuntimeContainer: jest.fn().mockResolvedValue(true),
      runtimeLoginEnvMatches: jest.fn().mockResolvedValue(false),
    };
    const accountService = {
      ensureScannedAccount: jest.fn().mockResolvedValue('account-1'),
    };
    const refreshService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      accountService as unknown as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      preparingRelogin: true,
      sourceContainerOnline: true,
      status: 'pending',
    });
    (refreshService as any).sessions.set(session.id, session);
    jest.spyOn(refreshService as any, 'getLoginStatus').mockResolvedValue({
      isOffline: true,
      isLogin: false,
      loginError: 'Docker 容器在线但 QQ 账号离线',
    });
    const postNapcat = mockWebuiLoginPost(refreshService, {
      quickError: '快速登录未成功',
    });
    jest
      .spyOn(refreshService as any, 'refreshOrGetQrcode')
      .mockResolvedValue('online-source-qrcode');

    await (refreshService as any).prepareReloginQrcode(session, container);

    expect(containerService.ensureRuntimeLoginEnv).not.toHaveBeenCalled();
    expect(containerService.runtimeLoginEnvMatches).not.toHaveBeenCalled();
    expect(containerService.resetRuntimeLoginState).not.toHaveBeenCalled();
    expect(containerService.restartRuntimeContainer).not.toHaveBeenCalled();
    expect(postNapcat.mock.calls.map(([, path]) => path)).toEqual([
      '/api/QQLogin/RestartNapCat',
      '/api/QQLogin/SetQuickLogin',
    ]);
    expect(session.status).toBe('pending');
    expect(session.qrcode).toBe('online-source-qrcode');
  });

  it('tries password login after quick login fails and before qrcode fallback', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-password',
      name: 'napcat-10001',
    };
    const accountService = {
      ensureScannedAccount: jest.fn().mockResolvedValue('account-1'),
    };
    const containerService = {
      bindAccount: jest.fn().mockResolvedValue(undefined),
      ensureRuntimeLoginEnv: jest
        .fn()
        .mockResolvedValue({ changed: false, ok: true }),
      resetRuntimeLoginState: jest.fn().mockResolvedValue(true),
      restartRuntimeContainer: jest.fn().mockResolvedValue(true),
    };
    const refreshService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      accountService as unknown as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      preparingRelogin: true,
      status: 'pending',
    });
    (refreshService as any).sessions.set(session.id, session);
    jest
      .spyOn((refreshService as any).toolsService, 'sleep')
      .mockResolvedValue(undefined);
    const postNapcat = jest
      .spyOn(refreshService as any, 'postNapcat')
      .mockImplementation(async (_container: unknown, path: string) => {
        if (path === '/api/QQLogin/SetQuickLogin') {
          throw new Error('快速登录未找到历史会话');
        }
        if (path === '/api/QQLogin/PasswordLogin') return null;
        return null;
      });
    jest.spyOn(refreshService as any, 'getLoginStatus').mockResolvedValueOnce({
      isLogin: true,
    });
    jest.spyOn(refreshService as any, 'getLoginInfo').mockResolvedValue({
      nickname: 'Kwi',
      online: true,
      uin: '10001',
    });
    const refreshQrcode = jest
      .spyOn(refreshService as any, 'refreshOrGetQrcode')
      .mockResolvedValue('fallback-qrcode');

    await (refreshService as any).prepareReloginQrcode(
      session,
      container,
      'qq-password',
    );

    expect(postNapcat).toHaveBeenCalledWith(
      container,
      '/api/QQLogin/SetQuickLogin',
      { uin: '10001' },
    );
    expect(postNapcat).toHaveBeenCalledWith(
      container,
      '/api/QQLogin/PasswordLogin',
      {
        passwordMd5: '7fe1f9ae1130b64e9ca1441492c382c0',
        uin: '10001',
      },
    );
    expect(containerService.ensureRuntimeLoginEnv).not.toHaveBeenCalled();
    expect(containerService.restartRuntimeContainer).not.toHaveBeenCalled();
    expect(containerService.resetRuntimeLoginState).not.toHaveBeenCalled();
    expect(refreshQrcode).not.toHaveBeenCalled();
    expect(accountService.ensureScannedAccount).toHaveBeenCalledWith({
      accountId: 'account-1',
      name: 'Kwi',
      selfId: '10001',
    });
    expect(session.status).toBe('success');
    const steps = (
      (refreshService as any).sessionEventLogs.get(session.id) ?? []
    ).map((event: { step: string }) => event.step);
    expect(steps).toEqual(
      expect.arrayContaining([
        'quick-login-start',
        'quick-login-fallback',
        'password-login-start',
        'password-login-wait',
        'login-success',
      ]),
    );
    expect(steps.indexOf('quick-login-fallback')).toBeLessThan(
      steps.indexOf('password-login-start'),
    );
    expect(steps.indexOf('password-login-start')).toBeLessThan(
      steps.indexOf('login-success'),
    );
  });

  it('waits for password login to finish instead of falling back on the first pending status', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-password-wait',
      name: 'napcat-10001',
    };
    const accountService = {
      ensureScannedAccount: jest.fn().mockResolvedValue('account-1'),
    };
    const containerService = {
      bindAccount: jest.fn().mockResolvedValue(undefined),
      ensureRuntimeLoginEnv: jest
        .fn()
        .mockResolvedValue({ changed: false, ok: true }),
      resetRuntimeLoginState: jest.fn().mockResolvedValue(true),
      restartRuntimeContainer: jest.fn().mockResolvedValue(true),
    };
    const refreshService = new QqbotNapcatLoginService(
      {
        get: jest.fn((key: string) => {
          const values: Record<string, string> = {
            QQBOT_NAPCAT_LOGIN_POLL_INTERVAL_MS: '1',
            QQBOT_NAPCAT_PASSWORD_LOGIN_WAIT_MS: '3',
            QQBOT_NAPCAT_QUICK_LOGIN_WAIT_MS: '1',
          };
          return values[key] || '';
        }),
      } as unknown as ConfigService,
      accountService as unknown as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      preparingRelogin: true,
      status: 'pending',
    });
    (refreshService as any).sessions.set(session.id, session);
    jest
      .spyOn((refreshService as any).toolsService, 'sleep')
      .mockResolvedValue(undefined);
    jest
      .spyOn(refreshService as any, 'getLoginStatus')
      .mockResolvedValueOnce({
        isLogin: false,
        loginError: '快速登录未找到历史会话',
      })
      .mockResolvedValueOnce({
        isLogin: false,
        loginError: '密码登录处理中',
      })
      .mockResolvedValueOnce({
        isLogin: false,
        loginError: '密码登录处理中',
      })
      .mockResolvedValueOnce({
        isLogin: true,
      });
    jest.spyOn(refreshService as any, 'getLoginInfo').mockResolvedValue({
      nickname: 'Kwi',
      online: true,
      uin: '10001',
    });
    const refreshQrcode = jest
      .spyOn(refreshService as any, 'refreshOrGetQrcode')
      .mockResolvedValue('fallback-qrcode');
    mockWebuiLoginPost(refreshService);

    await (refreshService as any).prepareReloginQrcode(
      session,
      container,
      'qq-password',
    );

    expect(refreshQrcode).not.toHaveBeenCalled();
    expect(accountService.ensureScannedAccount).toHaveBeenCalledWith({
      accountId: 'account-1',
      name: 'Kwi',
      selfId: '10001',
    });
    expect(session.status).toBe('success');
  });

  it('keeps password login pending when QQ requires captcha verification from login status', async () => {
    const captchaUrl =
      'https://ti.qq.com/safe/tools/captcha/sms-verify-login?uin=10001';
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-password-captcha',
      name: 'napcat-10001',
    };
    const containerService = {
      ensureRuntimeLoginEnv: jest
        .fn()
        .mockResolvedValue({ changed: false, ok: true }),
      resetRuntimeLoginState: jest.fn().mockResolvedValue(true),
      restartRuntimeContainer: jest.fn().mockResolvedValue(true),
    };
    const refreshService = new QqbotNapcatLoginService(
      {
        get: jest.fn((key: string) => {
          const values: Record<string, string> = {
            QQBOT_NAPCAT_LOGIN_POLL_INTERVAL_MS: '1',
            QQBOT_NAPCAT_PASSWORD_LOGIN_WAIT_MS: '1',
            QQBOT_NAPCAT_QUICK_LOGIN_WAIT_MS: '1',
          };
          return values[key] || '';
        }),
      } as unknown as ConfigService,
      {} as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      preparingRelogin: true,
      status: 'pending',
    });
    (refreshService as any).sessions.set(session.id, session);
    jest
      .spyOn((refreshService as any).toolsService, 'sleep')
      .mockResolvedValue(undefined);
    jest
      .spyOn(refreshService as any, 'getLoginStatus')
      .mockResolvedValueOnce({
        isLogin: false,
        loginError: '快速登录未找到历史会话',
      })
      .mockResolvedValueOnce({
        isLogin: false,
        loginError: `需要验证码, proofWaterUrl:  ${captchaUrl}`,
      });
    const refreshQrcode = jest
      .spyOn(refreshService as any, 'refreshOrGetQrcode')
      .mockResolvedValue('fallback-qrcode');
    mockWebuiLoginPost(refreshService);

    await (refreshService as any).prepareReloginQrcode(
      session,
      container,
      'qq-password',
    );

    expect(refreshQrcode).not.toHaveBeenCalled();
    expect(containerService.resetRuntimeLoginState).not.toHaveBeenCalled();
    expect(session.status).toBe('pending');
    expect(session.captchaUrl).toBe(captchaUrl);
    expect(session.preparingRelogin).toBe(false);
    expect(session.errorMessage).toContain('需要完成 QQ 安全验证');
    const steps = (
      (refreshService as any).sessionEventLogs.get(session.id) ?? []
    ).map((event: { step: string }) => event.step);
    expect(steps).toContain('password-login-captcha');
    expect(steps).not.toContain('relogin-reset-start');
  });

  it('keeps password login pending when QQ captcha URL is only in runtime logs', async () => {
    const captchaUrl =
      'https://ti.qq.com/safe/tools/captcha/sms-verify-login?uin=10001';
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-password-captcha-log',
      name: 'napcat-10001',
    };
    const containerService = {
      detectRuntimeCaptchaUrl: jest.fn().mockResolvedValue(captchaUrl),
      ensureRuntimeLoginEnv: jest
        .fn()
        .mockResolvedValue({ changed: false, ok: true }),
      resetRuntimeLoginState: jest.fn().mockResolvedValue(true),
      restartRuntimeContainer: jest.fn().mockResolvedValue(true),
    };
    const refreshService = new QqbotNapcatLoginService(
      {
        get: jest.fn((key: string) => {
          const values: Record<string, string> = {
            QQBOT_NAPCAT_LOGIN_POLL_INTERVAL_MS: '1',
            QQBOT_NAPCAT_PASSWORD_LOGIN_WAIT_MS: '1',
            QQBOT_NAPCAT_QUICK_LOGIN_WAIT_MS: '1',
          };
          return values[key] || '';
        }),
      } as unknown as ConfigService,
      {} as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      preparingRelogin: true,
      status: 'pending',
    });
    (refreshService as any).sessions.set(session.id, session);
    jest
      .spyOn((refreshService as any).toolsService, 'sleep')
      .mockResolvedValue(undefined);
    jest
      .spyOn(refreshService as any, 'getLoginStatus')
      .mockResolvedValueOnce({
        isLogin: false,
        loginError: '快速登录未找到历史会话',
      })
      .mockResolvedValueOnce({
        isLogin: false,
        loginError: '密码登录处理中',
      });
    const refreshQrcode = jest
      .spyOn(refreshService as any, 'refreshOrGetQrcode')
      .mockResolvedValue('fallback-qrcode');
    mockWebuiLoginPost(refreshService);

    await (refreshService as any).prepareReloginQrcode(
      session,
      container,
      'qq-password',
    );

    expect(containerService.detectRuntimeCaptchaUrl).toHaveBeenCalledWith(
      container,
      expect.any(Number),
    );
    expect(refreshQrcode).not.toHaveBeenCalled();
    expect(session.status).toBe('pending');
    expect(session.captchaUrl).toBe(captchaUrl);
  });

  it('waits briefly for captcha URL when captcha status arrives before runtime log URL', async () => {
    const captchaUrl =
      'https://ti.qq.com/safe/tools/captcha/sms-verify-login?uin=10001';
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-password-captcha-delayed-log',
      name: 'napcat-10001',
    };
    let captchaLogVisible = false;
    let captchaStatusSeen = false;
    const containerService = {
      detectRuntimeCaptchaUrl: jest
        .fn()
        .mockImplementation(async () =>
          captchaLogVisible ? captchaUrl : null,
        ),
      ensureRuntimeLoginEnv: jest
        .fn()
        .mockResolvedValue({ changed: true, ok: true }),
      resetRuntimeLoginState: jest.fn().mockResolvedValue(true),
      restartRuntimeContainer: jest.fn().mockResolvedValue(true),
    };
    const refreshService = new QqbotNapcatLoginService(
      {
        get: jest.fn((key: string) => {
          const values: Record<string, string> = {
            QQBOT_NAPCAT_LOGIN_POLL_INTERVAL_MS: '1',
            QQBOT_NAPCAT_PASSWORD_LOGIN_WAIT_MS: '1',
            QQBOT_NAPCAT_QUICK_LOGIN_WAIT_MS: '1',
          };
          return values[key] || '';
        }),
      } as unknown as ConfigService,
      {} as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      preparingRelogin: true,
      status: 'pending',
    });
    (refreshService as any).sessions.set(session.id, session);
    jest
      .spyOn((refreshService as any).toolsService, 'sleep')
      .mockImplementation(async () => {
        if (captchaStatusSeen) captchaLogVisible = true;
      });
    jest
      .spyOn(refreshService as any, 'getLoginStatus')
      .mockResolvedValueOnce({
        isLogin: false,
        loginError: '快速登录未找到历史会话',
      })
      .mockImplementationOnce(async () => {
        captchaStatusSeen = true;
        return {
          isLogin: false,
          loginError: '密码回退需要验证码，请在 WebUi 中继续完成验证',
        };
      });
    const refreshQrcode = jest
      .spyOn(refreshService as any, 'refreshOrGetQrcode')
      .mockResolvedValue('fallback-qrcode');
    mockWebuiLoginPost(refreshService);

    await (refreshService as any).prepareReloginQrcode(
      session,
      container,
      'qq-password',
    );

    expect(refreshQrcode).not.toHaveBeenCalled();
    expect(session.status).toBe('pending');
    expect(session.captchaUrl).toBe(captchaUrl);
    expect(containerService.resetRuntimeLoginState).not.toHaveBeenCalled();
  });

  it('anchors password captcha log lookup before runtime env rebuild', async () => {
    const captchaUrl =
      'https://ti.qq.com/safe/tools/captcha/sms-verify-login?uin=10001';
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-password-log-window',
      name: 'napcat-10001',
    };
    const passwordLogSinceMs = 1000;
    const envRebuildStartedAt = 5000;
    let envRebuildStarted = false;
    const containerService = {
      ensureRuntimeLoginEnv: jest.fn().mockImplementation(async () => {
        envRebuildStarted = true;
        return { changed: true, ok: true };
      }),
      restartRuntimeContainer: jest.fn().mockResolvedValue(true),
    };
    const refreshService = new QqbotNapcatLoginService(
      {
        get: jest.fn((key: string) => {
          const values: Record<string, string> = {
            QQBOT_NAPCAT_LOGIN_POLL_INTERVAL_MS: '1',
            QQBOT_NAPCAT_PASSWORD_LOGIN_WAIT_MS: '1',
          };
          return values[key] || '';
        }),
      } as unknown as ConfigService,
      {} as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      preparingRelogin: true,
      status: 'pending',
    });
    jest
      .spyOn(Date, 'now')
      .mockImplementation(() =>
        envRebuildStarted ? envRebuildStartedAt : passwordLogSinceMs,
      );
    jest
      .spyOn(refreshService as any, 'waitForPasswordLoginStatus')
      .mockResolvedValue({
        isLogin: false,
        loginError: '密码回退需要验证码，请在 WebUi 中继续完成验证',
      });
    jest
      .spyOn(refreshService as any, 'resolvePasswordCaptchaUrl')
      .mockResolvedValue(captchaUrl);
    mockWebuiLoginPost(refreshService);

    const result = await (refreshService as any).tryPasswordRelogin(
      session,
      container,
      'qq-password',
    );

    expect(result).toBe(true);
    expect(
      (refreshService as any).waitForPasswordLoginStatus,
    ).toHaveBeenCalledWith(container, passwordLogSinceMs);
    expect(
      (refreshService as any).resolvePasswordCaptchaUrl,
    ).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ isLogin: false }),
      passwordLogSinceMs,
    );
    expect(session.lastRestartedAt).toBe(passwordLogSinceMs);
    expect(session.captchaUrl).toBe(captchaUrl);
  });

  it('does not keep stale captcha from tail logs when current password status is processing', async () => {
    const staleCaptchaUrl =
      'https://ti.qq.com/safe/tools/captcha/sms-verify-login?uin=10001';
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-password-stale-captcha',
      name: 'napcat-10001',
    };
    const containerService = {
      detectRuntimeCaptchaUrl: jest
        .fn()
        .mockImplementation(async (_runtime: unknown, sinceMs?: number) =>
          typeof sinceMs === 'number' ? null : staleCaptchaUrl,
        ),
      ensureRuntimeLoginEnv: jest
        .fn()
        .mockResolvedValue({ changed: false, ok: true }),
      resetRuntimeLoginState: jest.fn().mockResolvedValue(true),
      restartRuntimeContainer: jest.fn().mockResolvedValue(true),
    };
    const refreshService = new QqbotNapcatLoginService(
      {
        get: jest.fn((key: string) => {
          const values: Record<string, string> = {
            QQBOT_NAPCAT_LOGIN_POLL_INTERVAL_MS: '1',
            QQBOT_NAPCAT_PASSWORD_LOGIN_WAIT_MS: '1',
            QQBOT_NAPCAT_QUICK_LOGIN_WAIT_MS: '1',
          };
          return values[key] || '';
        }),
      } as unknown as ConfigService,
      {} as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      preparingRelogin: true,
      status: 'pending',
    });
    (refreshService as any).sessions.set(session.id, session);
    jest
      .spyOn((refreshService as any).toolsService, 'sleep')
      .mockResolvedValue(undefined);
    jest
      .spyOn(refreshService as any, 'getLoginStatus')
      .mockResolvedValueOnce({
        isLogin: false,
        loginError: '快速登录未找到历史会话',
      })
      .mockResolvedValueOnce({
        isLogin: false,
        loginError: '密码登录处理中',
      });
    jest
      .spyOn(refreshService as any, 'refreshOrGetQrcode')
      .mockResolvedValue('fallback-qrcode');
    mockWebuiLoginPost(refreshService);

    await (refreshService as any).prepareReloginQrcode(
      session,
      container,
      'qq-password',
    );

    expect(session.captchaUrl).toBeUndefined();
    expect(containerService.detectRuntimeCaptchaUrl).toHaveBeenCalledTimes(2);
    expect(containerService.detectRuntimeCaptchaUrl).not.toHaveBeenCalledWith(
      container,
    );
    expect(session.qrcode).toBe('fallback-qrcode');
  });

  it('does not read tail captcha logs for processing status without restart timestamp', async () => {
    const staleCaptchaUrl =
      'https://ti.qq.com/safe/tools/captcha/sms-verify-login?uin=10001';
    const containerService = {
      detectRuntimeCaptchaUrl: jest.fn().mockResolvedValue(staleCaptchaUrl),
    };
    const refreshService = new QqbotNapcatLoginService(
      {
        get: jest.fn((key: string) => {
          const values: Record<string, string> = {
            QQBOT_NAPCAT_LOGIN_POLL_INTERVAL_MS: '1',
            QQBOT_NAPCAT_PASSWORD_LOGIN_WAIT_MS: '1',
          };
          return values[key] || '';
        }),
      } as unknown as ConfigService,
      {} as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    jest
      .spyOn((refreshService as any).toolsService, 'sleep')
      .mockResolvedValue(undefined);
    jest.spyOn(refreshService as any, 'getLoginStatus').mockResolvedValue({
      isLogin: false,
      loginError: '密码登录处理中',
    });

    const status = await (refreshService as any).waitForPasswordLoginStatus({
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-stale-tail-no-since',
      name: 'napcat-10001',
      webuiToken: 'token',
    });

    expect(status.captchaUrl).toBeUndefined();
    expect(containerService.detectRuntimeCaptchaUrl).not.toHaveBeenCalled();
  });

  it('keeps password captcha pending before cleanup when status check throws captcha error', async () => {
    const captchaUrl =
      'https://ti.qq.com/safe/tools/captcha/sms-verify-login?uin=10001';
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-password-captcha-error',
      name: 'napcat-10001',
    };
    const ensureRuntimeLoginEnv = jest.fn().mockResolvedValue({
      changed: true,
      ok: true,
    });
    const containerService = {
      detectRuntimeCaptchaUrl: jest.fn().mockImplementation(async () => {
        const cleanedPasswordBeforeLogRead = ensureRuntimeLoginEnv.mock.calls
          .slice(1)
          .some(([, options]) => options?.clearLoginPassword === true);
        return cleanedPasswordBeforeLogRead ? '' : captchaUrl;
      }),
      ensureRuntimeLoginEnv,
      resetRuntimeLoginState: jest.fn().mockResolvedValue(true),
      restartRuntimeContainer: jest.fn().mockResolvedValue(true),
    };
    const refreshService = new QqbotNapcatLoginService(
      {
        get: jest.fn((key: string) => {
          const values: Record<string, string> = {
            QQBOT_NAPCAT_LOGIN_POLL_INTERVAL_MS: '1',
            QQBOT_NAPCAT_PASSWORD_LOGIN_WAIT_MS: '1',
            QQBOT_NAPCAT_QUICK_LOGIN_WAIT_MS: '1',
          };
          return values[key] || '';
        }),
      } as unknown as ConfigService,
      {} as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      preparingRelogin: true,
      status: 'pending',
    });
    (refreshService as any).sessions.set(session.id, session);
    jest
      .spyOn((refreshService as any).toolsService, 'sleep')
      .mockResolvedValue(undefined);
    jest
      .spyOn(refreshService as any, 'getLoginStatus')
      .mockResolvedValueOnce({
        isLogin: false,
        loginError: '快速登录未找到历史会话',
      })
      .mockRejectedValueOnce(
        new Error('密码回退需要验证码，请在 WebUi 中继续完成验证'),
      );
    const refreshQrcode = jest
      .spyOn(refreshService as any, 'refreshOrGetQrcode')
      .mockResolvedValue('fallback-qrcode');
    mockWebuiLoginPost(refreshService);

    await (refreshService as any).prepareReloginQrcode(
      session,
      container,
      'qq-password',
    );

    expect(containerService.detectRuntimeCaptchaUrl).toHaveBeenCalledWith(
      container,
      expect.any(Number),
    );
    expect(refreshQrcode).not.toHaveBeenCalled();
    expect(containerService.resetRuntimeLoginState).not.toHaveBeenCalled();
    expect(ensureRuntimeLoginEnv).not.toHaveBeenCalled();
    expect(session.status).toBe('pending');
    expect(session.captchaUrl).toBe(captchaUrl);
    expect(session.passwordMd5).toBeTruthy();
    expect(session.errorMessage).toContain('需要完成 QQ 安全验证');
  });

  it('keeps qrcode pending when password login falls into NapCat qrcode status', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-password-qrcode',
      name: 'napcat-10001',
    };
    const containerService = {
      ensureRuntimeLoginEnv: jest
        .fn()
        .mockResolvedValueOnce({ changed: false, ok: true })
        .mockResolvedValueOnce({ changed: true, ok: true })
        .mockResolvedValueOnce({ changed: true, ok: true }),
      resetRuntimeLoginState: jest.fn().mockResolvedValue(true),
      restartRuntimeContainer: jest.fn().mockResolvedValue(true),
    };
    const refreshService = new QqbotNapcatLoginService(
      {
        get: jest.fn((key: string) => {
          const values: Record<string, string> = {
            QQBOT_NAPCAT_LOGIN_POLL_INTERVAL_MS: '1',
            QQBOT_NAPCAT_PASSWORD_LOGIN_WAIT_MS: '10',
            QQBOT_NAPCAT_QUICK_LOGIN_WAIT_MS: '1',
          };
          return values[key] || '';
        }),
      } as unknown as ConfigService,
      {} as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      preparingRelogin: true,
      status: 'pending',
    });
    (refreshService as any).sessions.set(session.id, session);
    jest
      .spyOn((refreshService as any).toolsService, 'sleep')
      .mockResolvedValue(undefined);
    jest
      .spyOn(refreshService as any, 'getLoginStatus')
      .mockResolvedValueOnce({
        isLogin: false,
        loginError: '快速登录未找到历史会话',
      })
      .mockResolvedValueOnce({
        isLogin: false,
        loginError: '二维码已过期，请刷新',
        qrcodeurl: 'expired-qrcode',
      });
    const refreshQrcode = jest
      .spyOn(refreshService as any, 'refreshOrGetQrcode')
      .mockResolvedValue('fresh-qrcode');
    mockWebuiLoginPost(refreshService);

    await (refreshService as any).prepareReloginQrcode(
      session,
      container,
      'qq-password',
    );

    expect(containerService.resetRuntimeLoginState).not.toHaveBeenCalled();
    expect(refreshQrcode).toHaveBeenCalledWith(
      container,
      true,
      expect.objectContaining({
        requireFresh: true,
        staleQrcode: 'expired-qrcode',
      }),
    );
    expect(session.status).toBe('pending');
    expect(session.captchaUrl).toBeUndefined();
    expect(session.passwordMd5).toBeUndefined();
    expect(session.qrcode).toBe('fresh-qrcode');
    const steps = (
      (refreshService as any).sessionEventLogs.get(session.id) ?? []
    ).map((event: { step: string }) => event.step);
    expect(steps).toContain('password-login-qrcode');
    expect(steps).not.toContain('relogin-reset-start');
  });

  it('prioritizes current qrcode status over stale captcha URL in runtime logs', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-password-qrcode-over-captcha-log',
      name: 'napcat-10001',
    };
    const containerService = {
      detectRuntimeCaptchaUrl: jest
        .fn()
        .mockResolvedValue(
          'https://ti.qq.com/safe/tools/captcha/sms-verify-login?uin=10001',
        ),
      ensureRuntimeLoginEnv: jest
        .fn()
        .mockResolvedValueOnce({ changed: false, ok: true })
        .mockResolvedValueOnce({ changed: true, ok: true })
        .mockResolvedValueOnce({ changed: true, ok: true }),
      resetRuntimeLoginState: jest.fn().mockResolvedValue(true),
      restartRuntimeContainer: jest.fn().mockResolvedValue(true),
    };
    const refreshService = new QqbotNapcatLoginService(
      {
        get: jest.fn((key: string) => {
          const values: Record<string, string> = {
            QQBOT_NAPCAT_LOGIN_POLL_INTERVAL_MS: '1',
            QQBOT_NAPCAT_PASSWORD_LOGIN_WAIT_MS: '10',
          };
          return values[key] || '';
        }),
      } as unknown as ConfigService,
      {} as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      preparingRelogin: true,
      status: 'pending',
    });
    (refreshService as any).sessions.set(session.id, session);
    jest
      .spyOn((refreshService as any).toolsService, 'sleep')
      .mockResolvedValue(undefined);
    jest
      .spyOn(refreshService as any, 'getLoginStatus')
      .mockResolvedValueOnce({
        isLogin: false,
        loginError: '快速登录未找到历史会话',
      })
      .mockResolvedValueOnce({
        isLogin: false,
        loginError: '二维码已过期，请刷新',
        qrcodeurl: 'expired-qrcode',
      });
    jest
      .spyOn(refreshService as any, 'refreshOrGetQrcode')
      .mockResolvedValue('fresh-qrcode');

    await (refreshService as any).prepareReloginQrcode(
      session,
      container,
      'qq-password',
    );

    expect(containerService.detectRuntimeCaptchaUrl).not.toHaveBeenCalled();
    expect(session.status).toBe('pending');
    expect(session.captchaUrl).toBeUndefined();
    expect(session.qrcode).toBe('fresh-qrcode');
  });

  it('submits captcha result back to NapCat and completes password login', async () => {
    const accountService = {
      ensureScannedAccount: jest.fn().mockResolvedValue('account-1'),
    };
    const containerService = {
      bindAccount: jest.fn().mockResolvedValue(undefined),
      findRuntimeById: jest.fn().mockResolvedValue({
        baseUrl: 'http://127.0.0.1:6103/',
        id: 'container-captcha-submit',
        name: 'napcat-10001',
      }),
      removeUnboundContainer: jest.fn().mockResolvedValue(false),
    };
    const refreshService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      accountService as unknown as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container: {
        id: 'container-captcha-submit',
        name: 'napcat-10001',
      },
      expectedSelfId: '10001',
      mode: 'refresh',
      status: 'pending',
    });
    session.captchaUrl =
      'https://ti.qq.com/safe/tools/captcha/sms-verify-login?uin=10001&sid=sid-from-url';
    session.passwordMd5 = '0123456789abcdef0123456789abcdef';
    (refreshService as any).sessions.set(session.id, session);
    const postNapcat = jest
      .spyOn(refreshService as any, 'postNapcat')
      .mockResolvedValueOnce(null);
    jest
      .spyOn(refreshService as any, 'waitForPasswordLoginStatus')
      .mockResolvedValue({
        isLogin: true,
      });
    jest.spyOn(refreshService as any, 'getLoginInfo').mockResolvedValue({
      nickname: 'Kwi',
      online: true,
      uin: '10001',
    });
    const result = await refreshService.submitCaptcha(session.id, {
      randstr: '@rand',
      sid: 'sid-from-url',
      ticket: 'captcha-ticket',
    });

    expect(postNapcat).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'container-captcha-submit' }),
      '/api/QQLogin/CaptchaLogin',
      {
        passwordMd5: '0123456789abcdef0123456789abcdef',
        randstr: '@rand',
        sid: 'sid-from-url',
        ticket: 'captcha-ticket',
        uin: '10001',
      },
    );
    expect(result.status).toBe('success');
    expect(session.captchaUrl).toBeUndefined();
    expect(session.passwordMd5).toBeUndefined();
  });

  it('generates new-device verification QR through NapCat after captcha requires new device', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-new-device',
      name: 'napcat-10001',
    };
    const containerService = {
      findRuntimeById: jest.fn().mockResolvedValue(container),
      removeUnboundContainer: jest.fn().mockResolvedValue(false),
    };
    const refreshService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      {} as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      status: 'pending',
    });
    session.captchaUrl =
      'https://ti.qq.com/safe/tools/captcha/sms-verify-login?uin=10001&sid=sid-from-url';
    session.passwordMd5 = '0123456789abcdef0123456789abcdef';
    (refreshService as any).sessions.set(session.id, session);
    const postNapcat = jest
      .spyOn(refreshService as any, 'postNapcat')
      .mockImplementation(async (_runtime, path: string) => {
        if (path === '/api/QQLogin/CaptchaLogin') {
          return {
            jumpUrl: 'https://ti.qq.com/new-device/verify',
            needNewDevice: true,
            newDevicePullQrCodeSig: 'sig-new-device',
          };
        }
        if (path === '/api/QQLogin/GetNewDeviceQRCode') {
          return {
            bytes_token: 'bytes-new-device',
            newDevicePullQrCodeSig: 'sig-new-device',
            qrcodeUrl: 'data:image/png;base64,new-device-qrcode',
          };
        }
        throw new Error(`unexpected NapCat path ${path}`);
      });
    const waitForPasswordLoginStatus = jest.spyOn(
      refreshService as any,
      'waitForPasswordLoginStatus',
    );

    const result = await refreshService.submitCaptcha(session.id, {
      randstr: '@rand',
      sid: 'sid-from-url',
      ticket: 'captcha-ticket',
    });

    expect(postNapcat).toHaveBeenNthCalledWith(
      2,
      container,
      '/api/QQLogin/GetNewDeviceQRCode',
      {
        jumpUrl: 'https://ti.qq.com/new-device/verify',
        uin: '10001',
      },
    );
    expect(waitForPasswordLoginStatus).not.toHaveBeenCalled();
    expect(result.status).toBe('pending');
    expect(result.captchaUrl).toBeUndefined();
    expect(result.qrcode).toBeUndefined();
    expect(result.newDeviceQrcode).toBe(
      'data:image/png;base64,new-device-qrcode',
    );
    expect(result.newDeviceStatus).toBe('qr-pending');
    expect(result.errorMessage).toBe('新设备二维码待扫码');
    expect(session.newDevicePullQrCodeSig).toBe('sig-new-device');
    expect(session.newDeviceBytesToken).toBe('bytes-new-device');
    expect(session.deviceVerifyUrl).toBe('https://ti.qq.com/new-device/verify');
    const steps = (
      (refreshService as any).sessionEventLogs.get(session.id) ?? []
    ).map((event: { step: string }) => event.step);
    expect(steps).toEqual(
      expect.arrayContaining([
        'password-login-captcha-submit',
        'new-device-required',
        'new-device-qrcode-ready',
      ]),
    );
  });

  it('polls new-device QR and completes NewDeviceLogin before password success', async () => {
    const accountService = {
      ensureScannedAccount: jest.fn().mockResolvedValue('account-1'),
    };
    const pullQrCodeSig = { key: 'sig-new-device' };
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-new-device-poll',
      name: 'napcat-10001',
    };
    const containerService = {
      bindAccount: jest.fn().mockResolvedValue(undefined),
      findRuntimeById: jest.fn().mockResolvedValue(container),
      removeUnboundContainer: jest.fn().mockResolvedValue(false),
    };
    const refreshService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      accountService as unknown as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      status: 'pending',
    });
    session.deviceVerifyUrl = 'https://ti.qq.com/new-device/verify';
    session.newDeviceBytesToken = 'bytes-new-device';
    session.newDevicePullQrCodeSig = pullQrCodeSig;
    session.newDeviceQrcode = 'data:image/png;base64,new-device-qrcode';
    session.newDeviceStatus = 'qr-pending';
    session.passwordMd5 = '0123456789abcdef0123456789abcdef';
    (refreshService as any).sessions.set(session.id, session);
    const postNapcat = jest
      .spyOn(refreshService as any, 'postNapcat')
      .mockResolvedValueOnce({
        status: 'scanned',
      })
      .mockResolvedValueOnce({
        status: 'confirming',
      })
      .mockResolvedValueOnce({
        success: true,
      });
    jest
      .spyOn(refreshService as any, 'waitForPasswordLoginStatus')
      .mockResolvedValue({
        isLogin: true,
      });
    jest.spyOn(refreshService as any, 'getLoginInfo').mockResolvedValue({
      nickname: 'Kwi',
      online: true,
      uin: '10001',
    });
    const scanned = (await refreshService.status(session.id)) as any;
    const completed = await refreshService.status(session.id);

    expect(scanned.status).toBe('pending');
    expect(scanned.newDeviceStatus).toBe('scanned');
    expect(scanned.errorMessage).toBe('新设备二维码已扫码');
    expect(completed.status).toBe('success');
    expect(postNapcat).toHaveBeenNthCalledWith(
      1,
      container,
      '/api/QQLogin/PollNewDeviceQR',
      {
        bytesToken: 'bytes-new-device',
        uin: '10001',
      },
    );
    expect(postNapcat).toHaveBeenNthCalledWith(
      2,
      container,
      '/api/QQLogin/PollNewDeviceQR',
      {
        bytesToken: 'bytes-new-device',
        uin: '10001',
      },
    );
    expect(postNapcat).toHaveBeenNthCalledWith(
      3,
      container,
      '/api/QQLogin/NewDeviceLogin',
      {
        newDevicePullQrCodeSig: pullQrCodeSig,
        passwordMd5: '0123456789abcdef0123456789abcdef',
        uin: '10001',
      },
    );
    expect(session.newDeviceQrcode).toBeUndefined();
    expect(session.newDeviceStatus).toBe('verified');
    const steps = (
      (refreshService as any).sessionEventLogs.get(session.id) ?? []
    ).map((event: { step: string }) => event.step);
    expect(steps).toEqual(
      expect.arrayContaining([
        'new-device-scanned',
        'new-device-confirming',
        'new-device-verified',
        'login-success',
      ]),
    );
  });

  it('uses NapCat confirmed token and reloads saved password when new-device session lost passwordMd5', async () => {
    const account = {
      id: 'account-1',
      napcatLoginPasswordSecret: 'encrypted-secret',
      selfId: '10001',
    };
    const accountService = {
      ensureScannedAccount: jest.fn().mockResolvedValue('account-1'),
      findByIdWithNapcatLoginSecret: jest.fn().mockResolvedValue(account),
      getNapcatLoginPassword: jest.fn().mockReturnValue('qq-password'),
    };
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-new-device-confirmed',
      name: 'napcat-10001',
    };
    const containerService = {
      bindAccount: jest.fn().mockResolvedValue(undefined),
      findRuntimeById: jest.fn().mockResolvedValue(container),
      removeUnboundContainer: jest.fn().mockResolvedValue(false),
    };
    const refreshService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      accountService as unknown as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      status: 'pending',
    });
    session.deviceVerifyUrl =
      'https://accounts.qq.com/safe/verify?sig=sig&uin-token=token';
    session.newDeviceBytesToken = 'bytes-new-device';
    session.newDevicePullQrCodeSig = 'initial-sig';
    session.newDeviceQrcode = 'data:image/png;base64,new-device-qrcode';
    session.newDeviceStatus = 'qr-pending';
    (refreshService as any).sessions.set(session.id, session);
    const postNapcat = jest
      .spyOn(refreshService as any, 'postNapcat')
      .mockResolvedValueOnce({
        str_nt_succ_token: 'nt-success-token',
        uint32_guarantee_status: 1,
      })
      .mockResolvedValueOnce({
        success: true,
      });
    jest
      .spyOn(refreshService as any, 'waitForPasswordLoginStatus')
      .mockResolvedValue({
        isLogin: true,
      });
    jest.spyOn(refreshService as any, 'getLoginInfo').mockResolvedValue({
      nickname: 'Kwi',
      online: true,
      uin: '10001',
    });
    const result = await refreshService.status(session.id);

    expect(result.status).toBe('success');
    expect(accountService.findByIdWithNapcatLoginSecret).toHaveBeenCalledWith(
      'account-1',
    );
    expect(accountService.getNapcatLoginPassword).toHaveBeenCalledWith(account);
    expect(postNapcat).toHaveBeenNthCalledWith(
      2,
      container,
      '/api/QQLogin/NewDeviceLogin',
      {
        newDevicePullQrCodeSig: 'nt-success-token',
        passwordMd5: '7fe1f9ae1130b64e9ca1441492c382c0',
        uin: '10001',
      },
    );
    expect(session.newDeviceStatus).toBe('verified');
  });

  it('recovers missing new-device bytesToken before polling', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-new-device-recover',
      name: 'napcat-10001',
    };
    const containerService = {
      findRuntimeById: jest.fn().mockResolvedValue(container),
      removeUnboundContainer: jest.fn().mockResolvedValue(false),
    };
    const refreshService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      {} as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      status: 'pending',
    });
    session.deviceVerifyUrl = 'https://ti.qq.com/new-device/verify';
    session.newDevicePullQrCodeSig = 'sig-new-device';
    session.newDeviceStatus = 'qr-pending';
    session.passwordMd5 = '0123456789abcdef0123456789abcdef';
    (refreshService as any).sessions.set(session.id, session);
    const postNapcat = jest
      .spyOn(refreshService as any, 'postNapcat')
      .mockResolvedValue({
        bytes_token: 'bytes-recovered',
        qrcodeUrl: 'data:image/png;base64,recovered-new-device-qrcode',
      });

    const result = await refreshService.status(session.id);

    expect(result.status).toBe('pending');
    expect(result.newDeviceStatus).toBe('qr-pending');
    expect(result.newDeviceQrcode).toBe(
      'data:image/png;base64,recovered-new-device-qrcode',
    );
    expect(session.newDeviceBytesToken).toBe('bytes-recovered');
    expect(postNapcat).toHaveBeenCalledTimes(1);
    expect(postNapcat).toHaveBeenCalledWith(
      container,
      '/api/QQLogin/GetNewDeviceQRCode',
      {
        jumpUrl: 'https://ti.qq.com/new-device/verify',
        uin: '10001',
      },
    );
  });

  it('clears password challenge session state when cancelling captcha pending login', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-captcha-cancel',
      name: 'napcat-10001',
    };
    const containerService = {
      ensureRuntimeLoginEnv: jest.fn().mockResolvedValue({
        changed: true,
        ok: true,
      }),
      findRuntimeById: jest.fn().mockResolvedValue(container),
      removeUnboundContainer: jest.fn().mockResolvedValue(false),
    };
    const refreshService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      {} as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      status: 'pending',
    });
    session.captchaUrl =
      'https://ti.qq.com/safe/tools/captcha/sms-verify-login?uin=10001';
    session.passwordMd5 = '0123456789abcdef0123456789abcdef';
    (refreshService as any).sessions.set(session.id, session);
    const flushSessionWrites = jest.spyOn(
      (refreshService as any).loginSessionStore,
      'flushSessionWrites',
    );

    await refreshService.cancel(session.id);

    expect(containerService.ensureRuntimeLoginEnv).not.toHaveBeenCalled();
    expect(flushSessionWrites).toHaveBeenCalledWith(session.id);
    expect(session.passwordMd5).toBeUndefined();
    expect(session.captchaUrl).toBeUndefined();
  });

  it('does not block captcha success with runtime password env cleanup', async () => {
    const accountService = {
      ensureScannedAccount: jest.fn().mockResolvedValue('account-1'),
    };
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-captcha-cleanup-failed',
      name: 'napcat-10001',
    };
    const containerService = {
      bindAccount: jest.fn().mockResolvedValue(undefined),
      ensureRuntimeLoginEnv: jest.fn().mockResolvedValue({
        changed: false,
        ok: false,
      }),
      findRuntimeById: jest.fn().mockResolvedValue(container),
      removeUnboundContainer: jest.fn().mockResolvedValue(false),
    };
    const refreshService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      accountService as unknown as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      status: 'pending',
    });
    session.captchaUrl =
      'https://ti.qq.com/safe/tools/captcha/sms-verify-login?uin=10001&sid=sid-from-url';
    session.passwordMd5 = '0123456789abcdef0123456789abcdef';
    (refreshService as any).sessions.set(session.id, session);
    jest.spyOn(refreshService as any, 'postNapcat').mockResolvedValueOnce(null);
    jest
      .spyOn(refreshService as any, 'waitForPasswordLoginStatus')
      .mockResolvedValue({
        isLogin: true,
      });
    jest.spyOn(refreshService as any, 'getLoginInfo').mockResolvedValue({
      nickname: 'Kwi',
      online: true,
      uin: '10001',
    });

    const result = await refreshService.submitCaptcha(session.id, {
      randstr: '@rand',
      sid: 'sid-from-url',
      ticket: 'captcha-ticket',
    });

    expect(result.status).toBe('success');
    expect(accountService.ensureScannedAccount).toHaveBeenCalledWith({
      accountId: 'account-1',
      name: 'Kwi',
      selfId: '10001',
    });
    const steps = (
      (refreshService as any).sessionEventLogs.get(session.id) ?? []
    ).map((event: { step: string }) => event.step);
    expect(steps).not.toContain('password-env-cleanup-failed');
    expect(steps).toContain('login-success');
  });

  it('returns captcha status immediately without waiting full password window', async () => {
    const captchaUrl =
      'https://ti.qq.com/safe/tools/captcha/sms-verify-login?uin=10001';
    const refreshService = new QqbotNapcatLoginService(
      {
        get: jest.fn((key: string) => {
          const values: Record<string, string> = {
            QQBOT_NAPCAT_LOGIN_POLL_INTERVAL_MS: '1000',
            QQBOT_NAPCAT_PASSWORD_LOGIN_WAIT_MS: '3000',
          };
          return values[key] || '';
        }),
      } as unknown as ConfigService,
      {} as QqbotAccountService,
      {} as QqbotNapcatContainerService,
      new ToolsService(),
    );
    jest.spyOn(refreshService as any, 'postNapcat').mockResolvedValueOnce({
      isLogin: false,
      loginError: `需要验证码, proofWaterUrl: ${captchaUrl}`,
    });
    const sleep = jest.spyOn((refreshService as any).toolsService, 'sleep');

    const status = await (refreshService as any).waitForPasswordLoginStatus({
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-captcha-early',
      name: 'napcat-10001',
      webuiToken: 'token',
    });

    expect(status.loginError).toContain(captchaUrl);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('captures captcha url from runtime logs when status check throws captcha message without url', async () => {
    const restartedAt = Date.now() - 1500;
    const captchaUrl =
      'https://ti.qq.com/safe/tools/captcha/sms-verify-login?uin=10001';
    const containerService = {
      detectRuntimeCaptchaUrl: jest.fn().mockResolvedValue(captchaUrl),
    };
    const refreshService = new QqbotNapcatLoginService(
      {
        get: jest.fn((key: string) => {
          const values: Record<string, string> = {
            QQBOT_NAPCAT_LOGIN_POLL_INTERVAL_MS: '1000',
            QQBOT_NAPCAT_PASSWORD_LOGIN_WAIT_MS: '3000',
          };
          return values[key] || '';
        }),
      } as unknown as ConfigService,
      {} as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    jest
      .spyOn(refreshService as any, 'getLoginStatus')
      .mockRejectedValueOnce(new Error('需要验证码'));
    const sleep = jest.spyOn((refreshService as any).toolsService, 'sleep');

    const status = await (refreshService as any).waitForPasswordLoginStatus(
      {
        baseUrl: 'http://127.0.0.1:6103/',
        id: 'container-captcha-log',
        name: 'napcat-10001',
        webuiToken: 'token',
      },
      restartedAt,
    );

    expect(status).toMatchObject({
      captchaUrl,
      isLogin: false,
      loginError: '需要验证码',
    });
    expect(containerService.detectRuntimeCaptchaUrl).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'napcat-10001' }),
      restartedAt,
    );
    expect(sleep).not.toHaveBeenCalled();
  });

  it('returns captcha status during password wait when processing logs already contain captcha url', async () => {
    const restartedAt = Date.now() - 1500;
    const captchaUrl =
      'https://ti.qq.com/safe/tools/captcha/sms-verify-login?uin=10001';
    const containerService = {
      detectRuntimeCaptchaUrl: jest.fn().mockResolvedValue(captchaUrl),
    };
    const refreshService = new QqbotNapcatLoginService(
      {
        get: jest.fn((key: string) => {
          const values: Record<string, string> = {
            QQBOT_NAPCAT_LOGIN_POLL_INTERVAL_MS: '1000',
            QQBOT_NAPCAT_PASSWORD_LOGIN_WAIT_MS: '3000',
          };
          return values[key] || '';
        }),
      } as unknown as ConfigService,
      {} as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const getLoginStatus = jest
      .spyOn(refreshService as any, 'getLoginStatus')
      .mockResolvedValue({
        isLogin: false,
        loginError: '密码登录处理中',
      });
    const sleep = jest
      .spyOn((refreshService as any).toolsService, 'sleep')
      .mockResolvedValue(undefined);

    const status = await (refreshService as any).waitForPasswordLoginStatus(
      {
        baseUrl: 'http://127.0.0.1:6103/',
        id: 'container-captcha-log-processing',
        name: 'napcat-10001',
        webuiToken: 'token',
      },
      restartedAt,
    );

    expect(status).toMatchObject({
      captchaUrl,
      isLogin: false,
      loginError: '密码登录处理中',
    });
    expect(containerService.detectRuntimeCaptchaUrl).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'napcat-10001' }),
      restartedAt,
    );
    expect(getLoginStatus).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('returns qrcode status immediately without waiting full password window', async () => {
    const refreshService = new QqbotNapcatLoginService(
      {
        get: jest.fn((key: string) => {
          const values: Record<string, string> = {
            QQBOT_NAPCAT_LOGIN_POLL_INTERVAL_MS: '1000',
            QQBOT_NAPCAT_PASSWORD_LOGIN_WAIT_MS: '3000',
          };
          return values[key] || '';
        }),
      } as unknown as ConfigService,
      {} as QqbotAccountService,
      {} as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const getLoginStatus = jest
      .spyOn(refreshService as any, 'getLoginStatus')
      .mockResolvedValue({
        isLogin: false,
        loginError: '二维码已过期，请刷新',
        qrcodeurl: 'expired-qrcode',
      });
    const sleep = jest.spyOn((refreshService as any).toolsService, 'sleep');

    const status = await (refreshService as any).waitForPasswordLoginStatus({
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-qrcode-early',
      name: 'napcat-10001',
      webuiToken: 'token',
    });

    expect(status.qrcodeurl).toBe('expired-qrcode');
    expect(getLoginStatus).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not keep stale captcha pending after captcha submit returns non-captcha failure', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-captcha-normal-failure',
      name: 'napcat-10001',
    };
    const containerService = {
      ensureRuntimeLoginEnv: jest.fn().mockResolvedValue({
        changed: true,
        ok: true,
      }),
      findRuntimeById: jest.fn().mockResolvedValue(container),
      removeUnboundContainer: jest.fn().mockResolvedValue(false),
    };
    const refreshService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      {} as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      status: 'pending',
    });
    session.captchaUrl =
      'https://ti.qq.com/safe/tools/captcha/sms-verify-login?uin=10001';
    session.passwordMd5 = '0123456789abcdef0123456789abcdef';
    (refreshService as any).sessions.set(session.id, session);
    jest.spyOn(refreshService as any, 'postNapcat').mockResolvedValueOnce(null);
    jest
      .spyOn(refreshService as any, 'waitForPasswordLoginStatus')
      .mockResolvedValue({
        isLogin: false,
        loginError: '密码错误',
      });

    const result = await refreshService.submitCaptcha(session.id, {
      randstr: '@rand',
      ticket: 'captcha-ticket',
    });

    expect(result.status).toBe('error');
    expect(result.captchaUrl).toBeUndefined();
    expect(result.errorMessage).toBe('验证码登录未完成：密码错误');
    expect(containerService.ensureRuntimeLoginEnv).not.toHaveBeenCalled();
  });

  it('uses password before qrcode without historical NapCat session', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      hasExistingPrimaryBinding: false,
      id: 'container-new',
      name: 'napcat-10001',
    };
    const accountService = {
      ensureScannedAccount: jest.fn().mockResolvedValue('account-1'),
    };
    const containerService = {
      bindAccount: jest.fn().mockResolvedValue(undefined),
      ensureRuntimeLoginEnv: jest
        .fn()
        .mockResolvedValue({ changed: true, ok: true }),
      resetRuntimeLoginState: jest.fn().mockResolvedValue(true),
      restartRuntimeContainer: jest.fn().mockResolvedValue(true),
    };
    const refreshService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      accountService as unknown as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      preparingRelogin: true,
      status: 'pending',
    });
    (refreshService as any).sessions.set(session.id, session);
    jest
      .spyOn((refreshService as any).toolsService, 'sleep')
      .mockResolvedValue(undefined);
    jest.spyOn(refreshService as any, 'getLoginStatus').mockResolvedValue({
      isLogin: true,
    });
    jest.spyOn(refreshService as any, 'getLoginInfo').mockResolvedValue({
      nickname: 'Kwi',
      online: true,
      uin: '10001',
    });
    const refreshQrcode = jest
      .spyOn(refreshService as any, 'refreshOrGetQrcode')
      .mockResolvedValue('fallback-qrcode');
    mockWebuiLoginPost(refreshService);

    await (refreshService as any).prepareReloginQrcode(
      session,
      container,
      'qq-password',
      false,
    );

    expect(containerService.ensureRuntimeLoginEnv).not.toHaveBeenCalled();
    expect(refreshQrcode).not.toHaveBeenCalled();
    expect(session.status).toBe('success');
    const steps = (
      (refreshService as any).sessionEventLogs.get(session.id) ?? []
    ).map((event: { step: string }) => event.step);
    expect(steps).not.toContain('quick-login-start');
    expect(steps).toEqual(
      expect.arrayContaining(['password-login-start', 'login-success']),
    );
  });

  it('completes password refresh without runtime password env cleanup', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-password-cleanup-failed',
      name: 'napcat-10001',
    };
    const accountService = {
      ensureScannedAccount: jest.fn().mockResolvedValue('account-1'),
    };
    const containerService = {
      bindAccount: jest.fn().mockResolvedValue(undefined),
      ensureRuntimeLoginEnv: jest
        .fn()
        .mockResolvedValueOnce({ changed: false, ok: true })
        .mockResolvedValueOnce({ changed: true, ok: true })
        .mockResolvedValueOnce({ changed: false, ok: false }),
      resetRuntimeLoginState: jest.fn().mockResolvedValue(true),
      restartRuntimeContainer: jest.fn().mockResolvedValue(true),
    };
    const refreshService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      accountService as unknown as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      preparingRelogin: true,
      status: 'pending',
    });
    (refreshService as any).sessions.set(session.id, session);
    jest
      .spyOn((refreshService as any).toolsService, 'sleep')
      .mockResolvedValue(undefined);
    jest
      .spyOn(refreshService as any, 'getLoginStatus')
      .mockResolvedValueOnce({
        isLogin: false,
        loginError: '快速登录未找到历史会话',
      })
      .mockResolvedValueOnce({
        isLogin: true,
      });
    jest.spyOn(refreshService as any, 'getLoginInfo').mockResolvedValue({
      nickname: 'Kwi',
      online: true,
      uin: '10001',
    });
    mockWebuiLoginPost(refreshService);

    await (refreshService as any).prepareReloginQrcode(
      session,
      container,
      'qq-password',
    );

    expect(containerService.ensureRuntimeLoginEnv).not.toHaveBeenCalled();
    expect(accountService.ensureScannedAccount).toHaveBeenCalledWith({
      accountId: 'account-1',
      name: 'Kwi',
      selfId: '10001',
    });
    expect(containerService.bindAccount).toHaveBeenCalledWith(
      'account-1',
      'container-password-cleanup-failed',
      '10001',
    );
    expect(session.status).toBe('success');
    const steps = (
      (refreshService as any).sessionEventLogs.get(session.id) ?? []
    ).map((event: { step: string }) => event.step);
    expect(steps).not.toContain('password-env-cleanup');
    expect(steps).toContain('login-success');
  });

  it('falls back to qrcode only after quick login and password login both fail', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-password-fallback',
      name: 'napcat-10001',
    };
    const containerService = {
      ensureRuntimeLoginEnv: jest
        .fn()
        .mockResolvedValue({ changed: false, ok: true }),
      resetRuntimeLoginState: jest.fn().mockResolvedValue(true),
      restartRuntimeContainer: jest.fn().mockResolvedValue(true),
    };
    const refreshService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      {} as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      preparingRelogin: true,
      status: 'pending',
    });
    (refreshService as any).sessions.set(session.id, session);
    jest
      .spyOn((refreshService as any).toolsService, 'sleep')
      .mockResolvedValue(undefined);
    jest
      .spyOn(refreshService as any, 'getLoginStatus')
      .mockResolvedValueOnce({
        isLogin: false,
        loginError: '快速登录未找到历史会话',
      })
      .mockResolvedValue({
        isLogin: false,
        loginError: '密码登录未完成',
      });
    jest
      .spyOn(refreshService as any, 'refreshOrGetQrcode')
      .mockResolvedValue('fallback-qrcode');
    mockWebuiLoginPost(refreshService);

    await (refreshService as any).prepareReloginQrcode(
      session,
      container,
      'qq-password',
    );

    expect(containerService.resetRuntimeLoginState).not.toHaveBeenCalled();
    expect(containerService.restartRuntimeContainer).not.toHaveBeenCalled();
    expect(session.qrcode).toBe('fallback-qrcode');
    const steps = (
      (refreshService as any).sessionEventLogs.get(session.id) ?? []
    ).map((event: { step: string }) => event.step);
    expect(steps.indexOf('quick-login-fallback')).toBeLessThan(
      steps.indexOf('password-login-start'),
    );
    expect(steps.indexOf('password-login-fallback')).toBeLessThan(
      steps.indexOf('qrcode-fetch'),
    );
  });

  it('enters qrcode fallback when password login fails without runtime env cleanup', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-password-failed-cleanup-failed',
      name: 'napcat-10001',
    };
    const containerService = {
      ensureRuntimeLoginEnv: jest
        .fn()
        .mockResolvedValueOnce({ changed: false, ok: true })
        .mockResolvedValueOnce({ changed: true, ok: true })
        .mockResolvedValueOnce({ changed: false, ok: false }),
      resetRuntimeLoginState: jest.fn().mockResolvedValue(true),
      restartRuntimeContainer: jest.fn().mockResolvedValue(true),
    };
    const refreshService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      {} as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      preparingRelogin: true,
      status: 'pending',
    });
    (refreshService as any).sessions.set(session.id, session);
    jest
      .spyOn((refreshService as any).toolsService, 'sleep')
      .mockResolvedValue(undefined);
    jest
      .spyOn(refreshService as any, 'getLoginStatus')
      .mockResolvedValueOnce({
        isLogin: false,
        loginError: '快速登录未找到历史会话',
      })
      .mockResolvedValue({
        isLogin: false,
        loginError: '密码登录未完成',
      });
    const refreshQrcode = jest
      .spyOn(refreshService as any, 'refreshOrGetQrcode')
      .mockResolvedValue('fallback-qrcode');
    mockWebuiLoginPost(refreshService);

    await (refreshService as any).prepareReloginQrcode(
      session,
      container,
      'qq-password',
    );

    expect(containerService.ensureRuntimeLoginEnv).not.toHaveBeenCalled();
    expect(containerService.resetRuntimeLoginState).not.toHaveBeenCalled();
    expect(containerService.restartRuntimeContainer).not.toHaveBeenCalled();
    expect(refreshQrcode).toHaveBeenCalledWith(
      container,
      false,
      expect.objectContaining({ requireFresh: true }),
    );
    expect(session.status).toBe('pending');
    expect(session.qrcode).toBe('fallback-qrcode');
  });

  it('does not reset login state when quick login succeeds but binding fails', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-bind-error',
      name: 'napcat-10001',
    };
    const accountService = {
      ensureScannedAccount: jest
        .fn()
        .mockRejectedValue(new Error('账号绑定写入失败')),
    };
    const containerService = {
      bindAccount: jest.fn().mockResolvedValue(undefined),
      ensureRuntimeLoginEnv: jest
        .fn()
        .mockResolvedValue({ changed: false, ok: true }),
      resetRuntimeLoginState: jest.fn().mockResolvedValue(true),
      restartRuntimeContainer: jest.fn().mockResolvedValue(true),
    };
    const refreshService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      accountService as unknown as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (refreshService as any).createSession({
      accountId: 'account-1',
      container,
      expectedSelfId: '10001',
      mode: 'refresh',
      preparingRelogin: true,
      status: 'pending',
    });
    (refreshService as any).sessions.set(session.id, session);
    jest
      .spyOn((refreshService as any).toolsService, 'sleep')
      .mockResolvedValue(undefined);
    jest.spyOn(refreshService as any, 'getLoginStatus').mockResolvedValue({
      isLogin: true,
    });
    jest.spyOn(refreshService as any, 'getLoginInfo').mockResolvedValue({
      nickname: 'Kwi',
      online: true,
      uin: '10001',
    });
    const refreshQrcode = jest
      .spyOn(refreshService as any, 'refreshOrGetQrcode')
      .mockResolvedValue('fallback-qrcode');
    mockWebuiLoginPost(refreshService);

    await (refreshService as any).prepareReloginQrcode(session, container);

    expect(containerService.resetRuntimeLoginState).not.toHaveBeenCalled();
    expect(refreshQrcode).not.toHaveBeenCalled();
    expect(session.status).toBe('error');
    expect(session.qrcode).toBeUndefined();
    expect(session.errorMessage).toBe('账号绑定写入失败');
    const steps = (
      (refreshService as any).sessionEventLogs.get(session.id) ?? []
    ).map((event: { step: string }) => event.step);
    expect(steps).toContain('quick-login-start');
    expect(steps).not.toContain('quick-login-fallback');
    expect(steps).not.toContain('relogin-reset-start');
  });

  it('does not complete refresh login from stale status while relogin is preparing', async () => {
    (service as any).sessions.set('session-preparing', {
      containerId: 'container-preparing',
      containerName: 'napcat-preparing',
      createdAt: Date.now(),
      errorMessage: 'NapCat 正在尝试快速登录，请稍后',
      expiresAt: Date.now() + 60_000,
      id: 'session-preparing',
      mode: 'refresh',
      preparingRelogin: true,
      status: 'pending',
      webuiPort: 6106,
    });
    const getLoginStatus = jest.spyOn(service as any, 'getLoginStatus');

    const result = await service.status('session-preparing');

    expect(result.status).toBe('pending');
    expect(result.errorMessage).toBe('NapCat 正在尝试快速登录，请稍后');
    expect(getLoginStatus).not.toHaveBeenCalled();
  });

  it('keeps successful refresh login terminal when status is polled after background relogin', async () => {
    (service as any).sessions.set('session-success', {
      accountId: 'account-1',
      containerId: 'container-success',
      containerName: 'napcat-success',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      id: 'session-success',
      mode: 'refresh',
      preparingRelogin: true,
      status: 'success',
      webuiPort: 6108,
    });
    const getLoginStatus = jest.spyOn(service as any, 'getLoginStatus');

    const result = await service.status('session-success');

    expect(result.status).toBe('success');
    expect(result.errorMessage).toBeUndefined();
    expect(getLoginStatus).not.toHaveBeenCalled();
  });

  it('keeps failed refresh login terminal when status is polled after background relogin', async () => {
    (service as any).sessions.set('session-error', {
      accountId: 'account-1',
      containerId: 'container-error',
      containerName: 'napcat-error',
      createdAt: Date.now(),
      errorMessage: 'NapCat 快速登录失败',
      expiresAt: Date.now() + 60_000,
      id: 'session-error',
      mode: 'refresh',
      preparingRelogin: true,
      status: 'error',
      webuiPort: 6109,
    });
    const getLoginStatus = jest.spyOn(service as any, 'getLoginStatus');

    const result = await service.status('session-error');

    expect(result.status).toBe('error');
    expect(result.errorMessage).toBe('NapCat 快速登录失败');
    expect(getLoginStatus).not.toHaveBeenCalled();
  });

  it('persists expired scan sessions before removing them from the runtime cache', async () => {
    const loginSessionRepository = createLoginSessionRepository();
    const loginStateStore = new NapcatLoginStateStoreService(
      loginSessionRepository as any,
    );
    const expireService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      {} as QqbotAccountService,
      {
        removeUnboundContainer: jest.fn().mockResolvedValue(undefined),
      } as unknown as QqbotNapcatContainerService,
      new ToolsService(),
      loginStateStore,
    );

    const session = {
      containerId: 'container-expired-persist',
      containerName: 'napcat-expired-persist',
      createdAt: Date.now() - 120_000,
      expiresAt: Date.now() - 1,
      id: 'session-expired-persist',
      mode: 'refresh',
      qrcode: 'expired-qrcode',
      status: 'pending',
      webuiPort: 6110,
    } as const;
    (expireService as any).sessions.set(session.id, session);
    await loginStateStore.flushSessionWrites(session.id);

    const result = await expireService.status(session.id);
    await loginStateStore.flushSessionWrites(session.id);

    expect(result.status).toBe('expired');
    expect(loginSessionRepository.rows).toHaveLength(1);
    expect(loginSessionRepository.rows[0]).toEqual(
      expect.objectContaining({
        sessionKey: session.id,
        status: 'expired',
      }),
    );
    expect(loginSessionRepository.rows[0].completedAt).toEqual(
      expect.any(Date),
    );
    expect(loginSessionRepository.rows[0].sessionPayload?.status).toBe(
      'expired',
    );
  });

  it('persists failed scan sessions before cleaning runtime state', async () => {
    const loginSessionRepository = createLoginSessionRepository();
    const loginStateStore = new NapcatLoginStateStoreService(
      loginSessionRepository as any,
    );
    const failService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      {
        ensureScannedAccount: jest.fn(),
      } as unknown as QqbotAccountService,
      {
        removeUnboundCreateContainer: jest.fn().mockResolvedValue(undefined),
      } as unknown as QqbotNapcatContainerService,
      new ToolsService(),
      loginStateStore,
    );
    const session = (failService as any).createSession({
      container: {
        id: 'container-fail-persist',
        name: 'napcat-fail-persist',
        webuiPort: 6110,
      },
      mode: 'create',
      qrcode: 'login-qrcode',
      status: 'pending',
    });
    (failService as any).sessions.set(session.id, session);
    await loginStateStore.flushSessionWrites(session.id);
    const flushSessionWrites = jest.spyOn(
      loginStateStore,
      'flushSessionWrites',
    );

    const result = await (failService as any).failSession(
      session,
      'NapCat 已登录但未返回 QQ 号',
    );

    expect(result.status).toBe('error');
    expect(result.errorMessage).toBe('NapCat 已登录但未返回 QQ 号');
    expect(flushSessionWrites).toHaveBeenCalledWith(session.id);
    expect(loginSessionRepository.rows[0]).toEqual(
      expect.objectContaining({
        progressMessage: 'NapCat 已登录但未返回 QQ 号',
        sessionKey: session.id,
        status: 'error',
      }),
    );
    expect(loginSessionRepository.rows[0].completedAt).toEqual(
      expect.any(Date),
    );
    expect(loginSessionRepository.rows[0].sessionPayload?.status).toBe(
      'error',
    );
  });

  it('keeps an API-expired refresh session pending while NapCat still exposes the same live qrcode', async () => {
    const loginSessionRepository = createLoginSessionRepository();
    const loginStateStore = new NapcatLoginStateStoreService(
      loginSessionRepository as any,
    );
    const expireService = new QqbotNapcatLoginService(
      {
        get: jest.fn((key: string) => {
          if (key === 'NAPCAT_LOGIN_NATIVE_QR_EXPIRE_MS') return '120000';
          if (key === 'NAPCAT_LOGIN_QR_SAFE_SCAN_MS') return '45000';
          if (key === 'NAPCAT_LOGIN_QR_EXPIRE_MS') return '120000';
          return '';
        }),
      } as unknown as ConfigService,
      {
        markQqLoginStatus: jest.fn().mockResolvedValue(undefined),
      } as unknown as QqbotAccountService,
      {
        findRuntimeById: jest
          .fn()
          .mockResolvedValue({ id: 'container-expired-live' }),
        removeUnboundContainer: jest.fn().mockResolvedValue(undefined),
      } as unknown as QqbotNapcatContainerService,
      new ToolsService(),
      loginStateStore,
    );
    const session = {
      accountId: 'account-expired-live',
      containerId: 'container-expired-live',
      containerName: 'napcat-expired-live',
      createdAt: Date.now() - 180_000,
      expectedSelfId: '1914728559',
      expiresAt: Date.now() - 1,
      id: 'session-expired-live-qrcode',
      mode: 'refresh',
      qrcode: 'live-qrcode',
      status: 'pending',
      webuiPort: 6110,
    };
    (expireService as any).sessions.set(session.id, session);
    jest.spyOn(expireService as any, 'getLoginStatus').mockResolvedValue({
      isLogin: false,
      qrcodeUpdatedAt: Date.now(),
      qrcodeurl: 'live-qrcode',
    });
    await loginStateStore.flushSessionWrites(session.id);

    const result = await expireService.status(session.id);
    await loginStateStore.flushSessionWrites(session.id);

    expect(result.status).toBe('pending');
    expect(result.qrcode).toBe('live-qrcode');
    expect(result.expiresAt).toBeGreaterThan(Date.now());
    expect(loginSessionRepository.rows[0]).toEqual(
      expect.objectContaining({
        sessionKey: session.id,
        status: 'pending',
      }),
    );
    expect(loginSessionRepository.rows[0].completedAt).toBeNull();
  });

  it('refreshes a qrcode that is too close to the native QQ expiry window', async () => {
    const expiringService = new QqbotNapcatLoginService(
      {
        get: jest.fn((key: string) => {
          if (key === 'NAPCAT_LOGIN_NATIVE_QR_EXPIRE_MS') return '120000';
          if (key === 'NAPCAT_LOGIN_QR_SAFE_SCAN_MS') return '45000';
          return '';
        }),
      } as unknown as ConfigService,
      {
        markQqLoginStatus: jest.fn().mockResolvedValue(undefined),
      } as unknown as QqbotAccountService,
      {
        findRuntimeById: jest
          .fn()
          .mockResolvedValue({ id: 'container-near-expiry' }),
      } as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    const session = (expiringService as any).createSession({
      accountId: 'account-near-expiry',
      container: {
        id: 'container-near-expiry',
        name: 'napcat-near-expiry',
        webuiPort: 6110,
      },
      expectedSelfId: '1914728559',
      mode: 'refresh',
      qrcode: 'old-qrcode',
      status: 'pending',
    });
    (expiringService as any).sessions.set(session.id, session);
    jest.spyOn(expiringService as any, 'getLoginStatus').mockResolvedValue({
      isLogin: false,
      qrcodeUpdatedAt: Date.now() - 90_000,
      qrcodeurl: 'old-qrcode',
    });
    jest
      .spyOn(expiringService as any, 'refreshOrGetQrcode')
      .mockResolvedValue('fresh-qrcode');

    const result = await expiringService.status(session.id);

    expect(result.status).toBe('pending');
    expect(result.qrcode).toBe('fresh-qrcode');
    expect((expiringService as any).refreshOrGetQrcode).toHaveBeenCalledWith(
      { id: 'container-near-expiry' },
      false,
      {
        fallbackStatus: expect.objectContaining({ qrcodeurl: 'old-qrcode' }),
        requireFresh: true,
        staleQrcode: 'old-qrcode',
      },
    );
  });

  it('does not complete an expired refresh session from a delayed background relogin task', async () => {
    const loginSessionRepository = createLoginSessionRepository();
    const loginStateStore = new NapcatLoginStateStoreService(
      loginSessionRepository as any,
    );
    const accountService = {
      ensureScannedAccount: jest.fn().mockResolvedValue('account-expired'),
    };
    const containerService = {
      bindAccount: jest.fn().mockResolvedValue(undefined),
      findRuntimeById: jest.fn().mockResolvedValue({ id: 'container-expired' }),
      removeUnboundContainer: jest.fn().mockResolvedValue(undefined),
    };
    const expireService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      accountService as unknown as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
      loginStateStore,
    );
    const session = {
      accountId: 'account-expired',
      containerId: 'container-expired',
      containerName: 'napcat-expired',
      createdAt: Date.now() - 180_000,
      expectedSelfId: '10001',
      expiresAt: Date.now() - 1,
      id: 'session-expired-background',
      mode: 'refresh',
      qrcode: 'expired-qrcode',
      status: 'pending',
      webuiPort: 6110,
    };
    (expireService as any).sessions.set(session.id, session);
    await loginStateStore.flushSessionWrites(session.id);
    jest.spyOn(expireService as any, 'getLoginInfo').mockResolvedValue({
      nick: 'Mirror',
      online: true,
      uin: '10001',
    });

    const result = await (expireService as any).completeLogin(session, {
      id: 'container-expired',
    });
    await loginStateStore.flushSessionWrites(session.id);

    expect(result.status).toBe('expired');
    expect(accountService.ensureScannedAccount).not.toHaveBeenCalled();
    expect(containerService.bindAccount).not.toHaveBeenCalled();
    expect(loginSessionRepository.rows[0]).toEqual(
      expect.objectContaining({
        sessionKey: session.id,
        status: 'expired',
      }),
    );
  });

  it('refreshes stale relogin qrcode from NapCat status instead of staying in quick login pending', async () => {
    (service as any).sessions.set('session-stale-relogin-qrcode', {
      accountId: 'account-1',
      containerId: 'container-stale-relogin',
      containerName: 'napcat-stale-relogin',
      createdAt: Date.now(),
      errorMessage: 'NapCat 正在尝试快速登录，请稍后',
      expectedSelfId: '10001',
      expiresAt: Date.now() + 60_000,
      id: 'session-stale-relogin-qrcode',
      lastRestartedAt: 1,
      mode: 'refresh',
      preparingRelogin: true,
      status: 'pending',
      webuiPort: 6110,
    });
    const container = { id: 'container-stale-relogin' };
    jest
      .spyOn(service as any, 'getSessionContainer')
      .mockResolvedValue(container);
    jest.spyOn(service as any, 'getLoginStatus').mockResolvedValue({
      isLogin: false,
      qrcodeurl: 'status-qrcode',
    });
    jest
      .spyOn(service as any, 'callRefreshQrcode')
      .mockResolvedValue('fresh-qrcode');

    const result = await service.refreshQrcode('session-stale-relogin-qrcode');

    expect(result.status).toBe('pending');
    expect(result.qrcode).toBe('fresh-qrcode');
    expect(result.errorMessage).toBeUndefined();
    expect((service as any).sessions.get('session-stale-relogin-qrcode')).toEqual(
      expect.objectContaining({
        preparingRelogin: false,
        qrcode: 'fresh-qrcode',
      }),
    );
  });

  it('syncs account qrcode status when scan status reads a NapCat qrcode', async () => {
    const accountService = {
      markQqLoginStatus: jest.fn(),
    };
    const syncService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      accountService as unknown as QqbotAccountService,
      {} as QqbotNapcatContainerService,
      new ToolsService(),
    );
    (syncService as any).sessions.set('session-sync-qrcode-status', {
      accountId: 'account-1',
      containerId: 'container-sync-status',
      containerName: 'napcat-sync-status',
      createdAt: Date.now(),
      expectedSelfId: '10001',
      expiresAt: Date.now() + 60_000,
      id: 'session-sync-qrcode-status',
      mode: 'refresh',
      status: 'pending',
      webuiPort: 6111,
    });
    jest
      .spyOn(syncService as any, 'getSessionContainer')
      .mockResolvedValue({ id: 'container-sync-status' });
    jest.spyOn(syncService as any, 'getLoginStatus').mockResolvedValue({
      isLogin: false,
      qrcodeurl: 'status-qrcode',
    });
    jest
      .spyOn(syncService as any, 'getQrcode')
      .mockResolvedValue('status-qrcode');

    const result = await syncService.status('session-sync-qrcode-status');

    expect(result.qrcode).toBe('status-qrcode');
    expect(accountService.markQqLoginStatus).toHaveBeenCalledWith(
      '10001',
      'qrcode_pending',
      null,
    );
  });

  it('replays scan progress events to late SSE subscribers', () => {
    const session = {
      containerId: 'container-events',
      containerName: 'napcat-events',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      id: 'session-events',
      mode: 'refresh',
      status: 'pending',
      webuiPort: 6107,
    };
    (service as any).sessions.set('session-events', session);
    (service as any).publishScanResultEvent(
      session,
      'container-stop',
      'processing',
      '正在停止 NapCat 容器',
    );
    const events: any[] = [];

    const subscription = service
      .events('session-events')
      .subscribe((event) => events.push(event.data));

    expect(events).toEqual([
      expect.objectContaining({
        message: '正在停止 NapCat 容器',
        status: 'processing',
        step: 'container-stop',
      }),
    ]);
    subscription.unsubscribe();
  });

  it('emits a current session snapshot when SSE event cache was lost', async () => {
    const session = {
      accountId: 'account-1',
      containerId: 'container-events-snapshot',
      containerName: 'napcat-events-snapshot',
      createdAt: Date.now(),
      errorMessage: 'NapCat 正在尝试密码登录，请稍后',
      expiresAt: Date.now() + 60_000,
      id: 'session-events-snapshot',
      mode: 'refresh',
      preparingRelogin: true,
      status: 'pending',
      webuiPort: 6107,
    };
    (service as any).sessions.set('session-events-snapshot', session);
    const events: any[] = [];

    const subscription = service
      .events('session-events-snapshot')
      .subscribe((event) => events.push(event.data));
    await new Promise((resolve) => setImmediate(resolve));

    expect(events).toEqual([
      expect.objectContaining({
        message: 'NapCat 正在尝试密码登录，请稍后',
        result: expect.objectContaining({
          sessionId: 'session-events-snapshot',
          status: 'pending',
        }),
        status: 'processing',
        step: 'password-login-start',
      }),
    ]);
    subscription.unsubscribe();
  });

  it('requires a qrcode different from the current one when refreshing qrcode', async () => {
    (service as any).sessions.set('session-refresh-qrcode', {
      containerId: 'container-3',
      containerName: 'napcat-3',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      id: 'session-refresh-qrcode',
      mode: 'refresh',
      qrcode: 'old-qrcode',
      status: 'pending',
      webuiPort: 6103,
    });
    const container = { id: 'container-3' };
    jest
      .spyOn(service as any, 'getSessionContainer')
      .mockResolvedValue(container);
    jest.spyOn(service as any, 'getLoginStatus').mockResolvedValue({
      isLogin: false,
      qrcodeurl: 'old-qrcode',
    });
    jest.spyOn(service as any, 'callRefreshQrcode').mockResolvedValue('');
    jest.spyOn(service as any, 'getQrcode').mockResolvedValue('new-qrcode');

    const result = await service.refreshQrcode('session-refresh-qrcode');

    expect(result.qrcode).toBe('new-qrcode');
    expect((service as any).getQrcode).toHaveBeenCalledWith(container, false, {
      requireFresh: true,
      staleQrcode: 'old-qrcode',
    });
  });

  it('keeps the refresh session pending when NapCat is still regenerating qrcode', async () => {
    (service as any).sessions.set('session-pending-qrcode', {
      containerId: 'container-pending',
      containerName: 'napcat-pending',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      id: 'session-pending-qrcode',
      mode: 'refresh',
      qrcode: 'old-qrcode',
      status: 'pending',
      webuiPort: 6105,
    });
    jest
      .spyOn(service as any, 'getSessionContainer')
      .mockResolvedValue({ id: 'container-pending' });
    jest.spyOn(service as any, 'getLoginStatus').mockResolvedValue({
      isLogin: false,
      qrcodeurl: 'old-qrcode',
    });
    jest
      .spyOn(service as any, 'callRefreshQrcode')
      .mockRejectedValue(new Error('NapCat 二维码仍未刷新'));

    const result = await service.refreshQrcode('session-pending-qrcode');

    expect(result.status).toBe('pending');
    expect(result.qrcode).toBeUndefined();
    expect(result.errorMessage).toContain('正在重新生成二维码');
  });

  it('accepts qrcode from login status for refresh session without stored qrcode', async () => {
    (service as any).sessions.set('session-status-qrcode', {
      accountId: 'account-1',
      containerId: 'container-status-qrcode',
      containerName: 'napcat-status-qrcode',
      createdAt: Date.now(),
      errorMessage: 'NapCat 正在重新生成二维码，请稍后',
      expiresAt: Date.now() + 60_000,
      id: 'session-status-qrcode',
      mode: 'refresh',
      status: 'pending',
      webuiPort: 6106,
    });
    jest
      .spyOn(service as any, 'getSessionContainer')
      .mockResolvedValue({ id: 'container-status-qrcode' });
    jest.spyOn(service as any, 'getLoginStatus').mockResolvedValue({
      isLogin: false,
      qrcodeurl: 'fresh-status-qrcode',
    });
    const getQrcode = jest
      .spyOn(service as any, 'getQrcode')
      .mockRejectedValue(new Error('NapCat 二维码仍未刷新'));

    const result = await service.status('session-status-qrcode');

    expect(result.status).toBe('pending');
    expect(result.qrcode).toBe('fresh-status-qrcode');
    expect(result.errorMessage).toBeUndefined();
    expect(getQrcode).not.toHaveBeenCalled();
  });

  it('auto refreshes a pending refresh session when WebUI has no cached qrcode', async () => {
    (service as any).sessions.set('session-auto-refresh-qrcode', {
      accountId: 'account-1',
      containerId: 'container-auto-refresh-qrcode',
      containerName: 'napcat-auto-refresh-qrcode',
      createdAt: Date.now(),
      errorMessage: 'NapCat 正在重新生成二维码，请稍后刷新或等待自动更新',
      expiresAt: Date.now() + 60_000,
      expectedSelfId: '10001',
      id: 'session-auto-refresh-qrcode',
      mode: 'refresh',
      status: 'pending',
      webuiPort: 6106,
    });
    const container = { id: 'container-auto-refresh-qrcode' };
    const loginStatus = {
      isLogin: false,
      loginError: '网络连接异常!',
    };
    jest
      .spyOn(service as any, 'getSessionContainer')
      .mockResolvedValue(container);
    jest
      .spyOn(service as any, 'getLoginStatus')
      .mockResolvedValue(loginStatus);
    const getQrcode = jest
      .spyOn(service as any, 'getQrcode')
      .mockRejectedValue(new Error('NapCat 未返回登录二维码'));
    const refreshOrGetQrcode = jest
      .spyOn(service as any, 'refreshOrGetQrcode')
      .mockResolvedValue('auto-refresh-qrcode');

    const result = await service.status('session-auto-refresh-qrcode');

    expect(result.status).toBe('pending');
    expect(result.qrcode).toBe('auto-refresh-qrcode');
    expect(result.errorMessage).toBeUndefined();
    expect(getQrcode).not.toHaveBeenCalled();
    expect(refreshOrGetQrcode).toHaveBeenCalledWith(container, false, {
      fallbackStatus: loginStatus,
      requireFresh: true,
      staleQrcode: undefined,
    });
    expect(
      (service as any).sessions.get('session-auto-refresh-qrcode')
        .lastQrcodeRefreshAt,
    ).toEqual(expect.any(Number));
  });

  it('restarts the NapCat worker once before status auto-refresh for a restored online-source refresh session', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6106/',
      id: 'container-status-worker-restart',
      name: 'napcat-10001',
      sourceContainerOnline: true,
    };
    const containerService = {
      findRuntimeById: jest.fn().mockResolvedValue(container),
      restartRuntimeContainer: jest.fn().mockResolvedValue(true),
    };
    const accountService = {
      markQqLoginStatus: jest.fn().mockResolvedValue(undefined),
    };
    const refreshService = new QqbotNapcatLoginService(
      {
        get: jest.fn((key: string) =>
          key === 'NAPCAT_WEBUI_RESTART_DELAY_MS' ? '1' : undefined,
        ),
      } as unknown as ConfigService,
      accountService as unknown as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    (refreshService as any).sessions.set('session-status-worker-restart', {
      accountId: 'account-1',
      containerId: container.id,
      containerName: container.name,
      createdAt: Date.now(),
      errorMessage: 'NapCat 正在重新生成二维码，请稍后刷新或等待自动更新',
      expiresAt: Date.now() + 60_000,
      expectedSelfId: '10001',
      id: 'session-status-worker-restart',
      mode: 'refresh',
      sourceContainerOnline: true,
      status: 'pending',
      webuiPort: 6106,
    });
    const loginStatus = {
      isLogin: false,
      isOffline: true,
      loginError: 'NapCat 账号状态变更为离线',
    };
    jest
      .spyOn(refreshService as any, 'getSessionContainer')
      .mockResolvedValue(container);
    jest
      .spyOn(refreshService as any, 'getLoginStatus')
      .mockResolvedValue(loginStatus);
    jest
      .spyOn(refreshService as any, 'refreshOrGetQrcode')
      .mockResolvedValue('status-worker-restart-qrcode');
    const postNapcat = mockWebuiLoginPost(refreshService);

    const firstResult = await refreshService.status(
      'session-status-worker-restart',
    );
    const secondResult = await refreshService.status(
      'session-status-worker-restart',
    );

    expect(firstResult.status).toBe('pending');
    expect(firstResult.qrcode).toBe('status-worker-restart-qrcode');
    expect(secondResult.status).toBe('pending');
    expect(containerService.restartRuntimeContainer).not.toHaveBeenCalled();
    expect(
      postNapcat.mock.calls.filter(
        ([, path]) => path === '/api/QQLogin/RestartNapCat',
      ),
    ).toHaveLength(1);
  });

  it('normalizes login status to offline when login info reports offline', async () => {
    jest
      .spyOn(service as any, 'postNapcat')
      .mockResolvedValueOnce({ isLogin: true, qrcodeurl: 'old-qrcode' })
      .mockResolvedValueOnce({ online: false, uin: '10001' });

    const result = await (service as any).getLoginStatus({
      id: 'container-offline',
    });

    expect(result).toEqual(
      expect.objectContaining({
        isLogin: false,
        isOffline: true,
      }),
    );
  });

  it('returns a refresh qrcode without restarting when refresh login status is effectively offline', async () => {
    const refreshService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      {} as QqbotAccountService,
      {} as QqbotNapcatContainerService,
      new ToolsService(),
    );
    jest
      .spyOn(refreshService as any, 'cleanupSessions')
      .mockResolvedValue(null);
    jest.spyOn(refreshService as any, 'getLoginStatus').mockResolvedValue({
      isLogin: false,
      isOffline: true,
      loginError: 'NapCat 账号已离线',
      qrcodeurl: 'old-qrcode',
    });
    const restartNapcatForLogin = jest
      .spyOn(refreshService as any, 'restartNapcatForLogin')
      .mockResolvedValue(undefined);
    jest
      .spyOn(refreshService as any, 'refreshOrGetQrcode')
      .mockResolvedValue('offline-refresh-qrcode');

    const result = await (refreshService as any).startScan(
      {
        accountId: 'account-1',
        expectedSelfId: '10001',
        mode: 'refresh',
      },
      {
        baseUrl: 'http://127.0.0.1:6105/',
        id: 'container-offline',
        name: 'napcat-10001',
      },
    );

    expect(result.status).toBe('pending');
    expect(result.qrcode).toBe('offline-refresh-qrcode');
    expect(result.errorMessage).toBeUndefined();
    expect(restartNapcatForLogin).not.toHaveBeenCalled();
  });

  it('refreshes qrcode through WebUI without restarting when account is kicked offline', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-3',
      name: 'napcat-10001',
    };
    const containerService = {
      restartRuntimeContainer: jest.fn().mockResolvedValue(true),
    };
    const refreshService = new QqbotNapcatLoginService(
      { get: jest.fn() } as unknown as ConfigService,
      {} as QqbotAccountService,
      containerService as unknown as QqbotNapcatContainerService,
      new ToolsService(),
    );
    jest
      .spyOn((refreshService as any).toolsService, 'sleep')
      .mockResolvedValue(undefined);
    jest.spyOn(refreshService as any, 'getLoginStatus').mockResolvedValue({
      isLogin: false,
      qrcodeurl: 'new-status-qrcode',
    });
    jest
      .spyOn(refreshService as any, 'callRefreshQrcode')
      .mockResolvedValue('');
    jest
      .spyOn(refreshService as any, 'getQrcode')
      .mockResolvedValue('new-qrcode');

    const result = await (refreshService as any).refreshOrGetQrcode(
      container,
      true,
      {
        fallbackStatus: {
          isLogin: false,
          isOffline: true,
          loginError: '您的账号已在另一台终端登录',
          qrcodeurl: 'old-qrcode',
        },
      },
    );

    expect(result).toBe('new-qrcode');
    expect(containerService.restartRuntimeContainer).not.toHaveBeenCalled();
    expect((refreshService as any).getQrcode).toHaveBeenCalledWith(
      container,
      true,
      {
        requireFresh: true,
        staleQrcode: 'old-qrcode',
      },
    );
  });

  it('retries while NapCat still exposes the stale qrcode', async () => {
    jest
      .spyOn((service as any).toolsService, 'sleep')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'postNapcat')
      .mockResolvedValueOnce({ qrcode: 'old-qrcode' })
      .mockResolvedValueOnce({ qrcode: 'new-qrcode' });

    const result = await (service as any).getQrcode(
      { id: 'container-4' },
      true,
      {
        requireFresh: true,
        staleQrcode: 'old-qrcode',
      },
    );

    expect(result).toBe('new-qrcode');
    expect((service as any).postNapcat).toHaveBeenCalledTimes(2);
  });

  it('rejects stale status qrcode when NapCat still blocks qrcode generation as already logged in', async () => {
    jest
      .spyOn(service as any, 'postNapcat')
      .mockRejectedValue(new Error('QQ Is Logined'));
    jest.spyOn(service as any, 'getLoginStatus').mockResolvedValue({
      isLogin: false,
      isOffline: true,
      qrcodeurl: 'old-status-qrcode',
    });

    await expect(
      (service as any).getQrcode({ id: 'container-stale-login-guard' }, false, {
        requireFresh: true,
      }),
    ).rejects.toThrow('NapCat WebUI 登录态仍阻止生成新二维码');
  });

  it('keeps the current refresh qrcode during ordinary status polling', async () => {
    (service as any).sessions.set('session-status-stale-qrcode', {
      accountId: 'account-1',
      containerId: 'container-status-stale',
      containerName: 'napcat-status-stale',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      id: 'session-status-stale-qrcode',
      mode: 'refresh',
      qrcode: 'old-qrcode',
      status: 'pending',
      webuiPort: 6101,
    });
    const container = { id: 'container-status-stale' };
    jest
      .spyOn(service as any, 'getSessionContainer')
      .mockResolvedValue(container);
    jest.spyOn(service as any, 'getLoginStatus').mockResolvedValue({
      isLogin: false,
      qrcodeurl: 'old-qrcode',
    });
    const getQrcode = jest
      .spyOn(service as any, 'getQrcode')
      .mockRejectedValue(new Error('NapCat 二维码仍未刷新'));

    const result = await service.status('session-status-stale-qrcode');

    expect(result.status).toBe('pending');
    expect(result.qrcode).toBe('old-qrcode');
    expect(result.errorMessage).toBeUndefined();
    expect(getQrcode).not.toHaveBeenCalled();
  });

  it('does not replace current qrcode with expired status qrcode', async () => {
    (service as any).sessions.set('session-2', {
      containerId: 'container-2',
      containerName: 'napcat-2',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      id: 'session-2',
      mode: 'refresh',
      qrcode: 'current-qrcode',
      status: 'pending',
      webuiPort: 6101,
    });
    jest
      .spyOn(service as any, 'getSessionContainer')
      .mockResolvedValue({ id: 'container-2' });
    jest.spyOn(service as any, 'getLoginStatus').mockResolvedValue({
      isLogin: false,
      loginError: '二维码已过期',
      qrcodeurl: 'expired-qrcode',
    });

    const result = await service.status('session-2');

    expect(result.qrcode).toBe('current-qrcode');
    expect(result.errorMessage).toBe('二维码已过期');
  });
});
