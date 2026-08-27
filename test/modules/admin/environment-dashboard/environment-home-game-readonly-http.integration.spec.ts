import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HomeAssistantReadonlyAdapter } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/adapters/home-assistant-readonly.adapter';
import { SunshineReadonlyAdapter } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/adapters/sunshine-readonly.adapter';
import { EnvironmentReadonlyHttpClient } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/adapters/environment-readonly-http.client';
import { EnvironmentDashboardConfigService } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/environment-dashboard-config.service';

describe('Home Assistant and Sunshine real readonly HTTP boundary', () => {
  let baseUrl: string;
  let server: Server;
  const requests: Array<{
    authorization?: string;
    method?: string;
    url?: string;
  }> = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      requests.push({
        authorization: request.headers.authorization,
        method: request.method,
        url: request.url,
      });
      if (
        request.method === 'GET' &&
        request.url === '/ha/api/' &&
        request.headers.authorization === 'Bearer ha-local-secret'
      ) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ message: 'API running.' }));
        return;
      }
      if (
        request.method === 'GET' &&
        request.url === '/sunshine/api/apps' &&
        request.headers.authorization ===
          `Basic ${Buffer.from('sun-user:sun-local-secret').toString('base64')}`
      ) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify([{ name: 'Desktop' }]));
        return;
      }
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'unauthorized' }));
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });

  it('uses the shared HTTP client for two exact authenticated GET paths', async () => {
    const http = new EnvironmentReadonlyHttpClient({ timeoutMs: 1000 });
    const homeAssistant = new HomeAssistantReadonlyAdapter(
      new EnvironmentDashboardConfigService({
        ENV_DASHBOARD_HOME_ASSISTANT_TOKEN: 'ha-local-secret',
        ENV_DASHBOARD_HOME_ASSISTANT_URL: `${baseUrl}/ha/`,
      }),
      http,
    );
    const sunshine = new SunshineReadonlyAdapter(
      new EnvironmentDashboardConfigService({
        ENV_DASHBOARD_SUNSHINE_PASSWORD: 'sun-local-secret',
        ENV_DASHBOARD_SUNSHINE_URL: `${baseUrl}/sunshine/`,
        ENV_DASHBOARD_SUNSHINE_USERNAME: 'sun-user',
      }),
      http,
    );

    const [homeSignal, gameSignal] = await Promise.all([
      homeAssistant.inspect(),
      sunshine.inspect(),
    ]);

    expect(homeSignal.status).toBe('ok');
    expect(gameSignal.status).toBe('ok');
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'GET', url: '/ha/api/' }),
        expect.objectContaining({
          method: 'GET',
          url: '/sunshine/api/apps',
        }),
      ]),
    );
    expect(requests.every((request) => request.method === 'GET')).toBe(true);
    expect(JSON.stringify(homeSignal)).not.toContain('ha-local-secret');
    expect(JSON.stringify(gameSignal)).not.toContain('sun-local-secret');
    expect(JSON.stringify(gameSignal)).not.toContain('Desktop');
  });
});
