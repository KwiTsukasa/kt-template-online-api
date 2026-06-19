# QQBot Bilibili Card Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a QQBot built-in event plugin that parses Bilibili links from QQ/NapCat card messages and replies with a concise video summary.

**Architecture:** Add a new third-phase plugin package under `src/modules/qqbot/plugins/bilibili-card`. Keep parsing and formatting in package-local domain files, keep Bilibili HTTP and short-link redirect access behind the generic plugin host bridge, and keep activation controlled by existing account plugin bindings.

**Tech Stack:** NestJS 11 host platform, QQBot plugin worker thread runtime, Jest, TypeScript, Node `http`/`https` for host-mediated HTTP, existing `pnpm` scripts.

---

## File Structure

Create:

- `src/modules/qqbot/plugins/bilibili-card/plugin.json`  
  Built-in plugin manifest: key, event, runtime budget, permissions, config keys, no command operations.
- `src/modules/qqbot/plugins/bilibili-card/src/index.ts`  
  Package entry. Exports only `createPlugin`.
- `src/modules/qqbot/plugins/bilibili-card/src/domain/bilibili-card.types.ts`  
  Package-local message, host, config, video and reference types.
- `src/modules/qqbot/plugins/bilibili-card/src/domain/bilibili-url-parser.ts`  
  Pure URL cleanup, domain allowlist and BV/av extraction.
- `src/modules/qqbot/plugins/bilibili-card/src/domain/bilibili-url-extractor.ts`  
  Pure recursive extraction from normalized message and raw OneBot card payloads.
- `src/modules/qqbot/plugins/bilibili-card/src/domain/bilibili-reply-formatter.ts`  
  Pure text reply formatting and number/duration formatting.
- `src/modules/qqbot/plugins/bilibili-card/src/config/bilibili-card-config.ts`  
  Runtime config parsing from package host.
- `src/modules/qqbot/plugins/bilibili-card/src/infrastructure/integration/bilibili-card-host.ts`  
  Package-local host adapter types and generic worker host calls.
- `src/modules/qqbot/plugins/bilibili-card/src/infrastructure/integration/bilibili-video-client.ts`  
  Host-mediated Bilibili video API client.
- `src/modules/qqbot/plugins/bilibili-card/src/application/bilibili-card-application.ts`  
  Binding check, dedupe, redirect resolution, API fetch, send and warn orchestration.
- `src/modules/qqbot/plugins/bilibili-card/src/events/message/bilibili-card-message.handler.ts`  
  Event handler factory that delegates `message` events to the application.
- `test/modules/qqbot/plugins/bilibili-card/bilibili-url-parser.spec.ts`
- `test/modules/qqbot/plugins/bilibili-card/bilibili-url-extractor.spec.ts`
- `test/modules/qqbot/plugins/bilibili-card/bilibili-video-client.spec.ts`
- `test/modules/qqbot/plugins/bilibili-card/bilibili-card-application.spec.ts`
- `test/modules/qqbot/plugin-platform/plugin-http-client.spec.ts`

Modify:

- `src/modules/qqbot/plugin-platform/infrastructure/integration/sdk/plugin-http-client.service.ts`  
  Add bounded `resolveRedirect` generic HTTP capability.
- `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/plugin-host-bridge.service.ts`  
  Dispatch `resolveRedirect` host calls to the plugin HTTP client.
- `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/plugin-worker.thread.ts`  
  Add an explicit argument mapper for `resolveRedirect`.
- `test/modules/qqbot/plugin-platform/plugin-host-bridge.spec.ts`  
  Assert bridge delegates `resolveRedirect`.
- `test/modules/qqbot/plugins/plugin-platform-migration.spec.ts`  
  Include `bilibili-card` in plugin discovery and manifest parse expectations.
- `test/modules/qqbot/architecture/qqbot-plugin-package-boundary.spec.ts`  
  Include `bilibili-card` in approved built-in plugin keys and structure gates.
- `test/modules/qqbot/architecture/qqbot-current-operation-matrix.spec.ts`  
  Freeze `bilibili-card` event capability and keep command seed checks command-only.
- `sql/refactor-v3/01-seed-core.sql`  
  Seed `bilibili-card` plugin, version, installation and event handler metadata.
- `sql/refactor-v3/99-verify.sql`  
  Add seed verification for `bilibili-card`.
- `TASKS.md`  
  Record implementation evidence after code and verification.

Do not create:

- `src/modules/qqbot/plugin-platform/infrastructure/integration/builtins/**`
- per-plugin Nest wrapper services
- `src/modules/qqbot/plugins/bilibili-card/src/index.ts` re-export buckets
- `.gitkeep`
- command operation metadata for this plugin

---

### Task 1: Pure Bilibili URL Parser

**Files:**
- Create: `test/modules/qqbot/plugins/bilibili-card/bilibili-url-parser.spec.ts`
- Create: `src/modules/qqbot/plugins/bilibili-card/src/domain/bilibili-card.types.ts`
- Create: `src/modules/qqbot/plugins/bilibili-card/src/domain/bilibili-url-parser.ts`

- [ ] **Step 1: Write the failing parser tests**

Create `test/modules/qqbot/plugins/bilibili-card/bilibili-url-parser.spec.ts`:

```ts
import {
  cleanBilibiliUrlCandidate,
  isAllowedBilibiliUrl,
  parseBilibiliVideoReference,
} from '../../../../../src/modules/qqbot/plugins/bilibili-card/src/domain/bilibili-url-parser';

describe('Bilibili URL parser', () => {
  it('parses BV video URLs while ignoring query, hash, and trailing punctuation', () => {
    const reference = parseBilibiliVideoReference(
      'https://www.bilibili.com/video/BV1xx411c7mD/?share_source=qq#reply。',
    );

    expect(reference).toEqual({
      canonicalVideoId: 'BV1xx411c7mD',
      kind: 'bvid',
      sourceUrl:
        'https://www.bilibili.com/video/BV1xx411c7mD/?share_source=qq#reply',
      value: 'BV1xx411c7mD',
    });
  });

  it('parses av video URLs from mobile Bilibili links', () => {
    expect(
      parseBilibiliVideoReference('https://m.bilibili.com/video/av170001'),
    ).toMatchObject({
      canonicalVideoId: 'av170001',
      kind: 'aid',
      value: '170001',
    });
  });

  it('allows only Bilibili and b23.tv hosts', () => {
    expect(isAllowedBilibiliUrl('https://b23.tv/abc123')).toBe(true);
    expect(isAllowedBilibiliUrl('https://space.bilibili.com/1')).toBe(true);
    expect(isAllowedBilibiliUrl('https://example.com/video/BV1xx411c7mD')).toBe(
      false,
    );
  });

  it('cleans card wrappers, html entities, and trailing brackets', () => {
    expect(
      cleanBilibiliUrlCandidate(
        '&quot;https://www.bilibili.com/video/BV1xx411c7mD?p=1&quot;）',
      ),
    ).toBe('https://www.bilibili.com/video/BV1xx411c7mD?p=1');
  });
});
```

- [ ] **Step 2: Run the parser tests and verify RED**

Run:

```powershell
pnpm exec jest --runTestsByPath test/modules/qqbot/plugins/bilibili-card/bilibili-url-parser.spec.ts --runInBand
```

Expected: FAIL because `bilibili-url-parser.ts` does not exist.

- [ ] **Step 3: Add parser types and minimal implementation**

Create `src/modules/qqbot/plugins/bilibili-card/src/domain/bilibili-card.types.ts`:

```ts
export type BilibiliVideoReference =
  | {
      canonicalVideoId: string;
      kind: 'bvid';
      sourceUrl: string;
      value: string;
    }
  | {
      canonicalVideoId: string;
      kind: 'aid';
      sourceUrl: string;
      value: string;
    };
```

Create `src/modules/qqbot/plugins/bilibili-card/src/domain/bilibili-url-parser.ts`:

```ts
import type { BilibiliVideoReference } from './bilibili-card.types';

const ALLOWED_HOSTS = new Set([
  'b23.tv',
  'bilibili.com',
  'm.bilibili.com',
  'www.bilibili.com',
]);

const TRAILING_WRAPPERS = /[\s"'<>，。！？、；：）)\]}]+$/u;
const LEADING_WRAPPERS = /^[\s"'<>（([{]+/u;
const BVID_PATTERN = /(?:^|\/)(BV[0-9A-Za-z]{10,})/;
const AID_PATTERN = /(?:^|\/)(?:av|AV)(\d+)(?:$|[/?#])/;

/**
 * Removes QQ card wrappers and punctuation that often stick to copied URLs.
 * @param candidate - Raw string fragment found in text or card JSON.
 * @returns Cleaned URL candidate ready for `URL` parsing.
 */
export function cleanBilibiliUrlCandidate(candidate: string) {
  return candidate
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#34;', '"')
    .replace(LEADING_WRAPPERS, '')
    .replace(TRAILING_WRAPPERS, '')
    .trim();
}

/**
 * Checks whether a URL belongs to the Bilibili domains this plugin is allowed to parse.
 * @param candidate - URL string collected from a QQ message or redirect result.
 * @returns `true` when the host is Bilibili-owned or `b23.tv`.
 */
export function isAllowedBilibiliUrl(candidate: string) {
  try {
    const url = new URL(cleanBilibiliUrlCandidate(candidate));
    return (
      url.protocol === 'http:' ||
      url.protocol === 'https:'
    ) && ALLOWED_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Extracts a Bilibili video identifier from a supported URL.
 * @param candidate - Direct Bilibili video URL or short-link URL that already embeds BV/av.
 * @returns Parsed video reference, or `null` when the URL is not a supported video URL.
 */
export function parseBilibiliVideoReference(
  candidate: string,
): BilibiliVideoReference | null {
  const cleaned = cleanBilibiliUrlCandidate(candidate);
  if (!isAllowedBilibiliUrl(cleaned)) return null;

  const url = new URL(cleaned);
  const probe = `${url.pathname}${url.search}${url.hash}`;
  const bvid = probe.match(BVID_PATTERN)?.[1];
  if (bvid) {
    return {
      canonicalVideoId: bvid,
      kind: 'bvid',
      sourceUrl: cleaned,
      value: bvid,
    };
  }

  const aid = `${url.pathname}/`.match(AID_PATTERN)?.[1];
  if (aid) {
    return {
      canonicalVideoId: `av${aid}`,
      kind: 'aid',
      sourceUrl: cleaned,
      value: aid,
    };
  }

  return null;
}
```

- [ ] **Step 4: Run the parser tests and verify GREEN**

Run:

```powershell
pnpm exec jest --runTestsByPath test/modules/qqbot/plugins/bilibili-card/bilibili-url-parser.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit parser slice**

```powershell
git add test/modules/qqbot/plugins/bilibili-card/bilibili-url-parser.spec.ts src/modules/qqbot/plugins/bilibili-card/src/domain/bilibili-card.types.ts src/modules/qqbot/plugins/bilibili-card/src/domain/bilibili-url-parser.ts
git commit -m "feat: 添加Bilibili链接解析域逻辑"
```

---

### Task 2: RawEvent URL Extractor

**Files:**
- Create: `test/modules/qqbot/plugins/bilibili-card/bilibili-url-extractor.spec.ts`
- Modify: `src/modules/qqbot/plugins/bilibili-card/src/domain/bilibili-card.types.ts`
- Create: `src/modules/qqbot/plugins/bilibili-card/src/domain/bilibili-url-extractor.ts`

- [ ] **Step 1: Write the failing extractor tests**

Create `test/modules/qqbot/plugins/bilibili-card/bilibili-url-extractor.spec.ts`:

```ts
import { extractBilibiliUrls } from '../../../../../src/modules/qqbot/plugins/bilibili-card/src/domain/bilibili-url-extractor';

describe('Bilibili URL extractor', () => {
  it('extracts links from messageText and rawMessage while deduplicating them', () => {
    expect(
      extractBilibiliUrls({
        messageText:
          '看看 https://www.bilibili.com/video/BV1xx411c7mD',
        rawMessage:
          '重复 https://www.bilibili.com/video/BV1xx411c7mD?share=qq',
        rawEvent: {},
      }),
    ).toEqual([
      'https://www.bilibili.com/video/BV1xx411c7mD',
      'https://www.bilibili.com/video/BV1xx411c7mD?share=qq',
    ]);
  });

  it('extracts a QQ share card URL', () => {
    const urls = extractBilibiliUrls({
      messageText: '',
      rawMessage: '',
      rawEvent: {
        message: [
          {
            data: {
              content: '夏祭 视频',
              title: 'Bilibili',
              url: 'https://www.bilibili.com/video/BV1xx411c7mD',
            },
            type: 'share',
          },
        ],
      },
    });

    expect(urls).toEqual(['https://www.bilibili.com/video/BV1xx411c7mD']);
  });

  it('extracts nested URLs from json and lightapp cards', () => {
    const payload = JSON.stringify({
      app: 'com.tencent.structmsg',
      meta: {
        detail: {
          jumpUrl: 'https://b23.tv/abc123',
        },
      },
    });

    expect(
      extractBilibiliUrls({
        messageText: '',
        rawMessage: '',
        rawEvent: {
          message: [
            { data: { data: payload }, type: 'json' },
            { data: { data: payload }, type: 'lightapp' },
          ],
        },
      }),
    ).toEqual(['https://b23.tv/abc123']);
  });

  it('extracts URLs from xml card text and ignores non-Bilibili URLs', () => {
    expect(
      extractBilibiliUrls({
        messageText: 'https://example.com/video/BV1xx411c7mD',
        rawMessage: '',
        rawEvent: {
          message: [
            {
              data: {
                data: '<msg url="https://m.bilibili.com/video/av170001" />',
              },
              type: 'xml',
            },
          ],
        },
      }),
    ).toEqual(['https://m.bilibili.com/video/av170001']);
  });
});
```

- [ ] **Step 2: Run the extractor tests and verify RED**

Run:

```powershell
pnpm exec jest --runTestsByPath test/modules/qqbot/plugins/bilibili-card/bilibili-url-extractor.spec.ts --runInBand
```

Expected: FAIL because `bilibili-url-extractor.ts` does not exist.

- [ ] **Step 3: Add extraction types and implementation**

Extend `src/modules/qqbot/plugins/bilibili-card/src/domain/bilibili-card.types.ts`:

```ts
export type BilibiliUrlExtractionInput = {
  messageText?: string;
  rawEvent?: Record<string, unknown>;
  rawMessage?: string;
};
```

Create `src/modules/qqbot/plugins/bilibili-card/src/domain/bilibili-url-extractor.ts`:

```ts
import type { BilibiliUrlExtractionInput } from './bilibili-card.types';
import {
  cleanBilibiliUrlCandidate,
  isAllowedBilibiliUrl,
} from './bilibili-url-parser';

const URL_PATTERN = /https?:\/\/[^\s<>"'，。！？；、]+/giu;
const MAX_DEPTH = 7;

/**
 * Extracts Bilibili URL candidates from normalized message text and raw QQ card payloads.
 * @param input - Normalized QQBot message fields and raw OneBot event payload from NapCat.
 * @returns Unique allowed Bilibili URL strings in discovery order.
 */
export function extractBilibiliUrls(input: BilibiliUrlExtractionInput) {
  const candidates = collectStringCandidates(input);
  const seen = new Set<string>();
  const output: string[] = [];

  for (const text of candidates) {
    for (const rawUrl of text.match(URL_PATTERN) || []) {
      const cleaned = cleanBilibiliUrlCandidate(rawUrl);
      if (!isAllowedBilibiliUrl(cleaned) || seen.has(cleaned)) continue;
      seen.add(cleaned);
      output.push(cleaned);
    }
  }

  return output;
}

/**
 * Collects string values that may contain links from text fields and nested QQ card objects.
 * @param input - Extraction input built from normalized message state.
 * @returns Candidate strings that may contain URLs.
 */
function collectStringCandidates(input: BilibiliUrlExtractionInput) {
  const output: string[] = [];
  const seen = new WeakSet<object>();
  pushText(output, input.messageText);
  pushText(output, input.rawMessage);
  collectUnknown(input.rawEvent, output, seen, 0);
  return output;
}

/**
 * Walks unknown card payload data while bounding recursion and parsing JSON-looking strings.
 * @param value - Unknown raw value from OneBot message segments or nested card fields.
 * @param output - Mutable candidate string list.
 * @param seen - Object identity set used to avoid cyclic payloads.
 * @param depth - Current recursion depth used to bound malformed payloads.
 */
function collectUnknown(
  value: unknown,
  output: string[],
  seen: WeakSet<object>,
  depth: number,
) {
  if (depth > MAX_DEPTH || value == null) return;
  if (typeof value === 'string') {
    pushText(output, value);
    collectJsonString(value, output, seen, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item) => collectUnknown(item, output, seen, depth + 1));
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (shouldCollectKey(key) || typeof nestedValue !== 'object') {
      collectUnknown(nestedValue, output, seen, depth + 1);
    } else {
      collectUnknown(nestedValue, output, seen, depth + 1);
    }
  }
}

/**
 * Parses a JSON card string when possible and ignores invalid JSON without aborting extraction.
 * @param value - Raw string that may be JSON.
 * @param output - Mutable candidate string list.
 * @param seen - Object identity set shared with the recursive walk.
 * @param depth - Recursion depth for the parsed value.
 */
function collectJsonString(
  value: string,
  output: string[],
  seen: WeakSet<object>,
  depth: number,
) {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return;
  try {
    collectUnknown(JSON.parse(trimmed), output, seen, depth);
  } catch {
    return;
  }
}

/**
 * Adds a non-empty string candidate to the output list.
 * @param output - Mutable candidate string list.
 * @param value - Candidate value from normalized text or raw card payload.
 */
function pushText(output: string[], value: unknown) {
  if (typeof value === 'string' && value.trim()) {
    output.push(value);
  }
}

/**
 * Identifies QQ card field names that commonly carry target URLs.
 * @param key - Raw object key from a card payload.
 * @returns `true` when the key name suggests URL content.
 */
function shouldCollectKey(key: string) {
  return /url|jump|qqdocurl|source/i.test(key);
}
```

- [ ] **Step 4: Run parser and extractor tests**

Run:

```powershell
pnpm exec jest --runTestsByPath test/modules/qqbot/plugins/bilibili-card/bilibili-url-parser.spec.ts test/modules/qqbot/plugins/bilibili-card/bilibili-url-extractor.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit extractor slice**

```powershell
git add test/modules/qqbot/plugins/bilibili-card/bilibili-url-extractor.spec.ts src/modules/qqbot/plugins/bilibili-card/src/domain/bilibili-card.types.ts src/modules/qqbot/plugins/bilibili-card/src/domain/bilibili-url-extractor.ts
git commit -m "feat: 提取QQ卡片中的Bilibili链接"
```

---

### Task 3: Plugin Host Redirect Capability

**Files:**
- Create: `test/modules/qqbot/plugin-platform/plugin-http-client.spec.ts`
- Modify: `src/modules/qqbot/plugin-platform/infrastructure/integration/sdk/plugin-http-client.service.ts`
- Modify: `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/plugin-host-bridge.service.ts`
- Modify: `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/plugin-worker.thread.ts`
- Modify: `test/modules/qqbot/plugin-platform/plugin-host-bridge.spec.ts`

- [ ] **Step 1: Write failing HTTP redirect tests**

Create `test/modules/qqbot/plugin-platform/plugin-http-client.spec.ts`:

```ts
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
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
```

Add this failing assertion to `test/modules/qqbot/plugin-platform/plugin-host-bridge.spec.ts`:

```ts
it('delegates resolveRedirect host calls to the plugin HTTP client', async () => {
  const options = {
    maxRedirects: 3,
    timeoutMs: 1000,
    url: 'https://b23.tv/abc123',
  };
  httpClient.resolveRedirect.mockResolvedValue({
    finalUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
    redirects: ['https://www.bilibili.com/video/BV1xx411c7mD'],
  });

  await expect(
    bridge.handleHostCall(createDescriptor(), {
      args: { input: options },
      method: 'resolveRedirect',
      pluginKey: 'sample',
    }),
  ).resolves.toEqual({
    ok: true,
    value: {
      finalUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
      redirects: ['https://www.bilibili.com/video/BV1xx411c7mD'],
    },
  });
  expect(httpClient.resolveRedirect).toHaveBeenCalledWith(options);
});
```

Also extend the test fixture type in `plugin-host-bridge.spec.ts`:

```ts
let httpClient: {
  requestBuffer: jest.Mock;
  requestJson: jest.Mock;
  resolveRedirect: jest.Mock;
};
```

and fixture object:

```ts
httpClient = {
  requestBuffer: jest.fn(),
  requestJson: jest.fn().mockResolvedValue({ ok: true }),
  resolveRedirect: jest.fn(),
};
```

- [ ] **Step 2: Run redirect tests and verify RED**

Run:

```powershell
pnpm exec jest --runTestsByPath test/modules/qqbot/plugin-platform/plugin-http-client.spec.ts test/modules/qqbot/plugin-platform/plugin-host-bridge.spec.ts --runInBand
```

Expected: FAIL because `resolveRedirect` is missing.

- [ ] **Step 3: Implement host HTTP redirect resolution**

Modify `src/modules/qqbot/plugin-platform/infrastructure/integration/sdk/plugin-http-client.service.ts`:

```ts
export type QqbotPluginResolveRedirectRequest = {
  context?: string;
  headers?: Record<string, string>;
  maxRedirects?: number;
  timeoutMessage?: string;
  timeoutMs?: number;
  url: string | URL;
};

export type QqbotPluginRedirectResult = {
  finalUrl: string;
  redirects: string[];
};
```

Add methods inside `QqbotPluginHttpClientService`:

```ts
  /**
   * Resolves an HTTP redirect chain without exposing response bodies to plugin code.
   * @param input - URL, timeout and redirect budget supplied by a plugin host call.
   * @returns Final URL and every redirect target followed in order.
   */
  async resolveRedirect(
    input: QqbotPluginResolveRedirectRequest,
  ): Promise<QqbotPluginRedirectResult> {
    const maxRedirects = Math.max(0, input.maxRedirects ?? 5);
    let currentUrl = normalizeHttpUrl(input.url);
    const redirects: string[] = [];

    for (let index = 0; index <= maxRedirects; index += 1) {
      const nextUrl = await this.readRedirectLocation(currentUrl, input);
      if (!nextUrl) {
        return { finalUrl: currentUrl.toString(), redirects };
      }
      redirects.push(nextUrl.toString());
      currentUrl = nextUrl;
    }

    throw new Error('插件 HTTP 重定向超过上限');
  }

  /**
   * Reads one HTTP response header set and returns the next redirect target when present.
   * @param url - Current HTTP URL being probed.
   * @param input - Original redirect request carrying headers and timeout.
   * @returns Next URL for 3xx responses, or `null` for a non-redirect response.
   */
  private readRedirectLocation(
    url: URL,
    input: QqbotPluginResolveRedirectRequest,
  ): Promise<URL | null> {
    const timeoutMs = input.timeoutMs || 8000;
    const context = input.context || '插件 HTTP 重定向';

    return new Promise<URL | null>((resolveRedirect, reject) => {
      const client = url.protocol === 'http:' ? http : https;
      const request = client.request(
        url,
        {
          headers: {
            Accept: '*/*',
            'User-Agent': 'kt-template-online-api/qqbot-plugin',
            ...(input.headers || {}),
          },
          method: 'GET',
          timeout: timeoutMs,
        },
        (response) => {
          response.resume();
          const statusCode = response.statusCode || 500;
          const location = response.headers.location;
          if (statusCode >= 300 && statusCode < 400 && location) {
            try {
              resolveRedirect(normalizeHttpUrl(new URL(location, url)));
            } catch (error) {
              reject(error);
            }
            return;
          }
          if (statusCode >= 400) {
            reject(createPluginHttpError(`${context}请求失败：${statusCode}`, statusCode));
            return;
          }
          resolveRedirect(null);
        },
      );
      request.on('timeout', () => {
        request.destroy(new Error(input.timeoutMessage || `${context}请求超时`));
      });
      request.on('error', reject);
      request.end();
    });
  }
```

Add module helper:

```ts
/**
 * Normalizes a redirect URL and rejects protocols outside plugin HTTP scope.
 * @param value - URL supplied directly or produced from a Location header.
 * @returns Normalized HTTP(S) URL.
 */
function normalizeHttpUrl(value: string | URL) {
  const url = value instanceof URL ? value : new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('插件 HTTP 重定向仅支持 http/https');
  }
  return url;
}
```

- [ ] **Step 4: Wire host bridge and worker mapper**

Modify `plugin-host-bridge.service.ts` switch:

```ts
      case 'resolveRedirect':
        return this.httpClient.resolveRedirect(getRedirectRequestOptions(args));
```

Add helper:

```ts
/**
 * Normalizes redirect options from `{ input }`, `{ options }`, or raw host-call arguments.
 * @param args - Worker-supplied host-call arguments.
 * @returns Redirect options safe to pass to QqbotPluginHttpClientService.
 */
function getRedirectRequestOptions(
  args: Record<string, unknown>,
): QqbotPluginResolveRedirectRequest {
  const candidate = args.input || args.options || args;
  if (!isRecord(candidate)) {
    throw new Error('Plugin host redirect options must be an object');
  }
  return candidate as QqbotPluginResolveRedirectRequest;
}
```

Import the type:

```ts
  type QqbotPluginResolveRedirectRequest,
```

Modify `plugin-worker.thread.ts` mapper:

```ts
  resolveRedirect: (input) => ({ input }),
```

- [ ] **Step 5: Run redirect tests and verify GREEN**

Run:

```powershell
pnpm exec jest --runTestsByPath test/modules/qqbot/plugin-platform/plugin-http-client.spec.ts test/modules/qqbot/plugin-platform/plugin-host-bridge.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit host redirect slice**

```powershell
git add test/modules/qqbot/plugin-platform/plugin-http-client.spec.ts test/modules/qqbot/plugin-platform/plugin-host-bridge.spec.ts src/modules/qqbot/plugin-platform/infrastructure/integration/sdk/plugin-http-client.service.ts src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/plugin-host-bridge.service.ts src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/plugin-worker.thread.ts
git commit -m "feat: 增加QQBot插件受限重定向能力"
```

---

### Task 4: Bilibili Video Client and Reply Formatter

**Files:**
- Create: `test/modules/qqbot/plugins/bilibili-card/bilibili-video-client.spec.ts`
- Modify: `src/modules/qqbot/plugins/bilibili-card/src/domain/bilibili-card.types.ts`
- Create: `src/modules/qqbot/plugins/bilibili-card/src/domain/bilibili-reply-formatter.ts`
- Create: `src/modules/qqbot/plugins/bilibili-card/src/config/bilibili-card-config.ts`
- Create: `src/modules/qqbot/plugins/bilibili-card/src/infrastructure/integration/bilibili-card-host.ts`
- Create: `src/modules/qqbot/plugins/bilibili-card/src/infrastructure/integration/bilibili-video-client.ts`

- [ ] **Step 1: Write failing client and formatter tests**

Create `test/modules/qqbot/plugins/bilibili-card/bilibili-video-client.spec.ts`:

```ts
import { readBilibiliCardRuntimeConfig } from '../../../../../src/modules/qqbot/plugins/bilibili-card/src/config/bilibili-card-config';
import { formatBilibiliVideoReply } from '../../../../../src/modules/qqbot/plugins/bilibili-card/src/domain/bilibili-reply-formatter';
import { BilibiliVideoClient } from '../../../../../src/modules/qqbot/plugins/bilibili-card/src/infrastructure/integration/bilibili-video-client';

describe('Bilibili video client', () => {
  it('fetches a BV video through the plugin host and normalizes the response', async () => {
    const host = createHost({
      code: 0,
      data: {
        aid: 170001,
        bvid: 'BV1xx411c7mD',
        desc: '第一行\n第二行',
        duration: 125,
        owner: { name: 'UP主' },
        pic: 'https://i0.hdslb.com/bfs/archive/test.jpg',
        stat: { danmaku: 456, like: 7890, view: 123456 },
        title: '夏祭',
      },
    });
    const client = new BilibiliVideoClient(host);

    await expect(
      client.fetchVideo(
        {
          canonicalVideoId: 'BV1xx411c7mD',
          kind: 'bvid',
          sourceUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
          value: 'BV1xx411c7mD',
        },
        { descMaxLength: 80, dedupeTtlMs: 600000, httpTimeoutMs: 6000, maxRedirects: 5 },
      ),
    ).resolves.toMatchObject({
      aid: 170001,
      bvid: 'BV1xx411c7mD',
      duration: 125,
      ownerName: 'UP主',
      title: '夏祭',
    });
    expect(host.requestJson).toHaveBeenCalledWith(
      expect.objectContaining({
        timeoutMs: 6000,
        url: 'https://api.bilibili.com/x/web-interface/view?bvid=BV1xx411c7mD',
      }),
    );
  });

  it('throws a readable error when Bilibili returns an error code', async () => {
    const client = new BilibiliVideoClient(createHost({ code: -404, message: '啥都木有' }));

    await expect(
      client.fetchVideo(
        {
          canonicalVideoId: 'av170001',
          kind: 'aid',
          sourceUrl: 'https://m.bilibili.com/video/av170001',
          value: '170001',
        },
        { descMaxLength: 80, dedupeTtlMs: 600000, httpTimeoutMs: 6000, maxRedirects: 5 },
      ),
    ).rejects.toThrow('Bilibili 视频信息获取失败：啥都木有');
  });

  it('formats a concise text reply without echoing short links', () => {
    expect(
      formatBilibiliVideoReply(
        {
          aid: 170001,
          bvid: 'BV1xx411c7mD',
          desc: '第一行\n第二行',
          duration: 125,
          ownerName: 'UP主',
          pic: '',
          stat: { danmaku: 456, like: 7890, view: 123456 },
          title: '夏祭',
        },
        { descMaxLength: 6, dedupeTtlMs: 600000, httpTimeoutMs: 6000, maxRedirects: 5 },
      ),
    ).toBe(
      [
        'Bilibili 视频解析',
        '标题：夏祭',
        'UP：UP主',
        '时长：02:05',
        '播放：12.3万 弹幕：456 点赞：7890',
        '链接：https://www.bilibili.com/video/BV1xx411c7mD',
        '简介：第一行 第二…',
      ].join('\n'),
    );
  });
});

/**
 * Creates a package host fixture that returns one Bilibili API response.
 * @param response - API response returned by host-mediated `requestJson`.
 * @returns Host fixture used by the video client tests.
 */
function createHost(response: unknown) {
  return {
    getBoundEventPluginKeys: jest.fn(),
    getConfig: jest.fn(),
    requestJson: jest.fn().mockResolvedValue(response),
    resolveRedirect: jest.fn(),
    sendText: jest.fn(),
    warn: jest.fn(),
  };
}
```

- [ ] **Step 2: Run client tests and verify RED**

Run:

```powershell
pnpm exec jest --runTestsByPath test/modules/qqbot/plugins/bilibili-card/bilibili-video-client.spec.ts --runInBand
```

Expected: FAIL because config, formatter, host and client files do not exist.

- [ ] **Step 3: Add types, config, host and client**

Extend `bilibili-card.types.ts` with:

```ts
export type BilibiliCardRuntimeConfig = {
  descMaxLength: number;
  dedupeTtlMs: number;
  httpTimeoutMs: number;
  maxRedirects: number;
};

export type BilibiliCardPluginHost = {
  getBoundEventPluginKeys: (selfId: string) => Promise<string[]>;
  getConfig: <T = string>(key: string) => T | undefined;
  requestJson: <T = unknown>(input: {
    context?: string;
    failureMessageTemplate?: string;
    invalidJsonMessage?: string;
    timeoutMs?: number;
    url: string;
  }) => Promise<T>;
  resolveRedirect: (input: {
    maxRedirects?: number;
    timeoutMs?: number;
    url: string;
  }) => Promise<{ finalUrl: string; redirects: string[] }>;
  sendText: (input: {
    channelId?: string;
    guildId?: string;
    message: string;
    selfId: string;
    targetId: string;
    targetType: string;
  }) => Promise<unknown>;
  warn?: (message: string) => void;
};

export type BilibiliVideoInfo = {
  aid: number;
  bvid: string;
  desc: string;
  duration: number;
  ownerName: string;
  pic: string;
  stat: {
    danmaku: number;
    like: number;
    view: number;
  };
  title: string;
};
```

Create `config/bilibili-card-config.ts`:

```ts
import type {
  BilibiliCardPluginHost,
  BilibiliCardRuntimeConfig,
} from '../domain/bilibili-card.types';

const CONFIG_KEYS = {
  descMaxLength: 'QQBOT_BILIBILI_CARD_DESC_MAX_LENGTH',
  dedupeTtlMs: 'QQBOT_BILIBILI_CARD_DEDUPE_TTL_MS',
  httpTimeoutMs: 'QQBOT_BILIBILI_CARD_HTTP_TIMEOUT_MS',
  maxRedirects: 'QQBOT_BILIBILI_CARD_MAX_REDIRECTS',
} as const;

/**
 * Reads Bilibili card plugin runtime config from the package host snapshot.
 * @param host - Package host exposing manifest-owned config values.
 * @returns Runtime config with bounded numeric defaults.
 */
export function readBilibiliCardRuntimeConfig(
  host: Pick<BilibiliCardPluginHost, 'getConfig'>,
): BilibiliCardRuntimeConfig {
  return {
    descMaxLength: readNumber(host, CONFIG_KEYS.descMaxLength, 80, 0, 300),
    dedupeTtlMs: readNumber(host, CONFIG_KEYS.dedupeTtlMs, 600000, 0, 3600000),
    httpTimeoutMs: readNumber(host, CONFIG_KEYS.httpTimeoutMs, 6000, 1000, 15000),
    maxRedirects: readNumber(host, CONFIG_KEYS.maxRedirects, 5, 0, 10),
  };
}

/**
 * Reads and clamps one numeric plugin config value.
 * @param host - Package host exposing manifest-owned config values.
 * @param key - Runtime config key declared in plugin manifest.
 * @param fallback - Value used when the host does not provide a finite number.
 * @param min - Minimum accepted value.
 * @param max - Maximum accepted value.
 * @returns Bounded numeric config value.
 */
function readNumber(
  host: Pick<BilibiliCardPluginHost, 'getConfig'>,
  key: string,
  fallback: number,
  min: number,
  max: number,
) {
  const value = Number(host.getConfig(key));
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}
```

Create `infrastructure/integration/bilibili-card-host.ts`:

```ts
import type { BilibiliCardPluginHost } from '../../domain/bilibili-card.types';

/**
 * Builds the Bilibili card plugin host over generic worker host methods.
 * @param host - Generic worker host facade supplied by the plugin platform runtime.
 * @param configSnapshot - Manifest-owned config snapshot supplied at worker load time.
 * @returns Package-local host contract used by the application and video client.
 */
export function createBilibiliCardGenericHostAdapter(
  host: Record<string, unknown>,
  configSnapshot: Record<string, string | undefined>,
): BilibiliCardPluginHost {
  return {
    getBoundEventPluginKeys: (selfId) =>
      callGenericHost(host, 'getBoundEventPluginKeys', selfId),
    getConfig: <T = string>(key: string) => configSnapshot[key] as T | undefined,
    requestJson: (input) => callGenericHost(host, 'requestJson', input),
    resolveRedirect: (input) => callGenericHost(host, 'resolveRedirect', input),
    sendText: (input) => callGenericHost(host, 'sendText', input),
    warn: (message) => {
      void callGenericHost(host, 'warn', message).catch(() => undefined);
    },
  };
}

/**
 * Calls one generic worker host method and reports a package-owned error when absent.
 * @param host - Generic worker host facade.
 * @param method - Host capability name required by this plugin.
 * @param args - Positional arguments passed to the host facade method.
 * @returns Host method result cast to the package-local expected type.
 */
async function callGenericHost<TResult = any>(
  host: Record<string, unknown>,
  method: string,
  ...args: unknown[]
): Promise<TResult> {
  const fn = host[method];
  if (typeof fn !== 'function') {
    throw new Error(`Bilibili card generic host 缺少 ${method}`);
  }
  return (await fn(...args)) as TResult;
}
```

Create `infrastructure/integration/bilibili-video-client.ts`:

```ts
import type {
  BilibiliCardPluginHost,
  BilibiliCardRuntimeConfig,
  BilibiliVideoInfo,
  BilibiliVideoReference,
} from '../../domain/bilibili-card.types';

type BilibiliApiResponse = {
  code: number;
  data?: {
    aid?: number;
    bvid?: string;
    desc?: string;
    duration?: number;
    owner?: { name?: string };
    pic?: string;
    stat?: {
      danmaku?: number;
      like?: number;
      view?: number;
    };
    title?: string;
  };
  message?: string;
};

export class BilibiliVideoClient {
  /**
   * Initializes a Bilibili video client that can only access HTTP through the plugin host.
   * @param host - Package host exposing `requestJson` for manifest-authorized HTTP calls.
   */
  constructor(private readonly host: Pick<BilibiliCardPluginHost, 'requestJson'>) {}

  /**
   * Fetches and normalizes one Bilibili video detail response.
   * @param reference - Parsed BV or av reference used to build the public video API URL.
   * @param config - Runtime timeout config read from plugin settings.
   * @returns Normalized video fields used by the reply formatter.
   */
  async fetchVideo(
    reference: BilibiliVideoReference,
    config: BilibiliCardRuntimeConfig,
  ): Promise<BilibiliVideoInfo> {
    const response = await this.host.requestJson<BilibiliApiResponse>({
      context: 'Bilibili 视频信息',
      failureMessageTemplate: 'Bilibili 视频信息请求失败：{statusCode}',
      invalidJsonMessage: 'Bilibili 视频信息返回不是合法 JSON',
      timeoutMs: config.httpTimeoutMs,
      url: buildBilibiliVideoApiUrl(reference),
    });

    if (response.code !== 0) {
      throw new Error(
        `Bilibili 视频信息获取失败：${response.message || response.code}`,
      );
    }
    if (!response.data?.bvid) {
      throw new Error('Bilibili 视频信息缺少 bvid');
    }

    return {
      aid: Number(response.data.aid) || 0,
      bvid: response.data.bvid,
      desc: response.data.desc || '',
      duration: Number(response.data.duration) || 0,
      ownerName: response.data.owner?.name || '未知',
      pic: response.data.pic || '',
      stat: {
        danmaku: Number(response.data.stat?.danmaku) || 0,
        like: Number(response.data.stat?.like) || 0,
        view: Number(response.data.stat?.view) || 0,
      },
      title: response.data.title || '未知标题',
    };
  }
}

/**
 * Builds the Bilibili public video detail endpoint for one parsed video reference.
 * @param reference - Parsed BV or av video reference.
 * @returns Absolute Bilibili API URL.
 */
function buildBilibiliVideoApiUrl(reference: BilibiliVideoReference) {
  const query =
    reference.kind === 'bvid'
      ? `bvid=${encodeURIComponent(reference.value)}`
      : `aid=${encodeURIComponent(reference.value)}`;
  return `https://api.bilibili.com/x/web-interface/view?${query}`;
}
```

Create `domain/bilibili-reply-formatter.ts`:

```ts
import type {
  BilibiliCardRuntimeConfig,
  BilibiliVideoInfo,
} from './bilibili-card.types';

/**
 * Formats one Bilibili video as a concise QQ text reply.
 * @param video - Normalized video fields from the Bilibili API client.
 * @param config - Runtime config controlling description truncation.
 * @returns Multi-line text reply sent back to the QQ conversation.
 */
export function formatBilibiliVideoReply(
  video: BilibiliVideoInfo,
  config: Pick<BilibiliCardRuntimeConfig, 'descMaxLength'>,
) {
  const lines = [
    'Bilibili 视频解析',
    `标题：${video.title || '未知标题'}`,
    `UP：${video.ownerName || '未知'}`,
    `时长：${formatDuration(video.duration)}`,
    `播放：${formatCount(video.stat.view)} 弹幕：${formatCount(
      video.stat.danmaku,
    )} 点赞：${formatCount(video.stat.like)}`,
    `链接：https://www.bilibili.com/video/${video.bvid}`,
  ];
  const desc = truncateDescription(video.desc, config.descMaxLength);
  if (desc) lines.push(`简介：${desc}`);
  return lines.join('\n');
}

/**
 * Formats a duration in seconds as `mm:ss` or `hh:mm:ss`.
 * @param seconds - Video duration in seconds from Bilibili.
 * @returns Human-readable duration.
 */
function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainSeconds = safeSeconds % 60;
  const two = (value: number) => `${value}`.padStart(2, '0');
  if (hours > 0) return `${two(hours)}:${two(minutes)}:${two(remainSeconds)}`;
  return `${two(minutes)}:${two(remainSeconds)}`;
}

/**
 * Formats large Bilibili counters with a light Chinese `万` unit.
 * @param value - Raw numeric counter from Bilibili stat fields.
 * @returns Display string for reply text.
 */
function formatCount(value: number) {
  const safeValue = Math.max(0, Math.floor(value || 0));
  if (safeValue >= 10000) {
    const wan = safeValue / 10000;
    return `${Number.isInteger(wan) ? wan.toFixed(0) : wan.toFixed(1)}万`;
  }
  return `${safeValue}`;
}

/**
 * Normalizes and truncates a video description for compact QQ replies.
 * @param desc - Raw Bilibili description text.
 * @param maxLength - Maximum number of characters to keep before adding ellipsis.
 * @returns Cleaned and possibly truncated description text.
 */
function truncateDescription(desc: string, maxLength: number) {
  const cleaned = `${desc || ''}`.replace(/\s+/g, ' ').trim();
  if (!cleaned || maxLength <= 0) return '';
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength)}…`;
}
```

- [ ] **Step 4: Run client tests and verify GREEN**

Run:

```powershell
pnpm exec jest --runTestsByPath test/modules/qqbot/plugins/bilibili-card/bilibili-video-client.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit client slice**

```powershell
git add test/modules/qqbot/plugins/bilibili-card/bilibili-video-client.spec.ts src/modules/qqbot/plugins/bilibili-card/src/domain/bilibili-card.types.ts src/modules/qqbot/plugins/bilibili-card/src/domain/bilibili-reply-formatter.ts src/modules/qqbot/plugins/bilibili-card/src/config/bilibili-card-config.ts src/modules/qqbot/plugins/bilibili-card/src/infrastructure/integration/bilibili-card-host.ts src/modules/qqbot/plugins/bilibili-card/src/infrastructure/integration/bilibili-video-client.ts
git commit -m "feat: 添加Bilibili视频信息客户端"
```

---

### Task 5: Application, Event Handler and Plugin Entry

**Files:**
- Create: `test/modules/qqbot/plugins/bilibili-card/bilibili-card-application.spec.ts`
- Modify: `src/modules/qqbot/plugins/bilibili-card/src/domain/bilibili-card.types.ts`
- Create: `src/modules/qqbot/plugins/bilibili-card/src/application/bilibili-card-application.ts`
- Create: `src/modules/qqbot/plugins/bilibili-card/src/events/message/bilibili-card-message.handler.ts`
- Create: `src/modules/qqbot/plugins/bilibili-card/src/index.ts`
- Create: `src/modules/qqbot/plugins/bilibili-card/plugin.json`

- [ ] **Step 1: Write failing application tests**

Create `test/modules/qqbot/plugins/bilibili-card/bilibili-card-application.spec.ts`:

```ts
import { BilibiliCardApplication } from '../../../../../src/modules/qqbot/plugins/bilibili-card/src/application/bilibili-card-application';
import { createPlugin } from '../../../../../src/modules/qqbot/plugins/bilibili-card/src/index';

describe('Bilibili card application', () => {
  it('does nothing when the plugin is not bound to the account', async () => {
    const host = createHost({ boundKeys: [] });
    const app = new BilibiliCardApplication(host, createManifest(), () => 1000);

    await expect(app.handleMessage(createMessage())).resolves.toBe(false);
    expect(host.requestJson).not.toHaveBeenCalled();
    expect(host.sendText).not.toHaveBeenCalled();
  });

  it('ignores messages sent by the bot itself', async () => {
    const host = createHost({ boundKeys: ['bilibili-card'] });
    const app = new BilibiliCardApplication(host, createManifest(), () => 1000);

    await expect(
      app.handleMessage(createMessage({ userId: '10001' })),
    ).resolves.toBe(false);
    expect(host.requestJson).not.toHaveBeenCalled();
  });

  it('fetches video info and sends one summary for a bound account', async () => {
    const host = createHost({ boundKeys: ['bilibili-card'] });
    const app = new BilibiliCardApplication(host, createManifest(), () => 1000);

    await expect(app.handleMessage(createMessage())).resolves.toBe(true);

    expect(host.requestJson).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.bilibili.com/x/web-interface/view?bvid=BV1xx411c7mD',
      }),
    );
    expect(host.sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('标题：夏祭'),
        selfId: '10001',
        targetId: '20001',
        targetType: 'group',
      }),
    );
  });

  it('resolves b23.tv short links through the host before fetching video info', async () => {
    const host = createHost({
      boundKeys: ['bilibili-card'],
      finalUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
    });
    const app = new BilibiliCardApplication(host, createManifest(), () => 1000);

    await expect(
      app.handleMessage(createMessage({ messageText: 'https://b23.tv/abc123' })),
    ).resolves.toBe(true);
    expect(host.resolveRedirect).toHaveBeenCalledWith({
      maxRedirects: 5,
      timeoutMs: 6000,
      url: 'https://b23.tv/abc123',
    });
  });

  it('deduplicates the same video in the same conversation during the TTL window', async () => {
    const host = createHost({ boundKeys: ['bilibili-card'] });
    const app = new BilibiliCardApplication(host, createManifest(), () => 1000);

    await app.handleMessage(createMessage());
    await expect(app.handleMessage(createMessage())).resolves.toBe(false);

    expect(host.sendText).toHaveBeenCalledTimes(1);
  });

  it('routes generic worker message events to the package handler', async () => {
    const host = createHost({ boundKeys: ['bilibili-card'] });
    const plugin = createPlugin({
      host,
      manifest: createManifest(),
      normalizeError: (error) => (error instanceof Error ? error.message : `${error}`),
      now: () => new Date(1000),
      runtime: { configSnapshot: {}, installationId: 'install-1' },
    });

    await expect(plugin.handleEvent('message', createMessage())).resolves.toBe(true);
  });
});

/**
 * Creates a normalized QQBot message fixture with one Bilibili URL.
 * @param overrides - Message fields overridden by a specific test.
 * @returns Normalized message fixture accepted by the Bilibili card application.
 */
function createMessage(overrides: Record<string, unknown> = {}) {
  return {
    channelId: undefined,
    messageId: 'msg-1',
    messageText: 'https://www.bilibili.com/video/BV1xx411c7mD',
    messageType: 'group',
    rawEvent: { group_id: '20001' },
    rawMessage: 'https://www.bilibili.com/video/BV1xx411c7mD',
    selfId: '10001',
    targetId: '20001',
    userId: '30001',
    ...overrides,
  };
}

/**
 * Creates a package manifest fixture for event matching.
 * @returns Minimal Bilibili card plugin manifest used by application tests.
 */
function createManifest() {
  return {
    description: '解析 QQ 中的 Bilibili 视频链接卡片并回复视频摘要。',
    events: [
      {
        eventName: 'message',
        handlerName: 'handleMessage',
        key: 'bilibili-card.message',
        name: 'Bilibili 卡片解析',
      },
    ],
    name: 'Bilibili Card',
    pluginKey: 'bilibili-card',
    version: '1.0.0',
  };
}

/**
 * Creates a package host fixture for application tests.
 * @param options - Bound plugin keys and optional short-link final URL.
 * @returns Host fixture with Jest mocks.
 */
function createHost(options: { boundKeys: string[]; finalUrl?: string }) {
  return {
    getBoundEventPluginKeys: jest.fn().mockResolvedValue(options.boundKeys),
    getConfig: jest.fn(),
    requestJson: jest.fn().mockResolvedValue({
      code: 0,
      data: {
        aid: 170001,
        bvid: 'BV1xx411c7mD',
        desc: '夏祭简介',
        duration: 125,
        owner: { name: 'UP主' },
        pic: '',
        stat: { danmaku: 456, like: 7890, view: 123456 },
        title: '夏祭',
      },
    }),
    resolveRedirect: jest.fn().mockResolvedValue({
      finalUrl:
        options.finalUrl || 'https://www.bilibili.com/video/BV1xx411c7mD',
      redirects: [
        options.finalUrl || 'https://www.bilibili.com/video/BV1xx411c7mD',
      ],
    }),
    sendText: jest.fn().mockResolvedValue({ messageId: 'send-1' }),
    warn: jest.fn(),
  };
}
```

- [ ] **Step 2: Run application tests and verify RED**

Run:

```powershell
pnpm exec jest --runTestsByPath test/modules/qqbot/plugins/bilibili-card/bilibili-card-application.spec.ts --runInBand
```

Expected: FAIL because application, event handler, entry and manifest do not exist.

- [ ] **Step 3: Implement application and event entry**

Extend `bilibili-card.types.ts` with:

```ts
export type BilibiliCardManifest = {
  description?: string;
  events: Array<{
    eventName: string;
    handlerName: string;
    key: string;
    name: string;
  }>;
  name: string;
  pluginKey: string;
  version: string;
};

export type BilibiliCardMessage = {
  channelId?: string;
  messageId?: string;
  messageText: string;
  messageType: string;
  rawEvent: Record<string, any>;
  rawMessage?: string;
  selfId: string;
  targetId: string;
  userId: string;
};
```

Create `application/bilibili-card-application.ts`:

```ts
import { readBilibiliCardRuntimeConfig } from '../config/bilibili-card-config';
import { extractBilibiliUrls } from '../domain/bilibili-url-extractor';
import { parseBilibiliVideoReference } from '../domain/bilibili-url-parser';
import { formatBilibiliVideoReply } from '../domain/bilibili-reply-formatter';
import type {
  BilibiliCardManifest,
  BilibiliCardMessage,
  BilibiliCardPluginHost,
  BilibiliVideoReference,
} from '../domain/bilibili-card.types';
import { BilibiliVideoClient } from '../infrastructure/integration/bilibili-video-client';

type DedupeState = { expiresAt: number };

export class BilibiliCardApplication {
  private readonly boundCache = new Map<string, { expiresAt: number; value: boolean }>();
  private readonly dedupe = new Map<string, DedupeState>();
  private readonly videoClient: BilibiliVideoClient;

  /**
   * Initializes the Bilibili card event application.
   * @param host - Package host used for binding reads, HTTP calls, sending messages and warnings.
   * @param manifest - Plugin manifest fields used for plugin key matching and metadata.
   * @param now - Millisecond clock used by cache and dedupe TTL calculations.
   */
  constructor(
    private readonly host: BilibiliCardPluginHost,
    private readonly manifest: BilibiliCardManifest,
    private readonly now: () => number = Date.now,
  ) {
    this.videoClient = new BilibiliVideoClient(host);
  }

  /**
   * Handles one normalized QQBot message event and sends a Bilibili video summary when applicable.
   * @param message - Normalized QQBot message plus raw OneBot event payload.
   * @returns `true` when a summary was sent; otherwise `false`.
   */
  async handleMessage(message: BilibiliCardMessage) {
    if (message.selfId === message.userId) return false;
    if (!(await this.isBound(message.selfId))) return false;

    const config = readBilibiliCardRuntimeConfig(this.host);
    const urls = extractBilibiliUrls({
      messageText: message.messageText,
      rawEvent: message.rawEvent,
      rawMessage: message.rawMessage,
    });

    for (const url of urls) {
      const reference = await this.resolveReference(url, config);
      if (!reference) continue;
      const dedupeKey = buildBilibiliCardDedupeKey(message, reference);
      this.pruneDedupe(config.dedupeTtlMs);
      if (this.dedupe.has(dedupeKey)) return false;

      try {
        const video = await this.videoClient.fetchVideo(reference, config);
        await this.host.sendText({
          channelId: message.channelId,
          guildId: message.rawEvent.guild_id ? `${message.rawEvent.guild_id}` : undefined,
          message: formatBilibiliVideoReply(video, config),
          selfId: message.selfId,
          targetId: message.targetId,
          targetType: message.messageType,
        });
        this.dedupe.set(dedupeKey, { expiresAt: this.now() + config.dedupeTtlMs });
        return true;
      } catch (error) {
        this.warn(`Bilibili 卡片解析失败: ${normalizeError(error)}`);
        return false;
      }
    }

    return false;
  }

  /**
   * Resolves a direct or short Bilibili URL into a video reference.
   * @param url - Candidate URL extracted from text or card payload.
   * @param config - Runtime config containing redirect budget and timeout.
   * @returns Video reference, or `null` when the URL does not point at a supported video.
   */
  private async resolveReference(
    url: string,
    config: { httpTimeoutMs: number; maxRedirects: number },
  ): Promise<BilibiliVideoReference | null> {
    const direct = parseBilibiliVideoReference(url);
    if (direct) return direct;
    if (!new URL(url).hostname.toLowerCase().endsWith('b23.tv')) return null;

    try {
      const resolved = await this.host.resolveRedirect({
        maxRedirects: config.maxRedirects,
        timeoutMs: config.httpTimeoutMs,
        url,
      });
      return parseBilibiliVideoReference(resolved.finalUrl);
    } catch (error) {
      this.warn(`Bilibili 短链解析失败: ${normalizeError(error)}`);
      return null;
    }
  }

  /**
   * Checks whether this plugin is bound to the current QQBot account.
   * @param selfId - QQBot self account id from the normalized message.
   * @returns `true` when the account has this event plugin bound.
   */
  private async isBound(selfId: string) {
    const current = this.now();
    const cached = this.boundCache.get(selfId);
    if (cached && cached.expiresAt > current) return cached.value;

    const config = readBilibiliCardRuntimeConfig(this.host);
    const value = (await this.host.getBoundEventPluginKeys(selfId)).includes(
      this.manifest.pluginKey,
    );
    this.boundCache.set(selfId, {
      expiresAt: current + Math.min(config.dedupeTtlMs, 60000),
      value,
    });
    return value;
  }

  /**
   * Removes expired dedupe entries during message handling.
   * @param fallbackTtlMs - TTL used when an old entry has no explicit expiry.
   */
  private pruneDedupe(fallbackTtlMs: number) {
    const current = this.now();
    for (const [key, state] of this.dedupe.entries()) {
      if ((state.expiresAt || current - fallbackTtlMs) <= current) {
        this.dedupe.delete(key);
      }
    }
  }

  /**
   * Emits a warning through the host without failing event dispatch.
   * @param message - Warning message safe for platform logs.
   */
  private warn(message: string) {
    this.host.warn?.(message);
  }
}

/**
 * Builds a dedupe key scoped to bot account, conversation and normalized video id.
 * @param message - Normalized QQBot message being handled.
 * @param reference - Parsed Bilibili video reference.
 * @returns Stable dedupe key for this conversation and video.
 */
function buildBilibiliCardDedupeKey(
  message: BilibiliCardMessage,
  reference: BilibiliVideoReference,
) {
  return [
    message.selfId,
    message.messageType,
    message.targetId,
    reference.canonicalVideoId,
  ].join(':');
}

/**
 * Converts thrown values to stable warning text.
 * @param error - Error or arbitrary thrown value from host or domain code.
 * @returns Human-readable message.
 */
function normalizeError(error: unknown) {
  return error instanceof Error && error.message ? error.message : `${error}`;
}
```

Create `events/message/bilibili-card-message.handler.ts`:

```ts
import type { BilibiliCardApplication } from '../../application/bilibili-card-application';
import type { BilibiliCardMessage } from '../../domain/bilibili-card.types';

/**
 * Creates the message event handler for the Bilibili card plugin.
 * @param application - Application service that owns parsing and reply orchestration.
 * @returns Handler accepted by the plugin package entry.
 */
export function createBilibiliCardMessageHandler(
  application: BilibiliCardApplication,
) {
  /**
   * Handles one normalized QQBot message event.
   * @param message - Normalized QQBot message forwarded by the plugin platform.
   * @returns Whether the plugin sent a reply.
   */
  return async function handleMessage(message: BilibiliCardMessage) {
    return application.handleMessage(message);
  };
}
```

Create `src/index.ts`:

```ts
import { BilibiliCardApplication } from './application/bilibili-card-application';
import type {
  BilibiliCardManifest,
  BilibiliCardPluginHost,
} from './domain/bilibili-card.types';
import { createBilibiliCardMessageHandler } from './events/message/bilibili-card-message.handler';
import { createBilibiliCardGenericHostAdapter } from './infrastructure/integration/bilibili-card-host';

type BilibiliCardPluginOptions = {
  host: BilibiliCardPluginHost;
  manifest: BilibiliCardManifest;
  now?: () => number;
};

type QqbotGenericPluginCreateOptions = {
  host: Record<string, unknown>;
  manifest: BilibiliCardManifest & { key?: string };
  normalizeError: (error: unknown, fallback?: string) => string | Error;
  now: () => Date;
  runtime: {
    configSnapshot: Record<string, string | undefined>;
    installationId: string;
  };
};

type BilibiliCardPluginCreateOptions =
  | BilibiliCardPluginOptions
  | QqbotGenericPluginCreateOptions;

/**
 * Creates the Bilibili card plugin entry for package-local tests or the generic worker runtime.
 * @param options - Package-local options or generic worker options containing host facade and config snapshot.
 * @returns Bilibili card event plugin instance.
 */
export function createPlugin(options: BilibiliCardPluginCreateOptions) {
  if (isGenericPluginOptions(options)) {
    return buildBilibiliCardPlugin({
      host: createBilibiliCardGenericHostAdapter(
        options.host,
        options.runtime.configSnapshot,
      ),
      manifest: normalizeManifest(options.manifest),
      now: () => options.now().getTime(),
    });
  }
  return buildBilibiliCardPlugin(options);
}

/**
 * Builds the package-local plugin instance.
 * @param options - Package host, manifest and millisecond clock.
 * @returns Runtime plugin object consumed by tests and worker event dispatch.
 */
function buildBilibiliCardPlugin(options: BilibiliCardPluginOptions) {
  const application = new BilibiliCardApplication(
    options.host,
    options.manifest,
    options.now,
  );
  const handleMessage = createBilibiliCardMessageHandler(application);

  return {
    /**
     * Returns a simple event capability summary for local callers.
     * @returns Plugin event definition based on the package manifest.
     */
    getDefinition: () => ({
      description: options.manifest.description,
      key: options.manifest.pluginKey,
      name: options.manifest.name,
      remark: '解析 QQ 中的 Bilibili 视频链接卡片并回复视频摘要。',
      triggerType: 'message' as const,
      version: options.manifest.version,
    }),
    /**
     * Routes generic worker event calls to the package-owned message handler.
     * @param eventKey - Manifest event key, event name or handler name supplied by the worker.
     * @param event - Normalized QQBot message payload.
     * @returns Whether the event was handled.
     */
    handleEvent: (eventKey: string, event: unknown) =>
      handleGenericEvent(eventKey, event, options.manifest, handleMessage),
    handleMessage,
  };
}

/**
 * Checks whether create options came from the generic worker runtime.
 * @param options - Candidate options supplied to `createPlugin`.
 * @returns `true` when the runtime config snapshot exists.
 */
function isGenericPluginOptions(
  options: BilibiliCardPluginCreateOptions,
): options is QqbotGenericPluginCreateOptions {
  return (
    !!(options as QqbotGenericPluginCreateOptions).runtime?.configSnapshot &&
    !!(options as QqbotGenericPluginCreateOptions).manifest
  );
}

/**
 * Fills the manifest plugin key from the parser's legacy `key` field when needed.
 * @param manifest - Manifest supplied by the generic plugin descriptor.
 * @returns Manifest with `pluginKey` and `events` normalized.
 */
function normalizeManifest(
  manifest: QqbotGenericPluginCreateOptions['manifest'],
): BilibiliCardManifest {
  return {
    ...manifest,
    events: manifest.events || [],
    pluginKey: manifest.pluginKey || manifest.key || 'bilibili-card',
  };
}

/**
 * Dispatches one generic event to the message handler when it matches the manifest event.
 * @param eventKey - Event key, event name or handler name from platform dispatch.
 * @param event - Normalized QQBot event payload.
 * @param manifest - Package manifest containing event metadata.
 * @param handleMessage - Message handler produced by the package application.
 * @returns Handler result, or `false` for unrelated events.
 */
async function handleGenericEvent(
  eventKey: string,
  event: unknown,
  manifest: BilibiliCardManifest,
  handleMessage: (message: any) => Promise<boolean>,
) {
  const matched = (manifest.events || []).some((item) =>
    [item.key, item.eventName, item.handlerName].includes(eventKey),
  );
  if (!matched && eventKey !== 'message') return false;
  return handleMessage(event as any);
}
```

Create `plugin.json`:

```json
{
  "key": "bilibili-card",
  "name": "Bilibili Card",
  "version": "1.0.0",
  "description": "解析 QQ 中的 Bilibili 视频链接卡片并回复视频摘要。",
  "author": "KT",
  "license": "UNLICENSED",
  "minApiSdkVersion": "1.0.0",
  "entry": "src/index.ts",
  "permissions": [
    "qqbot.event.receive",
    "qqbot.send",
    "runtime.http",
    "plugin.config.read"
  ],
  "runtime": {
    "workerType": "thread",
    "timeoutMs": 10000,
    "memoryMb": 128,
    "maxConcurrency": 1,
    "configKeys": [
      "QQBOT_BILIBILI_CARD_HTTP_TIMEOUT_MS",
      "QQBOT_BILIBILI_CARD_MAX_REDIRECTS",
      "QQBOT_BILIBILI_CARD_DEDUPE_TTL_MS",
      "QQBOT_BILIBILI_CARD_DESC_MAX_LENGTH"
    ]
  },
  "operations": [],
  "events": [
    {
      "key": "bilibili-card.message",
      "name": "Bilibili 卡片解析",
      "eventName": "message",
      "handlerName": "handleMessage",
      "description": "解析 QQ 中的 Bilibili 视频链接卡片并回复视频摘要。"
    }
  ],
  "tasks": [],
  "assets": [],
  "migrations": [],
  "legacyAliases": [],
  "configSchema": {
    "QQBOT_BILIBILI_CARD_HTTP_TIMEOUT_MS": {
      "type": "number",
      "title": "HTTP 超时毫秒",
      "default": 6000
    },
    "QQBOT_BILIBILI_CARD_MAX_REDIRECTS": {
      "type": "number",
      "title": "短链最大跳转次数",
      "default": 5
    },
    "QQBOT_BILIBILI_CARD_DEDUPE_TTL_MS": {
      "type": "number",
      "title": "同视频去重毫秒",
      "default": 600000
    },
    "QQBOT_BILIBILI_CARD_DESC_MAX_LENGTH": {
      "type": "number",
      "title": "简介最大长度",
      "default": 80
    }
  }
}
```

- [ ] **Step 4: Run all plugin tests and verify GREEN**

Run:

```powershell
pnpm exec jest --runTestsByPath test/modules/qqbot/plugins/bilibili-card/bilibili-url-parser.spec.ts test/modules/qqbot/plugins/bilibili-card/bilibili-url-extractor.spec.ts test/modules/qqbot/plugins/bilibili-card/bilibili-video-client.spec.ts test/modules/qqbot/plugins/bilibili-card/bilibili-card-application.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit application slice**

```powershell
git add src/modules/qqbot/plugins/bilibili-card test/modules/qqbot/plugins/bilibili-card
git commit -m "feat: 添加QQBot Bilibili卡片事件插件"
```

---

### Task 6: SQL Seed and Architecture Gates

**Files:**
- Modify: `sql/refactor-v3/01-seed-core.sql`
- Modify: `sql/refactor-v3/99-verify.sql`
- Modify: `test/modules/qqbot/plugins/plugin-platform-migration.spec.ts`
- Modify: `test/modules/qqbot/architecture/qqbot-plugin-package-boundary.spec.ts`
- Modify: `test/modules/qqbot/architecture/qqbot-current-operation-matrix.spec.ts`

- [ ] **Step 1: Write failing gate expectations**

Update built-in plugin arrays in the three architecture tests to include `bilibili-card`.

In `qqbot-current-operation-matrix.spec.ts`, extend manifest map:

```ts
const manifests = {
  bangdream: readManifest('bangdream'),
  bilibiliCard: readManifest('bilibili-card'),
  ff14: readManifest('ff14-market'),
  fflogs: readManifest('fflogs'),
  repeater: readManifest('repeater'),
};
```

Add expectation:

```ts
expect(manifests.bilibiliCard.operations).toEqual([]);
expect(
  manifests.bilibiliCard.events.map((event) => ({
    eventName: event.eventName,
    handlerName: event.handlerName,
    key: event.key,
    name: event.name,
  })),
).toEqual([
  {
    eventName: 'message',
    handlerName: 'handleMessage',
    key: 'bilibili-card.message',
    name: 'Bilibili 卡片解析',
  },
]);
```

Add SQL text checks for `bilibili-card` in `plugin-platform-migration.spec.ts` or `qqbot-current-operation-matrix.spec.ts`:

```ts
const refactorSeedSql = readFileSync(
  join(repoRoot, 'sql/refactor-v3/01-seed-core.sql'),
  'utf8',
);
expect(refactorSeedSql).toContain(`'bilibili-card'`);
expect(refactorSeedSql).toContain(`'bilibili-card.message'`);
```

- [ ] **Step 2: Run architecture tests and verify RED**

Run:

```powershell
pnpm exec jest --runTestsByPath test/modules/qqbot/plugins/plugin-platform-migration.spec.ts test/modules/qqbot/architecture/qqbot-plugin-package-boundary.spec.ts test/modules/qqbot/architecture/qqbot-current-operation-matrix.spec.ts --runInBand
```

Expected: FAIL until SQL and expected plugin directories are aligned.

- [ ] **Step 3: Seed plugin metadata**

Modify `sql/refactor-v3/01-seed-core.sql`:

- Add `qqbot_plugin` row:

```sql
  (
    1000000000000000105,
    'bilibili-card',
    'Bilibili Card',
    'Built-in Bilibili card event plugin metadata.',
    'installed'
  )
```

- Add idempotent rows after the plugin insert:

```sql
INSERT INTO qqbot_plugin_version (
  id,
  plugin_id,
  version,
  package_hash,
  manifest_json
) VALUES (
  1000000000000001105,
  1000000000000000105,
  '1.0.0',
  'builtin-bilibili-card-1.0.0',
  JSON_OBJECT(
    'key', 'bilibili-card',
    'name', 'Bilibili Card',
    'version', '1.0.0',
    'entry', 'src/index.ts',
    'events', JSON_ARRAY(JSON_OBJECT(
      'key', 'bilibili-card.message',
      'eventName', 'message',
      'handlerName', 'handleMessage',
      'name', 'Bilibili 卡片解析'
    ))
  )
) ON DUPLICATE KEY UPDATE
  package_hash = VALUES(package_hash),
  manifest_json = VALUES(manifest_json);

INSERT INTO qqbot_plugin_installation (
  id,
  plugin_id,
  version_id,
  status,
  runtime_status,
  installed_path
) VALUES (
  1000000000000001205,
  1000000000000000105,
  1000000000000001105,
  'installed',
  'idle',
  'src/modules/qqbot/plugins/bilibili-card'
) ON DUPLICATE KEY UPDATE
  status = VALUES(status),
  runtime_status = VALUES(runtime_status),
  installed_path = VALUES(installed_path);

INSERT INTO qqbot_plugin_event_handler (
  id,
  plugin_id,
  event_key,
  handler_name,
  enabled
) VALUES (
  1000000000000001305,
  1000000000000000105,
  'bilibili-card.message',
  'handleMessage',
  1
) ON DUPLICATE KEY UPDATE
  handler_name = VALUES(handler_name),
  enabled = VALUES(enabled);
```

Modify `sql/refactor-v3/99-verify.sql`:

```sql
SELECT 'seed_qqbot_plugin_bilibili_card' AS check_name, COUNT(*) AS matched_rows
FROM qqbot_plugin
WHERE plugin_key = 'bilibili-card'
  AND status = 'installed';

SELECT 'seed_qqbot_plugin_event_bilibili_card' AS check_name, COUNT(*) AS matched_rows
FROM qqbot_plugin_event_handler
WHERE event_key = 'bilibili-card.message'
  AND handler_name = 'handleMessage'
  AND enabled = 1;
```

- [ ] **Step 4: Run architecture and SQL text tests**

Run:

```powershell
pnpm exec jest --runTestsByPath test/modules/qqbot/plugins/plugin-platform-migration.spec.ts test/modules/qqbot/architecture/qqbot-plugin-package-boundary.spec.ts test/modules/qqbot/architecture/qqbot-current-operation-matrix.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit seed and gate slice**

```powershell
git add sql/refactor-v3/01-seed-core.sql sql/refactor-v3/99-verify.sql test/modules/qqbot/plugins/plugin-platform-migration.spec.ts test/modules/qqbot/architecture/qqbot-plugin-package-boundary.spec.ts test/modules/qqbot/architecture/qqbot-current-operation-matrix.spec.ts
git commit -m "test: 固化Bilibili卡片插件架构门禁"
```

---

### Task 7: Full Focused Verification and Documentation

**Files:**
- Modify: `TASKS.md`

- [ ] **Step 1: Run focused Bilibili plugin tests**

Run:

```powershell
pnpm exec jest --runTestsByPath test/modules/qqbot/plugins/bilibili-card/bilibili-url-parser.spec.ts test/modules/qqbot/plugins/bilibili-card/bilibili-url-extractor.spec.ts test/modules/qqbot/plugins/bilibili-card/bilibili-video-client.spec.ts test/modules/qqbot/plugins/bilibili-card/bilibili-card-application.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run platform and architecture tests**

Run:

```powershell
pnpm exec jest --runTestsByPath test/modules/qqbot/plugin-platform/plugin-http-client.spec.ts test/modules/qqbot/plugin-platform/plugin-host-bridge.spec.ts test/modules/qqbot/plugins/plugin-platform-migration.spec.ts test/modules/qqbot/architecture/qqbot-plugin-package-boundary.spec.ts test/modules/qqbot/architecture/qqbot-current-operation-matrix.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```powershell
pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run diff check**

Run:

```powershell
git diff --check
```

Expected: PASS.

- [ ] **Step 5: Update TASKS**

Update `D:\MyFiles\KT\TASKS.md` latest record for this workstream with:

- Scope: plugin files, host bridge files, tests, SQL seed and plan.
- Keywords: `bilibili-card`, `share/json/xml/lightapp`, `resolveRedirect`, `b23.tv`, `x/web-interface/view`, event plugin binding.
- Verification: exact commands and pass/fail counts from Steps 1 to 4.

- [ ] **Step 6: Run root diff check**

Run:

```powershell
git -C D:\MyFiles\KT diff --check
```

Expected: PASS.

- [ ] **Step 7: Commit final documentation record**

Commit API repo if there are remaining API files:

```powershell
git add .
git commit -m "feat: 完成QQBot Bilibili卡片插件"
```

Commit root TASKS:

```powershell
git -C D:\MyFiles\KT add TASKS.md
git -C D:\MyFiles\KT commit -m "docs: 记录QQBot Bilibili卡片插件实现"
```

---

## Self-Review

- Spec coverage: The plan implements the event plugin, raw card parsing, `b23.tv` redirect support, Bilibili video API fetch, pure text reply, binding control, dedupe, SQL seed, architecture gates and focused verification from the approved spec.
- Scope check: The plan is one cohesive subsystem. It does not add image rendering, commands, Admin pages, or non-video Bilibili object parsing.
- Type consistency: The plan uses `BilibiliVideoReference`, `BilibiliCardRuntimeConfig`, `BilibiliCardPluginHost`, `BilibiliCardMessage`, `BilibiliCardManifest` consistently across domain, integration and application slices.
- Dependency boundary: Plugin code uses only package-local files and generic host calls. Platform HTTP code remains generic and contains no Bilibili business rules.
