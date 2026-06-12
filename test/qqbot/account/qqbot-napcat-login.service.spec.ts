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
import { QqbotAccountService } from '@/qqbot/account/qqbot-account.service';
import { QqbotNapcatLoginService } from '@/qqbot/account/qqbot-napcat-login.service';
import { QqbotNapcatContainerService } from '@/qqbot/napcat/qqbot-napcat-container.service';

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

    expect(containerService.prepareAccountContainer).toHaveBeenCalledWith(
      account,
    );
    expect(startScan).toHaveBeenCalledWith(
      {
        accountId: 'account-1',
        expectedSelfId: '10001',
        forceRelogin: true,
        mode: 'refresh',
      },
      existingContainer,
    );
  });

  it('returns refresh login scan immediately while resetting in background', async () => {
    const container = {
      baseUrl: 'http://127.0.0.1:6103/',
      id: 'container-current',
      name: 'napcat-10001',
    };
    let resolveReset!: () => void;
    const containerService = {
      resetRuntimeLoginState: jest.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolveReset = () => resolve(true);
          }),
      ),
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
    jest
      .spyOn(refreshService as any, 'cleanupSessions')
      .mockResolvedValue(undefined);
    jest
      .spyOn(refreshService as any, 'refreshOrGetQrcode')
      .mockResolvedValue('fresh-qrcode');

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
    expect(result.errorMessage).toBe(
      'NapCat 正在重置登录态并生成二维码，请稍后',
    );
    expect(containerService.resetRuntimeLoginState).toHaveBeenCalledWith(
      container,
      expect.any(Function),
    );
    resolveReset();
  });

  it('does not complete refresh login from stale status while relogin is preparing', async () => {
    (service as any).sessions.set('session-preparing', {
      containerId: 'container-preparing',
      containerName: 'napcat-preparing',
      createdAt: Date.now(),
      errorMessage: 'NapCat 正在重置登录态并生成二维码，请稍后',
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
    expect(result.errorMessage).toBe(
      'NapCat 正在重置登录态并生成二维码，请稍后',
    );
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
