import { NapcatLoginApiClient } from '../../../../src/modules/qqbot/napcat';

describe('NapCat new-device flow API client', () => {
  it('runs GetNewDeviceQRCode -> PollNewDeviceQR -> NewDeviceLogin with NapCat WebUI payloads', async () => {
    const calls: Array<{ body: unknown; path: string }> = [];
    const pullQrCodeSig = { key: 'sig-1' };
    const client = new NapcatLoginApiClient({
      post: jest.fn(async (path: string, body: unknown) => {
        calls.push({ body, path });
        if (path.endsWith('/GetNewDeviceQRCode')) {
          return {
            bytes_token: 'bytes-1',
            newDevicePullQrCodeSig: pullQrCodeSig,
            str_url: 'https://qq.example/new-device/qr?str_url=https%3A%2F%2Fproof.qq.com%2Ftoken',
          };
        }
        if (path.endsWith('/PollNewDeviceQR') && calls.length === 2) {
          return { status: 'scanned' };
        }
        if (path.endsWith('/PollNewDeviceQR') && calls.length === 3) {
          return { status: 'confirming' };
        }
        if (path.endsWith('/NewDeviceLogin')) {
          return { message: 'ok', status: 'ok' };
        }
        throw new Error(`unexpected path ${path}`);
      }),
    });

    const qr = await client.getNewDeviceQRCode({
      jumpUrl: 'https://accounts.qq.com/safe/verify?sid=sid-1',
      uin: '10001',
    });
    const scanned = await client.pollNewDeviceQR({
      bytesToken: qr.bytesToken,
      uin: '10001',
    });
    const confirming = await client.pollNewDeviceQR({
      bytesToken: qr.bytesToken,
      uin: '10001',
    });
    const verified = await client.newDeviceLogin({
      newDevicePullQrCodeSig: pullQrCodeSig,
      passwordMd5: '0123456789abcdef0123456789abcdef',
      uin: '10001',
    });

    expect(qr).toMatchObject({
      bytesToken: 'bytes-1',
      deviceVerifyUrl: 'https://accounts.qq.com/safe/verify?sid=sid-1',
      pullQrCodeSig,
      status: 'qr-pending',
    });
    expect(qr.qrcodeUrl).toMatch(/^data:image\/png;base64,/);
    expect(scanned.status).toBe('scanned');
    expect(confirming.status).toBe('confirming');
    expect(verified).toEqual({
      message: 'ok',
      status: 'verified',
      success: true,
    });
    expect(calls).toEqual([
      {
        body: {
          jumpUrl: 'https://accounts.qq.com/safe/verify?sid=sid-1',
          uin: '10001',
        },
        path: '/api/QQLogin/GetNewDeviceQRCode',
      },
      {
        body: { bytesToken: 'bytes-1', uin: '10001' },
        path: '/api/QQLogin/PollNewDeviceQR',
      },
      {
        body: { bytesToken: 'bytes-1', uin: '10001' },
        path: '/api/QQLogin/PollNewDeviceQR',
      },
      {
        body: {
          newDevicePullQrCodeSig: pullQrCodeSig,
          passwordMd5: '0123456789abcdef0123456789abcdef',
          uin: '10001',
        },
        path: '/api/QQLogin/NewDeviceLogin',
      },
    ]);
  });

  it('derives bytesToken from str_url when NapCat omits bytes_token', async () => {
    const rawProofUrl = 'https://proof.qq.com/token?a=1&b=2';
    const strUrl = `https://qq.example/new-device/qr?str_url=${encodeURIComponent(rawProofUrl)}`;
    const client = new NapcatLoginApiClient({
      post: jest
        .fn()
        .mockResolvedValueOnce({ str_url: strUrl })
        .mockResolvedValueOnce({ status: 'waiting' })
        .mockResolvedValueOnce({ status: 'expired', message: 'expired' })
        .mockResolvedValueOnce({ status: 'failed', message: 'denied' }),
    });

    const qr = await client.getNewDeviceQRCode({
      jumpUrl: 'https://accounts.qq.com/safe/verify?sid=sid-2',
      uin: '10002',
    });

    expect(qr).toMatchObject({
      bytesToken: Buffer.from(rawProofUrl, 'utf8').toString('base64'),
      deviceVerifyUrl: 'https://accounts.qq.com/safe/verify?sid=sid-2',
      status: 'qr-pending',
    });
    expect(qr.qrcodeUrl).toMatch(/^data:image\/png;base64,/);
    expect(qr.qrcodeUrl).not.toBe(strUrl);
    await expect(
      client.pollNewDeviceQR({ bytesToken: qr.bytesToken, uin: '10002' }),
    ).resolves.toEqual({
      message: undefined,
      status: 'qr-pending',
    });
    await expect(
      client.pollNewDeviceQR({ bytesToken: qr.bytesToken, uin: '10002' }),
    ).resolves.toEqual({
      message: 'expired',
      status: 'expired',
    });
    await expect(
      client.pollNewDeviceQR({ bytesToken: qr.bytesToken, uin: '10002' }),
    ).resolves.toEqual({
      message: 'denied',
      status: 'failed',
    });
  });

  it('normalizes NewDeviceLogin status-only failures', async () => {
    const client = new NapcatLoginApiClient({
      post: jest.fn().mockResolvedValue({
        message: 'denied',
        status: 'failed',
      }),
    });

    await expect(
      client.newDeviceLogin({
        newDevicePullQrCodeSig: 'sig-1',
        passwordMd5: '0123456789abcdef0123456789abcdef',
        uin: '10001',
      }),
    ).resolves.toEqual({
      message: 'denied',
      status: 'failed',
      success: false,
    });
  });
});
