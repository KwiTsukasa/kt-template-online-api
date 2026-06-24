import * as proxyModule from '../../../../src/apps/napcat-webui-gateway/infrastructure/proxy/napcat-webui-proxy.service';

describe('NapcatWebuiProxyService response rewriting', () => {
  it('keeps NapCat WebUI absolute resource and API paths inside the Gateway session', () => {
    const rewriteNapcatTextResponse = (
      proxyModule as {
        rewriteNapcatTextResponse?: (input: {
          body: string;
          sessionId: string;
        }) => string;
      }
    ).rewriteNapcatTextResponse;

    expect(typeof rewriteNapcatTextResponse).toBe('function');

    const rewritten = rewriteNapcatTextResponse?.({
      body: [
        '<script type="module" src="/webui/assets/index.js"></script>',
        '<link rel="stylesheet" href="/webui/assets/index.css">',
        '<script>const baseURL="/api"; const file="/File/list?path=%2F"; const theme="/files/theme.css";</script>',
        'url("/webui/fonts/CustomFont.woff")',
      ].join(''),
      sessionId: 'sess_1',
    });

    expect(rewritten).toContain(
      'src="/napcat-webui/session/sess_1/webui/webui/assets/index.js"',
    );
    expect(rewritten).toContain(
      'href="/napcat-webui/session/sess_1/webui/webui/assets/index.css"',
    );
    expect(rewritten).toContain(
      'baseURL="/napcat-webui/session/sess_1/webui/api"',
    );
    expect(rewritten).toContain('file="/File/list?path=%2F"');
    expect(rewritten).not.toContain('/webui/api/napcat-webui/session');
    expect(rewritten).toContain(
      'theme="/napcat-webui/session/sess_1/webui/files/theme.css"',
    );
    expect(rewritten).toContain(
      'url("/napcat-webui/session/sess_1/webui/webui/fonts/CustomFont.woff")',
    );
    expect(rewritten).not.toContain('"/webui/assets');
    expect(rewritten).not.toContain('"/api"');
  });

  it('injects a Gateway-only browser token so NapCat WebUI can enter authenticated routes without leaking secrets', () => {
    const rewriteNapcatTextResponse = (
      proxyModule as {
        rewriteNapcatTextResponse?: (input: {
          body: string;
          sessionId: string;
        }) => string;
      }
    ).rewriteNapcatTextResponse;

    expect(typeof rewriteNapcatTextResponse).toBe('function');

    const rewritten = rewriteNapcatTextResponse?.({
      body: [
        '<!doctype html><html><head>',
        '<script type="module" src="/webui/assets/index.js"></script>',
        '</head><body></body></html>',
      ].join(''),
      sessionId: 'sess_1',
    });

    expect(rewritten).toContain('data-kt-napcat-webui-gateway-sso');
    expect(rewritten).toContain('localStorage.setItem("token"');
    expect(rewritten).toContain('kt-napcat-webui-gateway:sess_1');
    expect(rewritten).not.toContain('Credential');
    expect(rewritten).not.toContain('webui-token-fixture');
  });

  it('keeps non-HTML text responses free of Gateway browser-token injection', () => {
    const rewriteNapcatTextResponse = (
      proxyModule as {
        rewriteNapcatTextResponse?: (input: {
          body: string;
          sessionId: string;
        }) => string;
      }
    ).rewriteNapcatTextResponse;

    const rewritten = rewriteNapcatTextResponse?.({
      body: 'const baseURL="/api";',
      sessionId: 'sess_1',
    });

    expect(rewritten).not.toContain('localStorage.setItem("token"');
  });

  it('replaces browser terminal WebSocket token query with the server-side Credential', () => {
    const rewriteNapcatWebSocketSearch = (
      proxyModule as {
        rewriteNapcatWebSocketSearch?: (input: {
          credential: string;
          search: string;
          upstreamPath: string;
        }) => string;
      }
    ).rewriteNapcatWebSocketSearch;

    expect(typeof rewriteNapcatWebSocketSearch).toBe('function');

    expect(
      rewriteNapcatWebSocketSearch?.({
        credential: 'credential-1',
        search: '?id=terminal-1&token=browser-dummy',
        upstreamPath: '/api/ws/terminal',
      }),
    ).toBe('?id=terminal-1&token=credential-1');
    expect(
      rewriteNapcatWebSocketSearch?.({
        credential: 'credential-1',
        search: '?id=other&token=browser-dummy',
        upstreamPath: '/api/ws/other',
      }),
    ).toBe('?id=other&token=browser-dummy');
  });

  it('does not buffer NapCat API or SSE responses for text rewriting', () => {
    const shouldRewriteNapcatTextResponse = (
      proxyModule as {
        shouldRewriteNapcatTextResponse?: (upstreamPath: string) => boolean;
      }
    ).shouldRewriteNapcatTextResponse;

    expect(typeof shouldRewriteNapcatTextResponse).toBe('function');
    expect(shouldRewriteNapcatTextResponse?.('/api/Log/GetLogRealTime')).toBe(
      false,
    );
    expect(
      shouldRewriteNapcatTextResponse?.('/api/base/GetSysStatusRealTime'),
    ).toBe(false);
    expect(shouldRewriteNapcatTextResponse?.('/webui')).toBe(true);
    expect(shouldRewriteNapcatTextResponse?.('/webui/assets/index.js')).toBe(
      true,
    );
    expect(
      shouldRewriteNapcatTextResponse?.('/webui/fonts/CustomFont.woff'),
    ).toBe(false);
  });
});
