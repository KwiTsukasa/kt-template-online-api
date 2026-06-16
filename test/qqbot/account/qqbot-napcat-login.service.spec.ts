jest.mock('@/common', () => {
  const actualCommon = jest.requireActual('@/common');
  return {
    ...actualCommon,
    ToolsService: actualCommon.ToolsService,
    ensureSnowflakeId: jest.fn(),
    setDictDecodeCache: jest.fn(),
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

describe('QqbotNapcatLoginService', () => {
  const toolsService = new ToolsService();
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
    );
    expect(startScan).toHaveBeenCalledWith(
      {
        accountId: 'account-1',
        expectedSelfId: '10001',
        forceRelogin: true,
        loginPassword: 'qq-password',
        mode: 'refresh',
      },
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

    const result = await refreshService.status(session.id);

    expect(getLoginStatus).toHaveBeenCalledWith(container);
    expect(result.status).toBe('pending');
    expect(result.qrcode).toBe('fresh-qrcode-after-restart');
    expect((refreshService as any).sessions.get(session.id).preparingRelogin)
      .toBe(false);
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
    expect(containerService.ensureRuntimeLoginEnv).toHaveBeenCalledWith(
      container,
      {
        clearLoginPassword: true,
        selfId: '10001',
      },
    );
  });

  it('uses NapCat -q quick login before generating qrcode for refresh login', async () => {
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
    const refreshQrcode = jest
      .spyOn(refreshService as any, 'refreshOrGetQrcode')
      .mockResolvedValue('fallback-qrcode');

    await (refreshService as any).prepareReloginQrcode(session, container);

    expect(containerService.ensureRuntimeLoginEnv).toHaveBeenCalledWith(
      container,
      {
        clearLoginPassword: true,
        selfId: '10001',
      },
    );
    expect(containerService.restartRuntimeContainer).toHaveBeenCalledWith(
      container,
    );
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

  it('does not complete quick login when runtime password env cleanup fails', async () => {
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

    await (refreshService as any).prepareReloginQrcode(session, container);

    expect(accountService.ensureScannedAccount).not.toHaveBeenCalled();
    expect(containerService.bindAccount).not.toHaveBeenCalled();
    expect(session.status).toBe('error');
    expect(session.errorMessage).toBe(
      'NapCat 快速登录前运行态密码清理失败，请重试更新登录',
    );
    const steps = (
      (refreshService as any).sessionEventLogs.get(session.id) ?? []
    ).map((event: { step: string }) => event.step);
    expect(steps).toContain('quick-login-cleanup');
    expect(steps).not.toContain('login-success');
  });

  it('falls back to fresh qrcode when NapCat -q quick login fails', async () => {
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
      .spyOn(refreshService as any, 'refreshOrGetQrcode')
      .mockResolvedValue('fallback-qrcode');

    await (refreshService as any).prepareReloginQrcode(session, container);

    expect(containerService.restartRuntimeContainer).toHaveBeenCalledWith(
      container,
    );
    expect(containerService.resetRuntimeLoginState).toHaveBeenCalledWith(
      container,
      expect.any(Function),
    );
    expect(
      containerService.restartRuntimeContainer.mock.invocationCallOrder[0],
    ).toBeLessThan(
      containerService.resetRuntimeLoginState.mock.invocationCallOrder[0],
    );
    expect(session.qrcode).toBe('fallback-qrcode');
    const steps = (
      (refreshService as any).sessionEventLogs.get(session.id) ?? []
    ).map((event: { step: string }) => event.step);
    expect(steps.indexOf('quick-login-start')).toBeLessThan(
      steps.indexOf('quick-login-fallback'),
    );
    expect(steps.indexOf('quick-login-fallback')).toBeLessThan(
      steps.indexOf('relogin-reset-start'),
    );
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
    const refreshQrcode = jest
      .spyOn(refreshService as any, 'refreshOrGetQrcode')
      .mockResolvedValue('fallback-qrcode');

    await (refreshService as any).prepareReloginQrcode(
      session,
      container,
      'qq-password',
    );

    expect(containerService.ensureRuntimeLoginEnv).toHaveBeenCalledWith(
      container,
      {
        clearLoginPassword: true,
        selfId: '10001',
      },
    );
    expect(containerService.ensureRuntimeLoginEnv).toHaveBeenCalledWith(
      container,
      {
        loginPassword: 'qq-password',
        selfId: '10001',
      },
    );
    expect(containerService.ensureRuntimeLoginEnv).toHaveBeenCalledWith(
      container,
      {
        clearLoginPassword: true,
        selfId: '10001',
      },
    );
    expect(containerService.ensureRuntimeLoginEnv).toHaveBeenNthCalledWith(
      3,
      container,
      {
        clearLoginPassword: true,
        selfId: '10001',
      },
    );
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
        .mockResolvedValue({ changed: true, ok: true }),
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
    jest.spyOn(Date, 'now').mockImplementation(() =>
      envRebuildStarted ? envRebuildStartedAt : passwordLogSinceMs,
    );
    jest.spyOn(refreshService as any, 'waitForPasswordLoginStatus')
      .mockResolvedValue({
        isLogin: false,
        loginError: '密码回退需要验证码，请在 WebUi 中继续完成验证',
      });
    jest
      .spyOn(refreshService as any, 'resolvePasswordCaptchaUrl')
      .mockResolvedValue(captchaUrl);

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
    expect(session.lastRestartedAt).toBeGreaterThanOrEqual(
      envRebuildStartedAt,
    );
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
    expect(ensureRuntimeLoginEnv).toHaveBeenCalledTimes(2);
    expect(ensureRuntimeLoginEnv).toHaveBeenNthCalledWith(1, container, {
      clearLoginPassword: true,
      selfId: '10001',
    });
    expect(ensureRuntimeLoginEnv).toHaveBeenNthCalledWith(2, container, {
      loginPassword: 'qq-password',
      selfId: '10001',
    });
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
    jest
      .spyOn(refreshService as any, 'clearRuntimeLoginPasswordAfterSuccess')
      .mockResolvedValue(undefined);

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
    jest
      .spyOn(refreshService as any, 'clearRuntimeLoginPasswordAfterSuccess')
      .mockResolvedValue(undefined);

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

  it('cleans runtime password env when cancelling captcha pending login', async () => {
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

    await refreshService.cancel(session.id);

    expect(containerService.ensureRuntimeLoginEnv).toHaveBeenCalledWith(
      container,
      {
        clearLoginPassword: true,
        selfId: '10001',
      },
    );
    expect(session.passwordMd5).toBeUndefined();
    expect(session.captchaUrl).toBeUndefined();
  });

  it('marks captcha submit as error when password env cleanup after success fails', async () => {
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

    expect(result.status).toBe('error');
    expect(result.errorMessage).toBe(
      'NapCat 密码登录已完成，但运行态密码清理失败，请重试更新登录',
    );
    expect(accountService.ensureScannedAccount).not.toHaveBeenCalled();
    const steps = (
      (refreshService as any).sessionEventLogs.get(session.id) ?? []
    ).map((event: { step: string }) => event.step);
    expect(steps).toContain('password-env-cleanup-failed');
    expect(steps).not.toContain('login-success');
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
    expect(containerService.ensureRuntimeLoginEnv).toHaveBeenCalledWith(
      container,
      {
        clearLoginPassword: true,
        selfId: '10001',
      },
    );
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

    await (refreshService as any).prepareReloginQrcode(
      session,
      container,
      'qq-password',
      false,
    );

    expect(containerService.ensureRuntimeLoginEnv).toHaveBeenNthCalledWith(
      1,
      container,
      {
        loginPassword: 'qq-password',
        selfId: '10001',
      },
    );
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

  it('fails password refresh when runtime password env cleanup fails', async () => {
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

    await (refreshService as any).prepareReloginQrcode(
      session,
      container,
      'qq-password',
    );

    expect(containerService.ensureRuntimeLoginEnv).toHaveBeenNthCalledWith(
      3,
      container,
      {
        clearLoginPassword: true,
        selfId: '10001',
      },
    );
    expect(accountService.ensureScannedAccount).not.toHaveBeenCalled();
    expect(containerService.bindAccount).not.toHaveBeenCalled();
    expect(session.status).toBe('error');
    expect(session.errorMessage).toBe(
      'NapCat 密码登录已完成，但运行态密码清理失败，请重试更新登录',
    );
    const steps = (
      (refreshService as any).sessionEventLogs.get(session.id) ?? []
    ).map((event: { step: string }) => event.step);
    expect(steps).toContain('password-env-cleanup');
    expect(steps).not.toContain('login-success');
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
        .mockResolvedValue({ changed: true, ok: true }),
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
      .mockResolvedValueOnce({
        isLogin: false,
        loginError: '密码登录未完成',
      });
    jest
      .spyOn(refreshService as any, 'refreshOrGetQrcode')
      .mockResolvedValue('fallback-qrcode');

    await (refreshService as any).prepareReloginQrcode(
      session,
      container,
      'qq-password',
    );

    expect(containerService.resetRuntimeLoginState).toHaveBeenCalledWith(
      container,
      expect.any(Function),
    );
    expect(session.qrcode).toBe('fallback-qrcode');
    const steps = (
      (refreshService as any).sessionEventLogs.get(session.id) ?? []
    ).map((event: { step: string }) => event.step);
    expect(steps.indexOf('quick-login-fallback')).toBeLessThan(
      steps.indexOf('password-login-start'),
    );
    expect(steps.indexOf('password-login-fallback')).toBeLessThan(
      steps.indexOf('relogin-reset-start'),
    );
  });

  it('does not enter qrcode fallback when password env cleanup after failed password login fails', async () => {
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
      .mockResolvedValueOnce({
        isLogin: false,
        loginError: '密码登录未完成',
      });
    const refreshQrcode = jest
      .spyOn(refreshService as any, 'refreshOrGetQrcode')
      .mockResolvedValue('fallback-qrcode');

    await (refreshService as any).prepareReloginQrcode(
      session,
      container,
      'qq-password',
    );

    expect(containerService.ensureRuntimeLoginEnv).toHaveBeenNthCalledWith(
      3,
      container,
      {
        clearLoginPassword: true,
        selfId: '10001',
      },
    );
    expect(containerService.resetRuntimeLoginState).not.toHaveBeenCalled();
    expect(refreshQrcode).not.toHaveBeenCalled();
    expect(session.status).toBe('error');
    expect(session.errorMessage).toBe(
      'NapCat 密码登录未完成，且运行态密码清理失败，请重试更新登录',
    );
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

  it('restarts container and returns pending when refresh login status is effectively offline', async () => {
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
    expect(result.qrcode).toBeUndefined();
    expect(result.errorMessage).toBe('NapCat 账号已离线');
    expect(restartNapcatForLogin).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'container-offline' }),
      { waitForReady: false },
    );
  });

  it('restarts the existing NapCat container before qrcode refresh when account is kicked offline', async () => {
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
    expect(containerService.restartRuntimeContainer).toHaveBeenCalledWith(
      container,
    );
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
