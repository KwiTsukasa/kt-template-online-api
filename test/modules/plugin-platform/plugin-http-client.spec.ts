import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { PluginHttpClientService } from '../../../src/modules/plugin-platform/infrastructure/integration/sdk/plugin-http-client.service';

describe('QQBot plugin HTTP client redirect resolver', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    server = http.createServer((request, response) => {
      if (request.url === '/large') {
        response.writeHead(200, { 'Content-Length': 1024 });
        response.end(Buffer.alloc(1024));
        return;
      }
      if (request.url === '/chunked') {
        response.writeHead(200, { 'Transfer-Encoding': 'chunked' });
        response.write(Buffer.alloc(80));
        response.end(Buffer.alloc(80));
        return;
      }
      if (request.url === '/slow') {
        const timer = setInterval(() => response.write('.'), 10);
        response.once('close', () => clearInterval(timer));
        return;
      }
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
      if (request.url === '/missing') {
        response.writeHead(404, { 'Content-Type': 'text/plain' });
        response.end('missing');
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
    await new Promise<void>((resolveClose) =>
      server.close(() => resolveClose()),
    );
  });

  it('returns the final URL and redirect chain for relative Location headers', async () => {
    await expect(
      new PluginHttpClientService().resolveRedirect({
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
      new PluginHttpClientService().resolveRedirect({
        maxRedirects: 1,
        timeoutMs: 1000,
        url: `${baseUrl}/loop`,
      }),
    ).rejects.toThrow('插件 HTTP 重定向超过上限');
  });

  it('rejects non-http protocols before requesting them', async () => {
    await expect(
      new PluginHttpClientService().resolveRedirect({
        url: 'file:///etc/passwd',
      }),
    ).rejects.toThrow('插件 HTTP 重定向仅支持 http/https');
  });

  it('rejects HTTP error statuses while resolving redirects', async () => {
    await expect(
      new PluginHttpClientService().resolveRedirect({
        timeoutMs: 1000,
        url: `${baseUrl}/missing`,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('bounds declared and streamed binary response sizes while preserving ordinary requests', async () => {
    const client = new PluginHttpClientService();
    for (const path of ['/large', '/chunked']) {
      await expect(
        client.requestBuffer({
          url: baseUrl + path,
          maxResponseBytes: 100,
          timeoutMs: 1000,
        }),
      ).rejects.toThrow('响应超过大小上限');
    }
    await expect(
      client.requestBuffer({ url: baseUrl, maxResponseBytes: 100 }),
    ).resolves.toEqual(Buffer.from('ok'));
    await expect(
      client.requestBuffer({ url: baseUrl + '/large' }),
    ).resolves.toHaveLength(1024);
  });

  it('enforces a total deadline for bounded downloads even when bytes keep arriving', async () => {
    const started = Date.now();
    await expect(
      new PluginHttpClientService().requestBuffer({
        url: baseUrl + '/slow',
        maxResponseBytes: 1024,
        timeoutMs: 100,
      }),
    ).rejects.toThrow('请求超时');
    expect(Date.now() - started).toBeLessThan(1200);
  });
});
