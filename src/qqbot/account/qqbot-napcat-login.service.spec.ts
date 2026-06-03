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
    jest
      .spyOn(service as any, 'callRefreshQrcode')
      .mockResolvedValue('new-qrcode-image');
    const getQrcode = jest.spyOn(service as any, 'getQrcode');

    const result = await service.refreshQrcode('session-1');

    expect(result.qrcode).toBe('new-qrcode-image');
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
