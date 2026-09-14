import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import {
  isPublicAddress,
  extractPage,
  readWeb,
} from '../../../../src/modules/plugins/hermes-agent/assets/web-reader/kt-web.mjs';

test('private, mapped, reserved and DNS rebinding destinations never reach transport', async () => {
  for (const ip of [
    '127.0.0.1',
    '10.66.66.2',
    '172.17.0.12',
    '192.168.1.1',
    '100.64.0.1',
    '169.254.169.254',
    '192.0.2.1',
    '::1',
    '::ffff:127.0.0.1',
    '2001:db8::1',
    '2001::1',
    '2001:0:4136:e378:8000:63bf:3fff:fdd2',
    '3fff::1',
  ])
    assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress('1.1.1.1'), true);
  assert.equal(isPublicAddress('2606:4700::1111'), true);
  let calls = 0;
  const dependencies = {
    lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    download: async () => {
      calls++;
    },
  };
  await assert.rejects(
    readWeb({ url: 'https://rebind.example' }, dependencies),
    /内网/,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    readWeb({ url: 'https://example.com:8443/' }),
    /自定义端口/,
  );
});

test('real HTTP source extraction removes scripts, paginates text and checks every redirect', async () => {
  const article =
    '这是从来源实际读取的长篇正文，包含可核对的信息和段落，而不是搜索摘要。'.repeat(
      80,
    );
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html;charset=utf-8');
    res.end(
      `<html><head><title>来源标题</title></head><body><nav>导航栏</nav><article><h1>正文标题</h1><p>${article}</p></article><script>neverExecute()</script><footer>页脚内容</footer></body></html>`,
    );
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  const dependencies = {
    lookup: async () => [{ address: '93.184.215.14', family: 4 }],
    download: async (url, addresses, signal) => {
      assert.equal(addresses[0].address, '93.184.215.14');
      const result = await fetch(`http://127.0.0.1:${port}${url.pathname}`, {
        signal,
      });
      return {
        status: result.status,
        headers: Object.fromEntries(result.headers),
        body: Buffer.from(await result.arrayBuffer()),
      };
    },
  };
  try {
    const first = await readWeb(
      { url: 'https://example.com/article', limit: 100 },
      dependencies,
    );
    assert.equal(first.status, 'ok');
    assert.equal(first.backend, 'nas-direct');
    assert.equal(first.text.length, 100);
    assert.equal(first.hasMore, true);
    const next = await readWeb(
      { url: first.source, offset: first.nextOffset, limit: 100 },
      dependencies,
    );
    assert.equal(next.offset, 100);
    assert.doesNotMatch(first.text, /neverExecute|页脚内容|导航栏/);
    let redirects = 0;
    await assert.rejects(
      readWeb(
        { url: 'https://example.com/redirect' },
        {
          ...dependencies,
          download: async () => {
            redirects++;
            return { status: 302, headers: { location: 'http://10.66.66.2/' } };
          },
        },
      ),
      /内网/,
    );
    assert.equal(redirects, 1);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('login forms and script-only pages are not returned as evidence', () => {
  assert.equal(
    extractPage(
      '<html><head><title>登录</title></head><body><form><input type="password"></form></body></html>',
      'https://example.com',
    ).status,
    'access_required',
  );
  assert.equal(
    extractPage(
      '<html><body><div id="app"></div><script>loadData()</script></body></html>',
      'https://example.com',
    ).status,
    'browser_required',
  );
});
