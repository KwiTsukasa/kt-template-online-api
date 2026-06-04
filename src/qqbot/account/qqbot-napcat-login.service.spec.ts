jest.mock(
  '@/common',
  () => ({
    ensureSnowflakeId: jest.fn(),
    setDictDecodeCache: jest.fn(),
    throwVbenError: (message: string) => {
      throw new Error(message);
    },
  }),
  { virtual: true },
);

import { ConfigService } from '@nestjs/config';
import { QqbotNapcatContainerService } from '../napcat/qqbot-napcat-container.service';
import { QqbotAccountService } from './qqbot-account.service';
import { QqbotNapcatLoginService } from './qqbot-napcat-login.service';

describe('QqbotNapcatLoginService', () => {
  const service = new QqbotNapcatLoginService(
    { get: jest.fn() } as unknown as ConfigService,
    {} as QqbotAccountService,
    {} as QqbotNapcatContainerService,
  );

  beforeEach(() => {
    (service as any).sessions.clear();
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
        mode: 'refresh',
      },
      existingContainer,
    );
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
    expect((service as any).getQrcode).toHaveBeenCalledWith(container, true, {
      requireFresh: true,
      staleQrcode: 'old-qrcode',
    });
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
    );
    jest.spyOn(refreshService as any, 'sleep').mockResolvedValue(undefined);
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
    jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);
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
