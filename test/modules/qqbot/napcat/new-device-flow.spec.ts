import { NapcatLoginApiClient } from '../../../../src/modules/qqbot/napcat';

describe('NapCat new-device flow API client', () => {
  it('runs GetNewDeviceQRCode -> PollNewDeviceQR -> NewDeviceLogin with normalized states', async () => {
    const calls: Array<{ body: unknown; path: string }> = [];
    const client = new NapcatLoginApiClient({
      post: jest.fn(async (path: string, body: unknown) => {
        calls.push({ body, path });
        if (path.endsWith('/GetNewDeviceQRCode')) {
          return {
            newDevicePullQrCodeSig: 'sig-1',
            qrcodeUrl: 'data:image/png;base64,new-device',
          };
        }
        if (path.endsWith('/PollNewDeviceQR') && calls.length === 2) {
          return { status: 'scanned' };
        }
        if (path.endsWith('/PollNewDeviceQR') && calls.length === 3) {
          return { status: 'confirming' };
        }
        if (path.endsWith('/NewDeviceLogin')) {
          return { message: 'ok', success: true };
        }
        throw new Error(`unexpected path ${path}`);
      }),
    });

    const qr = await client.getNewDeviceQRCode('session-1');
    const scanned = await client.pollNewDeviceQR('session-1');
    const confirming = await client.pollNewDeviceQR('session-1');
    const verified = await client.newDeviceLogin('session-1');

    expect(qr).toEqual({
      pullQrCodeSig: 'sig-1',
      qrcodeUrl: 'data:image/png;base64,new-device',
      sessionId: 'session-1',
      status: 'qr-pending',
    });
    expect(scanned.status).toBe('scanned');
    expect(confirming.status).toBe('confirming');
    expect(verified).toEqual({
      message: 'ok',
      sessionId: 'session-1',
      status: 'verified',
      success: true,
    });
    expect(calls).toEqual([
      {
        body: { sessionId: 'session-1' },
        path: '/api/QQLogin/GetNewDeviceQRCode',
      },
      {
        body: { sessionId: 'session-1' },
        path: '/api/QQLogin/PollNewDeviceQR',
      },
      {
        body: { sessionId: 'session-1' },
        path: '/api/QQLogin/PollNewDeviceQR',
      },
      {
        body: { sessionId: 'session-1' },
        path: '/api/QQLogin/NewDeviceLogin',
      },
    ]);
  });

  it('normalizes waiting, expired, and failed poll responses without exposing jumpUrl as the completion mechanism', async () => {
    const client = new NapcatLoginApiClient({
      post: jest
        .fn()
        .mockResolvedValueOnce({ jumpUrl: 'https://qq.example/new-device' })
        .mockResolvedValueOnce({ status: 'waiting' })
        .mockResolvedValueOnce({ status: 'expired', message: 'expired' })
        .mockResolvedValueOnce({ status: 'failed', message: 'denied' }),
    });

    await expect(client.getNewDeviceQRCode('session-2')).rejects.toThrow(
      'NapCat 未返回新设备验证二维码',
    );
    await expect(client.pollNewDeviceQR('session-2')).resolves.toEqual({
      message: undefined,
      sessionId: 'session-2',
      status: 'qr-pending',
    });
    await expect(client.pollNewDeviceQR('session-2')).resolves.toEqual({
      message: 'expired',
      sessionId: 'session-2',
      status: 'expired',
    });
    await expect(client.pollNewDeviceQR('session-2')).resolves.toEqual({
      message: 'denied',
      sessionId: 'session-2',
      status: 'failed',
    });
  });
});
