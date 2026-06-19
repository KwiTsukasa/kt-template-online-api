import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { QqbotPluginHttpClientService } from '../../../../src/modules/qqbot/plugin-platform/infrastructure/integration/sdk/plugin-http-client.service';

describe('QQBot plugin HTTP client redirect resolver', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    server = http.createServer((request, response) => {
      if (request.url === '/short') {
        response.writeHead(302, { Location: '/video/BV1xx411c7mD' });
        response.end();
        return;
      }
      if (request.url === '/loop') {
        response.writeHead(302, { Location: '/loop2' });
        response.end();
        return;
      }
      if (request.url === '/loop2') {
        response.writeHead(302, { Location: '/loop' });
        response.end();
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.end('ok');
    });
    await new Promise<void>((resolveListen) => {
      server.listen(0, '127.0.0.1', resolveListen);
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  });

  it('returns the final URL and redirect chain for relative Location headers', async () => {
    await expect(
      new QqbotPluginHttpClientService().resolveRedirect({
        maxRedirects: 3,
        timeoutMs: 1000,
        url: `${baseUrl}/short`,
      }),
    ).resolves.toEqual({
      finalUrl: `${baseUrl}/video/BV1xx411c7mD`,
      redirects: [`${baseUrl}/video/BV1xx411c7mD`],
    });
  });

  it('rejects redirect loops after the configured limit', async () => {
    await expect(
      new QqbotPluginHttpClientService().resolveRedirect({
        maxRedirects: 1,
        timeoutMs: 1000,
        url: `${baseUrl}/loop`,
      }),
    ).rejects.toThrow('插件 HTTP 重定向超过上限');
  });

  it('rejects non-http protocols before requesting them', async () => {
    await expect(
      new QqbotPluginHttpClientService().resolveRedirect({
        url: 'file:///etc/passwd',
      }),
    ).rejects.toThrow('插件 HTTP 重定向仅支持 http/https');
  });
});
