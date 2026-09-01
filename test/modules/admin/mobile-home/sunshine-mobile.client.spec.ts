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

  it('projects the latest capture resolution and configured virtual display without logs', async () => {
    http.request
      .mockResolvedValueOnce({
        data: [
          '[2026-08-31 08:30:40.968]: Info: Desktop resolution [1920x1200]',
          '[2026-08-31 09:43:58.902]: Info: Desktop resolution [3200x1440]',
          'Currently available display devices:',
          '[',
          '  {',
          '    "device_id": "{virtual-display-id}",',
          '    "friendly_name": "VDD by MTT",',
          '    "info": { "resolution": { "width": 2560, "height": 1600 } }',
          '  }',
          ']',
        ].join('\n'),
        status: 200,
      })
      .mockResolvedValueOnce({
        data: {
          dd_configuration_option: 'ensure_active',
          dd_resolution_option: 'auto',
          output_name: '{virtual-display-id}',
        },
        status: 200,
      });

    await expect(client.displayState()).resolves.toEqual({
      resolution: '3200x1440',
      virtualDisplayReady: true,
    });
    expect(http.request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: 'GET',
        url: 'https://10.66.66.4:39000/api/logs',
      }),
    );
    expect(http.request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: 'GET',
        url: 'https://10.66.66.4:39000/api/config',
      }),
    );
  });

  it('uses the configured VDD mode after a cold restart before the first stream', async () => {
    http.request
      .mockResolvedValueOnce({
        data: [
          'Currently available display devices:',
          '[',
          '  {',
          '    "device_id": "{physical-display-id}",',
          '    "friendly_name": "NE160QDM-NZL",',
          '    "info": { "resolution": { "width": 2560, "height": 1600 } }',
          '  },',
          '  {',
          '    "device_id": "{virtual-display-id}",',
          '    "friendly_name": "VDD by MTT",',
          '    "info": { "resolution": { "width": 2560, "height": 1600 } }',
          '  }',
          ']',
        ].join('\n'),
        status: 200,
      })
      .mockResolvedValueOnce({
        data: {
          dd_configuration_option: 'ensure_active',
          dd_resolution_option: 'auto',
          output_name: '{virtual-display-id}',
        },
        status: 200,
      });

    await expect(client.displayState()).resolves.toEqual({
      resolution: '2560x1600',
      virtualDisplayReady: true,
    });
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
