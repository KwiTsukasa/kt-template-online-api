import { SunshineMobileClient } from '../../../../src/modules/admin/platform-config/mobile-home/infrastructure/sunshine-mobile.client';

describe('SunshineMobileClient', () => {
  const configValues: Record<string, string> = {
    ENV_DASHBOARD_SUNSHINE_PASSWORD: 'test-password',
    ENV_DASHBOARD_SUNSHINE_URL: 'https://10.66.66.4:39000',
    ENV_DASHBOARD_SUNSHINE_USERNAME: 'test-user',
  };
  const config = {
    get: jest.fn((key: string) => configValues[key] || ''),
    missing: jest.fn(() => []),
  };
  const http = { request: jest.fn() };
  const client = new SunshineMobileClient(config as any, http as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('derives the fixed GameStream port family from the configured Web UI port', () => {
    expect(client.host()).toBe('10.66.66.4');
    expect(client.streamPort()).toBe(38999);
    expect(client.httpsPort()).toBe(38994);
  });

  it('accepts a pairing PIN only when Sunshine returns status true', async () => {
    http.request
      .mockResolvedValueOnce({ data: { status: false }, status: 200 })
      .mockResolvedValueOnce({ data: { status: true }, status: 200 });

    await expect(client.submitPin('1234', 'KwiCore')).resolves.toBe(false);
    await expect(client.submitPin('1234', 'KwiCore')).resolves.toBe(true);
    expect(http.request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: { name: 'KwiCore', pin: '1234' },
        method: 'POST',
        url: 'https://10.66.66.4:39000/api/pin',
      }),
    );
    expect(http.request.mock.calls[1][0].headers).not.toHaveProperty('Origin');
    expect(http.request.mock.calls[1][0].headers).not.toHaveProperty('Referer');
  });
});
