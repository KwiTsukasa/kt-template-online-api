import { createServer, type Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { CodexAppServerReadonlyAdapter } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/adapters/codex-app-server-readonly.adapter';
import { HomeAssistantReadonlyAdapter } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/adapters/home-assistant-readonly.adapter';
import { MihomoReadonlyAdapter } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/adapters/mihomo-readonly.adapter';
import { SunshineReadonlyAdapter } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/adapters/sunshine-readonly.adapter';
import { WireguardReadonlyAdapter } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/adapters/wireguard-readonly.adapter';
import { EnvironmentReadonlyHttpClient } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/adapters/environment-readonly-http.client';
import { EnvironmentDashboardConfigService } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/environment-dashboard-config.service';

const TEST_TLS_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDB0+OmJHz7yUOL
KEu1GR2Gi9lSH3R8Q7Uh/Tw+uHKsVzgfIl4Hh3mOota+TCtmySNBypXkMW7Sy57k
OwD8scgwZZVBayRAgosueHs4FlCnWjQH5Ft+glRsLOfuk7YkxeA1X9OE/OfB0G0r
O9f9peET6rDEsc8+IYeM+zYlHXOGhp2T5cTFbu4nZej7l6vZFeZpGVRSBH7PlIzA
PAtGs2Jr4ZABBbtJZiOFrGjwF8o84wWu7kf3AGk88G29H/TB0541oger/ETF7eAh
KoGd2JHzcI9o+yujjX5TyJRW/BFdm+ZuAu4UWMYne6CQp1WKklTEUgq9x5rZFXgb
yzkC7MMdAgMBAAECggEAAjaVgop8yYc6d+FQPqjNwdaLobjC5L8FLMvZH0I4lP0z
TS+1m9Jmh0QWvaTdrgEdSkgHlCEjCdHSEPsXf3XW5QPpQ2OiI1ZvmRU+cEfY80BA
GIL5WdAf1KhinEJ1hvqiHRnorru7OGb/3XQuet1PskwwvojlO+lixIUDJkNYKVtl
DIzvdMuINKrRW83q6LEsFnH7QWMgJkTwbCOueuavNQR6c/lIBgy01LU0bJxE7Wfb
quJYCl/COkR1DBIOTNIzkM+mrWh+RWRlyi1JAD9RCQW2ADxvNHKtPB5wDntOsPlV
sIqgWcYjR+RSO2I4uivAmnu9Xky5O/Wu/7RkeBGn5QKBgQDugzycvNrzP4nfnr0u
VH3yHcSDhz4YuY7nIb+Zjz1edft3qdRGqIGdM9K0wKOp9xslvhjAIihIwfbMlgrB
OQkCOMLs2nPq4RATGt2G1mqwT41LPTOGYg10hPAdMQgVgeE8vNb4LgigCVhs3V83
o5YRDVvZJunXNhIoaJ8DNeTqwwKBgQDQCfAyC+OS11EjQ1R82m5ogkVLtKL6wvof
CRHXWN91EUKHBjU4MVk4LkKubtiEgM7rbptJUyU78/S7ipjH0STKKoYbe36neXLH
AzI8R2Cr0MnxhDuxRPYrSf9KP18dLFcdXK44lcEFYXAhcTduKPWdJgZSpRa2D7Z3
7yIdsk38nwKBgGJdVV3+tP2ksqO6v6KfzeFQTX9BA2cG/9xqmq4l2NVgKvlK3PTX
Ab1nZfqNh/HMqzGBmIuEisCW3cW6C21srD5yUlGENlIjx5FZfwrg2tcjt83Ty7Ac
OBhZyvz+/6p/CfkWmEF6GqyFriYXlfFIUddufvaribzr28k2fH3CeEopAoGAOOj/
FDG8Z4cPYx4gFqeKXHyGiFc53m9IDQVmJArj1hqKoHVKSbz2MzA0fZNFF7pE4JK5
WC2umd/6qvMXKFJGRier2AjIdPf8NgTh0SuVfmr3U2JhEfVTgjQT6jO7yTc//YBF
CKWuz9H/4qYeC7yYtAya3jDbLaLOv7BjHMySGPECgYARpMy0+kuafAPKZvvjKeGK
VH6SKPgJVnDSALy6+YiDAWIvN0ClW0SHdEG44v4d8pL5h1AIj3XG3fooCvs/zbES
cqcPsLWlf8+FK1mvxB3E3apRYYPQ8fsW39NqiDDxSZx6uFeD/Q7YR4NLktEJt2dN
fkKp/j3vVymhIGQsD5TmkA==
-----END PRIVATE KEY-----`;

const TEST_TLS_CERT = `-----BEGIN CERTIFICATE-----
MIIDGjCCAgKgAwIBAgIUZHqWBtyu5B+Gfe/Gy2bixT6N78gwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJMTI3LjAuMC4xMB4XDTI2MDgyNzEyMzQxOFoXDTI2MDgy
OTEyMzQxOFowFDESMBAGA1UEAwwJMTI3LjAuMC4xMIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAwdPjpiR8+8lDiyhLtRkdhovZUh90fEO1If08PrhyrFc4
HyJeB4d5jqLWvkwrZskjQcqV5DFu0sue5DsA/LHIMGWVQWskQIKLLnh7OBZQp1o0
B+RbfoJUbCzn7pO2JMXgNV/ThPznwdBtKzvX/aXhE+qwxLHPPiGHjPs2JR1zhoad
k+XExW7uJ2Xo+5er2RXmaRlUUgR+z5SMwDwLRrNia+GQAQW7SWYjhaxo8BfKPOMF
ru5H9wBpPPBtvR/0wdOeNaIHq/xExe3gISqBndiR83CPaPsro41+U8iUVvwRXZvm
bgLuFFjGJ3ugkKdVipJUxFIKvcea2RV4G8s5AuzDHQIDAQABo2QwYjAdBgNVHQ4E
FgQUPlHGXisU1eBS9df/6M1QXVgZXtUwHwYDVR0jBBgwFoAUPlHGXisU1eBS9df/
6M1QXVgZXtUwDwYDVR0TAQH/BAUwAwEB/zAPBgNVHREECDAGhwR/AAABMA0GCSqG
SIb3DQEBCwUAA4IBAQBf3XDNbNIIp0P8o8Ce5xaqDRrtU3XIfFBZrVy3y77BY+Yb
l/P3+BQ51XUpw8rK6lc4IEXQHB5EaymhbvRHjHaIoELzQ+g/2BjAem90ChORro1T
0XPXib4O9N4/sjJXGOc+8NL81SFDVO1fDx5KUKdQCLXDiISKDmXWvzFouYURGLcD
vNXRCCwZ3Q8HWFxCEyJ1CBhzD+HOMOHdL3HtY6nGXF+Ftgbw9QeBIAX7RTfg6T6i
IskCbCLltcDUTTenZ5ZJJYRW6+F1+dezRIf0o2E62vyiJSFKlvhwNlvqAPfRSp0Y
RYD58DFxdRn3GyGG7TFCWXcMcRpUi3gfnpZBAF/R
-----END CERTIFICATE-----`;

describe('Home Assistant and Sunshine real readonly HTTP boundary', () => {
  let baseUrl: string;
  let server: Server;
  let tlsBaseUrl: string;
  let tlsServer: Server;
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
      if (request.method === 'GET' && request.url === '/codex/readyz') {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('private readiness detail');
        return;
      }
      if (request.method === 'GET' && request.url === '/r4se/') {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end('private router page');
        return;
      }
      if (
        request.method === 'GET' &&
        request.url?.startsWith('/mihomo/') &&
        request.headers.authorization === 'Bearer mihomo-local-secret'
      ) {
        response.writeHead(200, { 'content-type': 'application/json' });
        if (request.url === '/mihomo/version') {
          response.end(JSON.stringify({ version: '1.19.0' }));
          return;
        }
        if (request.url === '/mihomo/configs') {
          response.end(JSON.stringify({ mode: 'rule' }));
          return;
        }
        response.end(JSON.stringify({ proxies: { DIRECT: {}, Proxy: {} } }));
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

    tlsServer = createHttpsServer(
      { cert: TEST_TLS_CERT, key: TEST_TLS_KEY },
      (request, response) => {
        requests.push({
          authorization: request.headers.authorization,
          method: request.method,
          url: request.url,
        });
        if (
          request.method === 'GET' &&
          request.url === '/api/apps' &&
          request.headers.authorization ===
            `Basic ${Buffer.from('sun-user:sun-local-secret').toString('base64')}`
        ) {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify([{ name: 'Desktop' }]));
          return;
        }
        if (
          request.method === 'GET' &&
          request.url === '/api/' &&
          request.headers.authorization === 'Bearer ha-local-secret'
        ) {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ message: 'API running.' }));
          return;
        }
        response.writeHead(401);
        response.end();
      },
    );
    await new Promise<void>((resolve) => {
      tlsServer.listen(0, '127.0.0.1', resolve);
    });
    const tlsAddress = tlsServer.address() as AddressInfo;
    tlsBaseUrl = `https://127.0.0.1:${tlsAddress.port}`;
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
    await new Promise<void>((resolve, reject) => {
      tlsServer.close((error) => {
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
        ENV_DASHBOARD_SUNSHINE_URL: tlsBaseUrl,
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
          url: '/api/apps',
        }),
      ]),
    );
    expect(requests.every((request) => request.method === 'GET')).toBe(true);
    expect(JSON.stringify(homeSignal)).not.toContain('ha-local-secret');
    expect(JSON.stringify(gameSignal)).not.toContain('sun-local-secret');
    expect(JSON.stringify(gameSignal)).not.toContain('Desktop');
  });

  it('allows self-signed TLS only for the fixed Sunshine adapter request', async () => {
    const http = new EnvironmentReadonlyHttpClient({ timeoutMs: 1000 });
    const sunshine = new SunshineReadonlyAdapter(
      new EnvironmentDashboardConfigService({
        ENV_DASHBOARD_SUNSHINE_PASSWORD: 'sun-local-secret',
        ENV_DASHBOARD_SUNSHINE_URL: tlsBaseUrl,
        ENV_DASHBOARD_SUNSHINE_USERNAME: 'sun-user',
      }),
      http,
    );
    const homeAssistant = new HomeAssistantReadonlyAdapter(
      new EnvironmentDashboardConfigService({
        ENV_DASHBOARD_HOME_ASSISTANT_TOKEN: 'ha-local-secret',
        ENV_DASHBOARD_HOME_ASSISTANT_URL: tlsBaseUrl,
      }),
      http,
    );

    const sunshineSignal = await sunshine.inspect();
    const homeAssistantSignal = await homeAssistant.inspect();

    expect(sunshineSignal.status).toBe('ok');
    expect(homeAssistantSignal.status).toBe('degraded');
    expect(homeAssistantSignal.summary).toMatch(
      /certificate has expired|self-signed certificate/u,
    );
    expect(JSON.stringify(sunshineSignal)).not.toContain('Desktop');
    expect(JSON.stringify(sunshineSignal)).not.toContain('sun-local-secret');
  });

  it('uses fixed read-only paths for Codex App Server, R4SE WireGuard, and Mihomo', async () => {
    const http = new EnvironmentReadonlyHttpClient({ timeoutMs: 1000 });
    const codex = new CodexAppServerReadonlyAdapter(
      new EnvironmentDashboardConfigService({
        ENV_DASHBOARD_CODEX_APP_SERVER_URL: `${baseUrl}/codex/`,
      }),
      http,
    );
    const wireguard = new WireguardReadonlyAdapter(
      new EnvironmentDashboardConfigService({
        ENV_DASHBOARD_R4SE_WIREGUARD_HEALTH_URL: `${baseUrl}/r4se/`,
      }),
      http,
    );
    const mihomo = new MihomoReadonlyAdapter(
      new EnvironmentDashboardConfigService({
        ENV_DASHBOARD_R4SE_MIHOMO_SECRET: 'mihomo-local-secret',
        ENV_DASHBOARD_R4SE_MIHOMO_URL: `${baseUrl}/mihomo/`,
      }),
      http,
    );

    const [codexSignal, wireguardSignal, mihomoSignal] = await Promise.all([
      codex.inspect(),
      wireguard.inspect(),
      mihomo.inspect(),
    ]);

    expect([
      codexSignal.status,
      wireguardSignal.status,
      mihomoSignal.status,
    ]).toEqual(['ok', 'ok', 'ok']);
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'GET', url: '/codex/readyz' }),
        expect.objectContaining({ method: 'GET', url: '/r4se/' }),
        expect.objectContaining({ method: 'GET', url: '/mihomo/version' }),
        expect.objectContaining({ method: 'GET', url: '/mihomo/configs' }),
        expect.objectContaining({ method: 'GET', url: '/mihomo/proxies' }),
      ]),
    );
    expect(JSON.stringify(codexSignal)).not.toContain(
      'private readiness detail',
    );
    expect(JSON.stringify(wireguardSignal)).not.toContain(
      'private router page',
    );
    expect(JSON.stringify(mihomoSignal)).not.toContain('mihomo-local-secret');
  });
});
