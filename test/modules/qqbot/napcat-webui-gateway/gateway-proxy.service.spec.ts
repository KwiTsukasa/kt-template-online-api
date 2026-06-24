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
        '<script>const baseURL="/api"; const file="/File/font/upload/webui";</script>',
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
    expect(rewritten).toContain(
      'file="/napcat-webui/session/sess_1/webui/File/font/upload/webui"',
    );
    expect(rewritten).toContain(
      'url("/napcat-webui/session/sess_1/webui/webui/fonts/CustomFont.woff")',
    );
    expect(rewritten).not.toContain('"/webui/assets');
    expect(rewritten).not.toContain('"/api"');
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
