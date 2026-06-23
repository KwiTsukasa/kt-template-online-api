# QQBot NapCat Source Fork QR Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and ship a source-level NapCatQQ fork fix so stale WebUI login state no longer blocks fresh QR generation, then consume that fork through the KT `desktop-cn-v3` NapCat image.

**Architecture:** Fix the root state model in NapCatQQ first, then replace the KT image's bundled-JS patch with a staged source-built Shell artifact. Keep API stale-QR guards in place as defense-in-depth, and prove the result with fork tests, image static tests, image verify, and one production canary account.

**Tech Stack:** NapCatQQ monorepo, TypeScript, Vitest, Vite shell build, NestJS API repo, Jest, Docker, NAS SSH, Jenkins/K8s.

---

## File Structure

### NapCatQQ Fork

Target repo: `D:\MyFiles\KT\GitHub\NapCatQQ`

- Modify: `packages/napcat-webui-backend/src/types/index.ts`
  - Owns the runtime state and QR refresh result types.
- Modify: `packages/napcat-webui-backend/src/helper/Data.ts`
  - Owns WebUI login runtime state, QR revision, stale login-state reconciliation, and refresh result semantics.
- Modify: `packages/napcat-webui-backend/src/api/QQLogin.ts`
  - Owns WebUI login HTTP handler behavior.
- Modify: `packages/napcat-shell/base.ts`
  - Wires Shell-mode QR refresh callback to return `loginService.getQRCodePicture()`.
- Modify: `packages/napcat-framework/napcat.ts`
  - Wires Framework-mode QR refresh callback to return `loginService.getQRCodePicture()`.
- Modify: `packages/napcat-test/vitest.config.ts`
  - Adds aliases needed by the new tests.
- Create: `packages/napcat-test/webuiLoginRuntime.test.ts`
  - Tests stale login reconciliation, QR revision, and refresh observability.
- Create: `packages/napcat-test/webuiQQLoginHandlers.test.ts`
  - Tests handlers do not return `QQ Is Logined` for stale WebUI login state.
- Create: `packages/napcat-test/webuiLoginSourceWiring.test.ts`
  - Static safety test for Shell/Framework callback wiring.

### KT API Repo

Target repo: `D:\MyFiles\KT\Node\kt-template-online-api`

- Create: `scripts/napcat-desktop-cn-stage-build.mjs`
  - Stages Docker build context from a source-built NapCatQQ Shell dist.
- Modify: `ci/napcat-desktop-cn/Dockerfile`
  - Copies staged source-built `NapCat.Shell` into the image and creates `/app/NapCat.Shell.zip`.
- Modify: `ci/napcat-desktop-cn/verify.sh`
  - Verifies fork marker, artifact hash, locale, timezone, XDG, fontconfig, and source-fix markers.
- Delete: `ci/napcat-desktop-cn/patches/qq-login-real-online-guard.sh`
  - Removes bundled-JS patching.
- Modify: `ci/napcat-desktop-cn/README.md`
  - Documents v3 staging/build/verify commands.
- Modify: `src/modules/qqbot/napcat/application/runtime/napcat-runtime-profile.service.ts`
  - Changes default `desktopProfileVersion` to `desktop-cn-v3`.
- Modify: `test/modules/qqbot/napcat/napcat-desktop-cn-image.spec.ts`
  - Replaces patch assertions with source-built artifact assertions.
- Modify: `test/modules/qqbot/napcat/runtime-protocol-profile.spec.ts`
  - Updates expected default desktop profile version.
- Modify: `README.md`, `API.md`
  - Documents `QQBOT_NAPCAT_IMAGE` v3 expectations where existing NapCat runtime text exists.

### KT Root Docs

Target repo: `D:\MyFiles\KT`

- Modify: `docs/qqbot-nas-runtime.md`
  - Records the new v3 source-fork image path and canary evidence requirements.
- Modify: `TASKS.md`
  - Adds a short current-context record after implementation files change.

## Execution Rules

- Do not use `.worktree`; use normal dev branches.
- Do not mutate production containers until the canary task.
- Do not remove API stale-QR protections.
- Do not push until the user asks.
- Every new or touched function in KT-owned files must have JSDoc with parameter purpose and return semantics.
- Every task that edits code must run its targeted RED/GREEN check before commit.

## Task 1: Prepare NapCatQQ Fork Branch

**Files:**
- Create or update repo: `D:\MyFiles\KT\GitHub\NapCatQQ`

- [ ] **Step 1: Create or update the fork checkout**

Run:

```powershell
if (Test-Path -LiteralPath 'D:\MyFiles\KT\GitHub\NapCatQQ\.git') {
  git -C 'D:\MyFiles\KT\GitHub\NapCatQQ' fetch origin main --prune
} else {
  git clone https://github.com/NapNeko/NapCatQQ.git 'D:\MyFiles\KT\GitHub\NapCatQQ'
}
```

Expected: clone or fetch succeeds.

- [ ] **Step 2: Create the implementation branch**

Run:

```powershell
git -C 'D:\MyFiles\KT\GitHub\NapCatQQ' checkout main
git -C 'D:\MyFiles\KT\GitHub\NapCatQQ' pull --ff-only origin main
git -C 'D:\MyFiles\KT\GitHub\NapCatQQ' switch -c codex/qr-refresh-login-state
git -C 'D:\MyFiles\KT\GitHub\NapCatQQ' rev-parse HEAD
```

Expected: HEAD is `5c18a62530d87dbadf53d267002894faa6ca7e90`. If it differs, record the actual commit in the task summary and continue from that commit.

- [ ] **Step 3: Confirm package manager**

Run:

```powershell
corepack pnpm --version
Get-Content -Raw -LiteralPath 'D:\MyFiles\KT\GitHub\NapCatQQ\package.json' | Select-String -Pattern '"typecheck"|"test"|"build:shell"'
```

Expected: scripts include `typecheck`, `test`, and `build:shell`.

## Task 2: Add Failing NapCat Runtime Tests

**Files:**
- Modify: `D:\MyFiles\KT\GitHub\NapCatQQ\packages\napcat-test\vitest.config.ts`
- Create: `D:\MyFiles\KT\GitHub\NapCatQQ\packages\napcat-test\webuiLoginRuntime.test.ts`

- [ ] **Step 1: Add the WebUI backend alias**

In `packages/napcat-test/vitest.config.ts`, add this alias inside `resolve.alias`:

```ts
'napcat-webui-backend': resolve(__dirname, '../napcat-webui-backend'),
```

- [ ] **Step 2: Write failing runtime tests**

Create `packages/napcat-test/webuiLoginRuntime.test.ts` with:

```ts
import { beforeEach, describe, expect, test } from 'vitest';
import { WebUiDataRuntime } from 'napcat-webui-backend/src/helper/Data';

/**
 * Injects the minimal OneBot adapter shape used by WebUI login-state reconciliation.
 * @param online - Explicit QQ online state; `undefined` represents adapter/core not ready.
 */
function setCoreOnlineState (online: boolean | undefined): void {
  WebUiDataRuntime.setOneBotContext(
    online === undefined
      ? null
      : {
          core: {
            selfInfo: {
              online,
            },
          },
        }
  );
}

describe('WebUI login runtime state', () => {
  beforeEach(() => {
    WebUiDataRuntime.__resetForTest();
  });

  test('reconciles stale WebUI login status when core selfInfo is offline', () => {
    WebUiDataRuntime.setQQLoginStatus(true);
    WebUiDataRuntime.setQQLoginQrcodeURL('old-qrcode-url');
    setCoreOnlineState(false);

    const state = WebUiDataRuntime.getQQLoginRuntimeState({
      clearStaleQRCode: true,
      reconcile: true,
    });

    expect(state).toMatchObject({
      canStartLoginFlow: true,
      isActuallyLogin: false,
      isStaleLoginStatus: true,
      online: false,
      qrcodeurl: '',
      webuiLoginStatus: false,
    });
    expect(WebUiDataRuntime.getQQLoginStatus()).toBe(false);
    expect(WebUiDataRuntime.getQQLoginQrcodeURL()).toBe('');
  });

  test('keeps login status when core online state is still unknown', () => {
    WebUiDataRuntime.setQQLoginStatus(true);
    WebUiDataRuntime.setQQLoginQrcodeURL('existing-qrcode-url');
    setCoreOnlineState(undefined);

    const state = WebUiDataRuntime.getQQLoginRuntimeState({
      clearStaleQRCode: true,
      reconcile: true,
    });

    expect(state).toMatchObject({
      canStartLoginFlow: false,
      isActuallyLogin: true,
      isStaleLoginStatus: false,
      online: undefined,
      qrcodeurl: 'existing-qrcode-url',
      webuiLoginStatus: true,
    });
  });

  test('increments QR revision only when QR URL changes or clears', () => {
    expect(WebUiDataRuntime.getQQLoginRuntimeState().qrcodeRevision).toBe(0);

    WebUiDataRuntime.setQQLoginQrcodeURL('first-url');
    const firstState = WebUiDataRuntime.getQQLoginRuntimeState();

    WebUiDataRuntime.setQQLoginQrcodeURL('first-url');
    const repeatedState = WebUiDataRuntime.getQQLoginRuntimeState();

    WebUiDataRuntime.clearQQLoginQrcodeURL();
    const clearedState = WebUiDataRuntime.getQQLoginRuntimeState();

    expect(firstState.qrcodeRevision).toBe(1);
    expect(repeatedState.qrcodeRevision).toBe(1);
    expect(clearedState.qrcodeRevision).toBe(2);
    expect(clearedState.qrcodeurl).toBe('');
  });

  test('reports refresh as accepted and updated when QR callback changes revision', async () => {
    WebUiDataRuntime.setRefreshQRCodeCallback(async () => {
      setTimeout(() => {
        WebUiDataRuntime.setQQLoginQrcodeURL('fresh-qrcode-url');
      }, 10);
      return true;
    });

    const result = await WebUiDataRuntime.refreshQRCode({
      pollIntervalMs: 10,
      waitForUpdateMs: 300,
    });

    expect(result).toMatchObject({
      accepted: true,
      qrcodeurl: 'fresh-qrcode-url',
      updated: true,
    });
    expect(result.qrcodeRevision).toBe(1);
  });

  test('reports refresh as rejected when kernel callback returns false', async () => {
    WebUiDataRuntime.setRefreshQRCodeCallback(async () => false);

    const result = await WebUiDataRuntime.refreshQRCode({
      pollIntervalMs: 10,
      waitForUpdateMs: 50,
    });

    expect(result).toMatchObject({
      accepted: false,
      error: 'QR refresh request was rejected by login service',
      updated: false,
    });
  });
});
```

- [ ] **Step 3: Run the failing runtime tests**

Run:

```powershell
corepack pnpm --dir 'D:\MyFiles\KT\GitHub\NapCatQQ' --filter napcat-test exec vitest run webuiLoginRuntime.test.ts
```

Expected: FAIL because `__resetForTest`, `getQQLoginRuntimeState`, `clearQQLoginQrcodeURL`, and typed `refreshQRCode` options do not exist yet.

## Task 3: Implement NapCat Runtime State Model

**Files:**
- Modify: `D:\MyFiles\KT\GitHub\NapCatQQ\packages\napcat-webui-backend\src\types\index.ts`
- Modify: `D:\MyFiles\KT\GitHub\NapCatQQ\packages\napcat-webui-backend\src\helper\Data.ts`
- Test: `D:\MyFiles\KT\GitHub\NapCatQQ\packages\napcat-test\webuiLoginRuntime.test.ts`

- [ ] **Step 1: Extend runtime types**

In `packages/napcat-webui-backend/src/types/index.ts`, add:

```ts
export interface QQLoginRuntimeStateOptions {
  clearStaleQRCode?: boolean;
  reconcile?: boolean;
}

export interface QQLoginRuntimeState {
  canStartLoginFlow: boolean;
  isActuallyLogin: boolean;
  isStaleLoginStatus: boolean;
  online?: boolean;
  qrcodeRevision: number;
  qrcodeUpdatedAt: number;
  qrcodeurl: string;
  webuiLoginStatus: boolean;
}

export interface QQRefreshQRCodeOptions {
  pollIntervalMs?: number;
  waitForUpdateMs?: number;
}

export interface QQRefreshQRCodeResult {
  accepted: boolean;
  error?: string;
  qrcodeRevision: number;
  qrcodeUpdatedAt: number;
  qrcodeurl: string;
  updated: boolean;
}
```

Then update `LoginRuntimeType`:

```ts
  QQQRCodeRevision: number;
  QQQRCodeUpdatedAt: number;
  onRefreshQRCode: () => Promise<boolean>;
```

- [ ] **Step 2: Update Data.ts imports**

Change the import in `packages/napcat-webui-backend/src/helper/Data.ts`:

```ts
import {
  NapCatCoreWorkingEnv,
  type LoginRuntimeType,
  type QQLoginRuntimeState,
  type QQLoginRuntimeStateOptions,
  type QQRefreshQRCodeOptions,
  type QQRefreshQRCodeResult,
} from '../types';
```

- [ ] **Step 3: Add focused helper functions with JSDoc**

Add these helpers above `export const WebUiDataRuntime`:

```ts
const DEFAULT_QR_REFRESH_WAIT_MS = 1200;
const DEFAULT_QR_REFRESH_POLL_MS = 50;

/**
 * Sleeps between short QR revision checks without blocking the event loop.
 * @param ms - Milliseconds to wait before checking whether the QR listener updated runtime state.
 */
function delay (ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Reads the best available core-side QQ online state from the registered OneBot adapter.
 * @returns `true` or `false` when core has explicit selfInfo, otherwise `undefined` during early startup.
 */
function getCoreOnlineState (): boolean | undefined {
  return LoginRuntime.OneBotContext?.core?.selfInfo?.online;
}

/**
 * Builds a public login runtime snapshot and optionally reconciles stale WebUI state.
 * @param options - Controls whether stale login status mutates runtime state and whether old QR data is cleared.
 */
function buildQQLoginRuntimeState (
  options: QQLoginRuntimeStateOptions = {}
): QQLoginRuntimeState {
  const reconcile = options.reconcile ?? false;
  const online = getCoreOnlineState();
  const staleBeforeReconcile = LoginRuntime.QQLoginStatus && online === false;

  if (staleBeforeReconcile && reconcile) {
    LoginRuntime.QQLoginStatus = false;
    if (!LoginRuntime.QQLoginError) {
      LoginRuntime.QQLoginError = 'QQ 登录态已失效，请重新登录';
    }
    if (options.clearStaleQRCode) {
      clearQQLoginQrcodeURL();
    }
  }

  const isUnknownOnline = online === undefined;
  const isActuallyLogin = LoginRuntime.QQLoginStatus && (isUnknownOnline || online === true);

  return {
    canStartLoginFlow: !isActuallyLogin,
    isActuallyLogin,
    isStaleLoginStatus: staleBeforeReconcile,
    online,
    qrcodeRevision: LoginRuntime.QQQRCodeRevision,
    qrcodeUpdatedAt: LoginRuntime.QQQRCodeUpdatedAt,
    qrcodeurl: LoginRuntime.QQQRCodeURL,
    webuiLoginStatus: LoginRuntime.QQLoginStatus,
  };
}

/**
 * Clears the cached QR URL and increments revision when the value actually changes.
 */
function clearQQLoginQrcodeURL (): void {
  if (!LoginRuntime.QQQRCodeURL) return;
  LoginRuntime.QQQRCodeURL = '';
  LoginRuntime.QQQRCodeRevision += 1;
  LoginRuntime.QQQRCodeUpdatedAt = Date.now();
}
```

- [ ] **Step 4: Update the initial runtime object**

In `LoginRuntime`, add the QR fields and boolean refresh callback:

```ts
  QQQRCodeRevision: 0,
  QQQRCodeUpdatedAt: 0,
```

Change the default callback:

```ts
  onRefreshQRCode: async () => {
    return false;
  },
```

- [ ] **Step 5: Replace QR methods and refresh method**

In `WebUiDataRuntime`, replace the QR methods and callback signatures with:

```ts
  setQQLoginQrcodeURL (url: LoginRuntimeType['QQQRCodeURL']): void {
    if (LoginRuntime.QQQRCodeURL === url) return;
    LoginRuntime.QQQRCodeURL = url;
    LoginRuntime.QQQRCodeRevision += 1;
    LoginRuntime.QQQRCodeUpdatedAt = Date.now();
  },

  clearQQLoginQrcodeURL (): void {
    clearQQLoginQrcodeURL();
  },

  getQQLoginQrcodeURL (): LoginRuntimeType['QQQRCodeURL'] {
    return LoginRuntime.QQQRCodeURL;
  },

  getQQLoginRuntimeState (options?: QQLoginRuntimeStateOptions): QQLoginRuntimeState {
    return buildQQLoginRuntimeState(options);
  },
```

Replace refresh callback methods with:

```ts
  setRefreshQRCodeCallback (func: () => Promise<boolean>): void {
    LoginRuntime.onRefreshQRCode = func;
  },

  getRefreshQRCodeCallback (): () => Promise<boolean> {
    return LoginRuntime.onRefreshQRCode;
  },

  refreshQRCode: async function (
    options: QQRefreshQRCodeOptions = {}
  ): Promise<QQRefreshQRCodeResult> {
    LoginRuntime.QQLoginError = '';
    const beforeRevision = LoginRuntime.QQQRCodeRevision;
    const accepted = await LoginRuntime.onRefreshQRCode();
    const waitForUpdateMs = options.waitForUpdateMs ?? DEFAULT_QR_REFRESH_WAIT_MS;
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_QR_REFRESH_POLL_MS;

    if (!accepted) {
      return {
        accepted: false,
        error: 'QR refresh request was rejected by login service',
        qrcodeRevision: LoginRuntime.QQQRCodeRevision,
        qrcodeUpdatedAt: LoginRuntime.QQQRCodeUpdatedAt,
        qrcodeurl: LoginRuntime.QQQRCodeURL,
        updated: false,
      };
    }

    const deadline = Date.now() + waitForUpdateMs;
    while (Date.now() < deadline && LoginRuntime.QQQRCodeRevision === beforeRevision) {
      await delay(pollIntervalMs);
    }

    return {
      accepted: true,
      qrcodeRevision: LoginRuntime.QQQRCodeRevision,
      qrcodeUpdatedAt: LoginRuntime.QQQRCodeUpdatedAt,
      qrcodeurl: LoginRuntime.QQQRCodeURL,
      updated: LoginRuntime.QQQRCodeRevision !== beforeRevision,
    };
  },
```

- [ ] **Step 6: Add the test reset helper**

Add this method at the end of `WebUiDataRuntime` before the closing brace:

```ts
  __resetForTest (): void {
    LoginRuntime.LoginCurrentTime = Date.now();
    LoginRuntime.LoginCurrentRate = 0;
    LoginRuntime.QQLoginStatus = false;
    LoginRuntime.QQQRCodeURL = '';
    LoginRuntime.QQQRCodeRevision = 0;
    LoginRuntime.QQQRCodeUpdatedAt = 0;
    LoginRuntime.QQLoginUin = '';
    LoginRuntime.QQLoginInfo = {
      nick: '',
      uid: '',
      uin: '',
    };
    LoginRuntime.QQLoginError = '';
    LoginRuntime.OneBotContext = null;
    LoginRuntime.onRefreshQRCode = async () => false;
  },
```

- [ ] **Step 7: Run runtime tests**

Run:

```powershell
corepack pnpm --dir 'D:\MyFiles\KT\GitHub\NapCatQQ' --filter napcat-test exec vitest run webuiLoginRuntime.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run focused typecheck**

Run:

```powershell
corepack pnpm --dir 'D:\MyFiles\KT\GitHub\NapCatQQ' --filter napcat-webui-backend run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

Run:

```powershell
git -C 'D:\MyFiles\KT\GitHub\NapCatQQ' add packages/napcat-webui-backend/src/types/index.ts packages/napcat-webui-backend/src/helper/Data.ts packages/napcat-test/vitest.config.ts packages/napcat-test/webuiLoginRuntime.test.ts
git -C 'D:\MyFiles\KT\GitHub\NapCatQQ' commit -m "fix: 修复WebUI登录态与二维码刷新状态"
```

## Task 4: Fix QQLogin Handler Guards

**Files:**
- Create: `D:\MyFiles\KT\GitHub\NapCatQQ\packages\napcat-test\webuiQQLoginHandlers.test.ts`
- Modify: `D:\MyFiles\KT\GitHub\NapCatQQ\packages\napcat-webui-backend\src\api\QQLogin.ts`

- [ ] **Step 1: Write failing handler tests**

Create `packages/napcat-test/webuiQQLoginHandlers.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  QQCheckLoginStatusHandler,
  QQGetQRcodeHandler,
  QQRefreshQRcodeHandler,
  QQSetQuickLoginHandler,
} from 'napcat-webui-backend/src/api/QQLogin';
import { WebUiDataRuntime } from 'napcat-webui-backend/src/helper/Data';

type MockResponseState = {
  body?: unknown;
  statusCode?: number;
};

/**
 * Builds the minimal Express response shape used by NapCat WebUI response helpers.
 * @returns The mock response object plus mutable state for assertions.
 */
function createMockResponse (): { res: any; state: MockResponseState } {
  const state: MockResponseState = {};
  const res = {
    json: vi.fn((body: unknown) => {
      state.body = body;
      return res;
    }),
    send: vi.fn((body: unknown) => {
      state.body = body;
      return res;
    }),
    status: vi.fn((statusCode: number) => {
      state.statusCode = statusCode;
      return res;
    }),
  };
  return { res, state };
}

/**
 * Injects a stale or healthy OneBot core state for handler tests.
 * @param online - Core selfInfo online value exposed through the registered adapter.
 */
function setCoreOnlineState (online: boolean): void {
  WebUiDataRuntime.setOneBotContext({
    core: {
      selfInfo: {
        online,
      },
    },
  });
}

describe('QQLogin WebUI handlers', () => {
  beforeEach(() => {
    WebUiDataRuntime.__resetForTest();
  });

  test('CheckLoginStatus clears stale login state and does not return stale QR', async () => {
    WebUiDataRuntime.setQQLoginStatus(true);
    WebUiDataRuntime.setQQLoginQrcodeURL('old-qrcode-url');
    setCoreOnlineState(false);
    const { res, state } = createMockResponse();

    await QQCheckLoginStatusHandler({} as any, res, vi.fn());

    expect(state.body).toMatchObject({
      code: 0,
      data: {
        isLogin: false,
        isOffline: true,
        qrcodeRevision: 2,
        qrcodeurl: '',
      },
    });
  });

  test('RefreshQRcode is allowed for stale WebUI login state', async () => {
    WebUiDataRuntime.setQQLoginStatus(true);
    setCoreOnlineState(false);
    WebUiDataRuntime.setRefreshQRCodeCallback(async () => {
      WebUiDataRuntime.setQQLoginQrcodeURL('fresh-qrcode-url');
      return true;
    });
    const { res, state } = createMockResponse();

    await QQRefreshQRcodeHandler({} as any, res, vi.fn());

    expect(state.body).toMatchObject({
      code: 0,
      data: {
        accepted: true,
        qrcodeurl: 'fresh-qrcode-url',
        updated: true,
      },
    });
  });

  test('Quick login remains blocked when core confirms actual online state', async () => {
    WebUiDataRuntime.setQQLoginStatus(true);
    setCoreOnlineState(true);
    const { res, state } = createMockResponse();

    await QQSetQuickLoginHandler({ body: { uin: '10001' } } as any, res, vi.fn());

    expect(state.body).toMatchObject({
      code: 1,
      message: 'QQ Is Logined',
    });
  });

  test('GetQRcode rejects stale empty QR after reconciliation', async () => {
    WebUiDataRuntime.setQQLoginStatus(true);
    WebUiDataRuntime.setQQLoginQrcodeURL('old-qrcode-url');
    setCoreOnlineState(false);
    const { res, state } = createMockResponse();

    await QQGetQRcodeHandler({} as any, res, vi.fn());

    expect(state.body).toMatchObject({
      code: 1,
      message: 'QRCode Get Error',
    });
  });
});
```

- [ ] **Step 2: Run the failing handler tests**

Run:

```powershell
corepack pnpm --dir 'D:\MyFiles\KT\GitHub\NapCatQQ' --filter napcat-test exec vitest run webuiQQLoginHandlers.test.ts
```

Expected: FAIL because handlers still use direct `getQQLoginStatus()` guards and `RefreshQRcode` does not return result data.

- [ ] **Step 3: Add handler helper with JSDoc**

In `QQLogin.ts`, add below helper functions:

```ts
/**
 * Reconciles WebUI login state and returns true only when the QQ account is actually online.
 * @param clearStaleQRCode - Whether stale QR cache should be cleared while reconciling offline state.
 */
function isActuallyLoggedIn (clearStaleQRCode = true): boolean {
  return WebUiDataRuntime.getQQLoginRuntimeState({
    clearStaleQRCode,
    reconcile: true,
  }).isActuallyLogin;
}

/**
 * Builds the login status payload from the shared runtime state helper.
 * @returns Handler response payload used by CheckLoginStatus.
 */
function buildLoginStatusPayload () {
  const state = WebUiDataRuntime.getQQLoginRuntimeState({
    clearStaleQRCode: true,
    reconcile: true,
  });
  return {
    isLogin: state.isActuallyLogin,
    isOffline: state.isStaleLoginStatus,
    loginError: WebUiDataRuntime.getQQLoginError(),
    qrcodeRevision: state.qrcodeRevision,
    qrcodeUpdatedAt: state.qrcodeUpdatedAt,
    qrcodeurl: state.qrcodeurl,
  };
}
```

- [ ] **Step 4: Replace direct login guards**

For `QQGetQRcodeHandler`, `QQSetQuickLoginHandler`, `QQRefreshQRcodeHandler`, `QQPasswordLoginHandler`, `QQCaptchaLoginHandler`, and `QQNewDeviceLoginHandler`, replace direct `WebUiDataRuntime.getQQLoginStatus()` checks with:

```ts
  if (isActuallyLoggedIn()) {
    return sendError(res, 'QQ Is Logined');
  }
```

For `QQCheckLoginStatusHandler`, replace the body with:

```ts
export const QQCheckLoginStatusHandler: RequestHandler = async (_, res) => {
  return sendSuccess(res, buildLoginStatusPayload());
};
```

For `QQRefreshQRcodeHandler`, replace the refresh body with:

```ts
  const result = await WebUiDataRuntime.refreshQRCode();
  if (!result.accepted) {
    return sendError(res, result.error || 'QRCode Refresh Rejected');
  }
  return sendSuccess(res, result);
```

- [ ] **Step 5: Add JSDoc to touched exported handlers**

Add one-sentence JSDoc above every touched exported handler. Example for refresh:

```ts
/**
 * Refreshes the manual QQ login QR code when the account is not actually online.
 */
export const QQRefreshQRcodeHandler: RequestHandler = async (_, res) => {
```

Repeat this style for the other touched handlers.

- [ ] **Step 6: Run handler tests**

Run:

```powershell
corepack pnpm --dir 'D:\MyFiles\KT\GitHub\NapCatQQ' --filter napcat-test exec vitest run webuiQQLoginHandlers.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run combined WebUI tests**

Run:

```powershell
corepack pnpm --dir 'D:\MyFiles\KT\GitHub\NapCatQQ' --filter napcat-test exec vitest run webuiLoginRuntime.test.ts webuiQQLoginHandlers.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```powershell
git -C 'D:\MyFiles\KT\GitHub\NapCatQQ' add packages/napcat-webui-backend/src/api/QQLogin.ts packages/napcat-test/webuiQQLoginHandlers.test.ts
git -C 'D:\MyFiles\KT\GitHub\NapCatQQ' commit -m "fix: 收敛QQ登录接口真实在线态判断"
```

## Task 5: Wire Shell and Framework QR Refresh Callback

**Files:**
- Create: `D:\MyFiles\KT\GitHub\NapCatQQ\packages\napcat-test\webuiLoginSourceWiring.test.ts`
- Modify: `D:\MyFiles\KT\GitHub\NapCatQQ\packages\napcat-shell\base.ts`
- Modify: `D:\MyFiles\KT\GitHub\NapCatQQ\packages\napcat-framework\napcat.ts`

- [ ] **Step 1: Write failing source wiring test**

Create `packages/napcat-test/webuiLoginSourceWiring.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const repoRoot = resolve(__dirname, '../..');

/**
 * Reads a NapCatQQ source file from the repository root.
 * @param relativePath - Repo-relative source path to inspect.
 */
function readSource (relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

describe('WebUI QR refresh source wiring', () => {
  test('shell returns loginService.getQRCodePicture accepted state', () => {
    const source = readSource('packages/napcat-shell/base.ts');

    expect(source).toContain('WebUiDataRuntime.setRefreshQRCodeCallback(async () => {');
    expect(source).toContain('return loginService.getQRCodePicture();');
  });

  test('framework returns loginService.getQRCodePicture accepted state', () => {
    const source = readSource('packages/napcat-framework/napcat.ts');

    expect(source).toContain('WebUiDataRuntime.setRefreshQRCodeCallback(async () => {');
    expect(source).toContain('return loginService.getQRCodePicture();');
  });
});
```

- [ ] **Step 2: Run the failing source wiring test**

Run:

```powershell
corepack pnpm --dir 'D:\MyFiles\KT\GitHub\NapCatQQ' --filter napcat-test exec vitest run webuiLoginSourceWiring.test.ts
```

Expected: FAIL because both callbacks call `loginService.getQRCodePicture()` without returning it.

- [ ] **Step 3: Update Shell callback**

In `packages/napcat-shell/base.ts`, replace:

```ts
  WebUiDataRuntime.setRefreshQRCodeCallback(async () => {
    loginService.getQRCodePicture();
  });
```

with:

```ts
  WebUiDataRuntime.setRefreshQRCodeCallback(async () => {
    return loginService.getQRCodePicture();
  });
```

- [ ] **Step 4: Update Framework callback**

In `packages/napcat-framework/napcat.ts`, replace:

```ts
  WebUiDataRuntime.setRefreshQRCodeCallback(async () => {
    loginService.getQRCodePicture();
  });
```

with:

```ts
  WebUiDataRuntime.setRefreshQRCodeCallback(async () => {
    return loginService.getQRCodePicture();
  });
```

- [ ] **Step 5: Run source wiring test**

Run:

```powershell
corepack pnpm --dir 'D:\MyFiles\KT\GitHub\NapCatQQ' --filter napcat-test exec vitest run webuiLoginSourceWiring.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run shell and framework typecheck**

Run:

```powershell
corepack pnpm --dir 'D:\MyFiles\KT\GitHub\NapCatQQ' --filter napcat-shell run typecheck
corepack pnpm --dir 'D:\MyFiles\KT\GitHub\NapCatQQ' --filter napcat-framework run typecheck
```

Expected: both commands PASS.

- [ ] **Step 7: Commit**

Run:

```powershell
git -C 'D:\MyFiles\KT\GitHub\NapCatQQ' add packages/napcat-shell/base.ts packages/napcat-framework/napcat.ts packages/napcat-test/webuiLoginSourceWiring.test.ts
git -C 'D:\MyFiles\KT\GitHub\NapCatQQ' commit -m "fix: 返回二维码刷新请求接收状态"
```

## Task 6: Build and Verify NapCatQQ Fork Artifact

**Files:**
- No new source files unless verification reveals a targeted compile or test issue.

- [ ] **Step 1: Install dependencies**

Run:

```powershell
corepack pnpm --dir 'D:\MyFiles\KT\GitHub\NapCatQQ' install --frozen-lockfile
```

Expected: install succeeds.

- [ ] **Step 2: Run fork tests**

Run:

```powershell
corepack pnpm --dir 'D:\MyFiles\KT\GitHub\NapCatQQ' --filter napcat-test exec vitest run webuiLoginRuntime.test.ts webuiQQLoginHandlers.test.ts webuiLoginSourceWiring.test.ts
corepack pnpm --dir 'D:\MyFiles\KT\GitHub\NapCatQQ' --filter napcat-test exec vitest run
```

Expected: all tests PASS.

- [ ] **Step 3: Run typecheck**

Run:

```powershell
corepack pnpm --dir 'D:\MyFiles\KT\GitHub\NapCatQQ' run typecheck
```

Expected: PASS.

- [ ] **Step 4: Build Shell artifact**

Run:

```powershell
corepack pnpm --dir 'D:\MyFiles\KT\GitHub\NapCatQQ' --filter napcat-webui-frontend run build
corepack pnpm --dir 'D:\MyFiles\KT\GitHub\NapCatQQ' run build:shell
```

Expected: `D:\MyFiles\KT\GitHub\NapCatQQ\packages\napcat-shell\dist\napcat.mjs` exists.

- [ ] **Step 5: Record artifact evidence**

Run:

```powershell
git -C 'D:\MyFiles\KT\GitHub\NapCatQQ' log -1 --oneline
Get-FileHash -Algorithm SHA256 'D:\MyFiles\KT\GitHub\NapCatQQ\packages\napcat-shell\dist\napcat.mjs'
```

Expected: output includes fork commit and a SHA256 for `napcat.mjs`.

## Task 7: Add API Build-Context Staging Script

**Files:**
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\scripts\napcat-desktop-cn-stage-build.mjs`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\qqbot\napcat\napcat-desktop-cn-image.spec.ts`

- [ ] **Step 1: Add failing static test for staging script**

Append this test to `napcat-desktop-cn-image.spec.ts`:

```ts
  it('stages source-built NapCat Shell artifacts for Docker build context', () => {
    const script = readSource('scripts/napcat-desktop-cn-stage-build.mjs');

    expect(script).toContain('napcatMjsSha256');
    expect(script).toContain('forkCommit');
    expect(script).toContain('upstreamBaseCommit');
    expect(script).toContain('packages/napcat-shell/dist');
    expect(script).toContain('fork-artifact.json');
    expect(script).toContain('.kt-workspace/napcat-desktop-cn-build');
  });
```

- [ ] **Step 2: Run the failing API image test**

Run:

```powershell
corepack pnpm --dir 'D:\MyFiles\KT\Node\kt-template-online-api' exec jest test/modules/qqbot/napcat/napcat-desktop-cn-image.spec.ts --runTestsByPath --runInBand
```

Expected: FAIL because the staging script does not exist.

- [ ] **Step 3: Create the staging script**

Create `scripts/napcat-desktop-cn-stage-build.mjs`:

```js
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_OUTPUT = '.kt-workspace/napcat-desktop-cn-build';
const DEFAULT_UPSTREAM_BASE = '5c18a62530d87dbadf53d267002894faa6ca7e90';

/**
 * Reads a named CLI argument in `--key value` form.
 * @param {string} name - Argument name without the leading dashes.
 * @param {string} fallback - Value used when the argument is absent.
 * @returns {string} Parsed argument value.
 */
function readArg (name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

/**
 * Computes a SHA256 digest for a file.
 * @param {string} filePath - Absolute path to the file being fingerprinted.
 * @returns {string} Lowercase hex SHA256 digest.
 */
function sha256File (filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/**
 * Recursively computes a stable digest for a directory from relative paths and file contents.
 * @param {string} directory - Absolute directory path.
 * @returns {string} Lowercase hex SHA256 digest.
 */
function sha256Directory (directory) {
  const hash = createHash('sha256');
  const stack = [directory];
  const files = [];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of listDirectory(current)) {
      const absolute = join(current, entry);
      if (statSync(absolute).isDirectory()) {
        stack.push(absolute);
      } else {
        files.push(absolute);
      }
    }
  }
  files.sort();
  for (const file of files) {
    hash.update(relative(directory, file).split(sep).join('/'));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/**
 * Lists directory entries in stable order.
 * @param {string} directory - Directory to list.
 * @returns {string[]} Sorted child names.
 */
function listDirectory (directory) {
  return readdirSync(directory).sort();
}

/**
 * Reads the current git commit for the NapCat fork.
 * @param {string} repoRoot - Absolute repository path.
 * @returns {string} Current commit hash.
 */
function gitCommit (repoRoot) {
  return execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

/**
 * Copies one file or directory into the staged Docker context.
 * @param {string} source - Source path.
 * @param {string} target - Target path.
 */
function copyIntoContext (source, target) {
  cpSync(source, target, { recursive: true });
}

const apiRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const napcatRoot = resolve(readArg('napcat-root'));
const outputRoot = resolve(apiRoot, readArg('out', DEFAULT_OUTPUT));
const upstreamBaseCommit = readArg('upstream-base-commit', DEFAULT_UPSTREAM_BASE);
const shellDist = resolve(napcatRoot, 'packages/napcat-shell/dist');
const napcatMjs = resolve(shellDist, 'napcat.mjs');

if (!napcatRoot || !existsSync(napcatRoot)) {
  throw new Error('--napcat-root must point to the NapCatQQ fork repository');
}
if (!existsSync(napcatMjs)) {
  throw new Error(`NapCat shell build output is missing: ${napcatMjs}`);
}

rmSync(outputRoot, { force: true, recursive: true });
mkdirSync(resolve(outputRoot, 'ci/napcat-desktop-cn'), { recursive: true });
copyIntoContext(resolve(apiRoot, 'ci/napcat-desktop-cn/Dockerfile'), resolve(outputRoot, 'ci/napcat-desktop-cn/Dockerfile'));
copyIntoContext(resolve(apiRoot, 'ci/napcat-desktop-cn/verify.sh'), resolve(outputRoot, 'ci/napcat-desktop-cn/verify.sh'));
copyIntoContext(shellDist, resolve(outputRoot, 'NapCat.Shell'));

const marker = {
  builtAt: new Date().toISOString(),
  distSha256: sha256Directory(shellDist),
  forkCommit: gitCommit(napcatRoot),
  napcatMjsSha256: sha256File(napcatMjs),
  upstreamBaseCommit,
};

writeFileSync(
  resolve(outputRoot, 'ci/napcat-desktop-cn/fork-artifact.json'),
  `${JSON.stringify(marker, null, 2)}\n`,
  'utf8'
);

console.log(JSON.stringify({
  marker,
  outputRoot,
}, null, 2));
```

- [ ] **Step 4: Run the API image test**

Run:

```powershell
corepack pnpm --dir 'D:\MyFiles\KT\Node\kt-template-online-api' exec jest test/modules/qqbot/napcat/napcat-desktop-cn-image.spec.ts --runTestsByPath --runInBand
```

Expected: this new test passes, while old bundled-patch tests still fail until Task 8 updates them.

## Task 8: Replace Bundled-JS Patch With Source Artifact Image

**Files:**
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\ci\napcat-desktop-cn\Dockerfile`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\ci\napcat-desktop-cn\verify.sh`
- Delete: `D:\MyFiles\KT\Node\kt-template-online-api\ci\napcat-desktop-cn\patches\qq-login-real-online-guard.sh`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\qqbot\napcat\napcat-desktop-cn-image.spec.ts`

- [ ] **Step 1: Replace the old patch assertions**

In `napcat-desktop-cn-image.spec.ts`, replace the test named `patches NapCat WebUI login guards to allow qrcode refresh after real QQ offline` with:

```ts
  it('uses source-built NapCat Shell artifact instead of bundled JS patching', () => {
    const dockerfile = readSource('ci/napcat-desktop-cn/Dockerfile');
    const verify = readSource('ci/napcat-desktop-cn/verify.sh');

    expect(dockerfile).toContain('COPY NapCat.Shell /tmp/NapCat.Shell');
    expect(dockerfile).toContain('fork-artifact.json');
    expect(dockerfile).toContain('zip -qr /app/NapCat.Shell.zip .');
    expect(dockerfile).not.toContain('qq-login-real-online-guard.sh');
    expect(dockerfile).not.toContain('NAPCAT_PATCH_ROOT');
    expect(verify).toContain('napcatMjsSha256');
    expect(verify).toContain('getQQLoginRuntimeState');
    expect(verify).toContain('qrcodeRevision');
    expect(verify).not.toContain('selfInfo?.online !== false');
  });
```

Also remove expectations that read `ci/napcat-desktop-cn/patches/qq-login-real-online-guard.sh`.

- [ ] **Step 2: Run the failing image test**

Run:

```powershell
corepack pnpm --dir 'D:\MyFiles\KT\Node\kt-template-online-api' exec jest test/modules/qqbot/napcat/napcat-desktop-cn-image.spec.ts --runTestsByPath --runInBand
```

Expected: FAIL because Dockerfile and verify still reference the old patch.

- [ ] **Step 3: Replace Dockerfile patch block**

Replace the patch block in `ci/napcat-desktop-cn/Dockerfile` with:

```dockerfile
COPY NapCat.Shell /tmp/NapCat.Shell
COPY ci/napcat-desktop-cn/fork-artifact.json /ci/napcat-desktop-cn/fork-artifact.json
RUN set -eux; \
  cd /tmp/NapCat.Shell; \
  zip -qr /app/NapCat.Shell.zip .; \
  sha256sum /app/NapCat.Shell.zip | awk '{print $1}' > /ci/napcat-desktop-cn/NapCat.Shell.zip.sha256; \
  rm -rf /tmp/NapCat.Shell
COPY ci/napcat-desktop-cn/verify.sh /ci/napcat-desktop-cn/verify.sh
RUN sed -i 's/\r$//' /ci/napcat-desktop-cn/verify.sh && chmod +x /ci/napcat-desktop-cn/verify.sh
```

- [ ] **Step 4: Replace verify.sh**

Replace `ci/napcat-desktop-cn/verify.sh` with:

```sh
#!/bin/sh
set -eu

MARKER=/ci/napcat-desktop-cn/fork-artifact.json
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

locale -a | grep -i '^zh_CN.utf8$'
locale | grep 'LANG=zh_CN.UTF-8'
test "$(cat /etc/timezone)" = "Asia/Shanghai"
fc-match "Noto Sans CJK SC" | grep -E 'Noto|WenQuanYi|wqy'
test "XDG_CONFIG_HOME=${XDG_CONFIG_HOME:-}" = "XDG_CONFIG_HOME=/app/.config"
test "XDG_CACHE_HOME=${XDG_CACHE_HOME:-}" = "XDG_CACHE_HOME=/app/.cache"
test "XDG_DATA_HOME=${XDG_DATA_HOME:-}" = "XDG_DATA_HOME=/app/.local/share"
test ! -e /.dockerenv
grep -q '^0::/$' /proc/1/cgroup

test -s "$MARKER"
grep -q '"upstreamBaseCommit"' "$MARKER"
grep -q '"forkCommit"' "$MARKER"
grep -q '"napcatMjsSha256"' "$MARKER"
test -s /app/NapCat.Shell.zip
test -s /ci/napcat-desktop-cn/NapCat.Shell.zip.sha256

unzip -q /app/NapCat.Shell.zip -d "$TMP_DIR"
test -s "$TMP_DIR/napcat.mjs"

EXPECTED_MJS_SHA="$(sed -n 's/.*"napcatMjsSha256"[[:space:]]*:[[:space:]]*"\([a-f0-9]\{64\}\)".*/\1/p' "$MARKER")"
ACTUAL_MJS_SHA="$(sha256sum "$TMP_DIR/napcat.mjs" | awk '{print $1}')"
test "$EXPECTED_MJS_SHA" = "$ACTUAL_MJS_SHA"

grep -R -q 'getQQLoginRuntimeState' "$TMP_DIR"
grep -R -q 'qrcodeRevision' "$TMP_DIR"
```

- [ ] **Step 5: Delete old patch script**

Run:

```powershell
git -C 'D:\MyFiles\KT\Node\kt-template-online-api' rm -- 'ci/napcat-desktop-cn/patches/qq-login-real-online-guard.sh'
```

Expected: file is staged for deletion.

- [ ] **Step 6: Run image tests**

Run:

```powershell
corepack pnpm --dir 'D:\MyFiles\KT\Node\kt-template-online-api' exec jest test/modules/qqbot/napcat/napcat-desktop-cn-image.spec.ts --runTestsByPath --runInBand
```

Expected: PASS.

## Task 9: Update Runtime Profile Version and Docs

**Files:**
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\napcat\application\runtime\napcat-runtime-profile.service.ts`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\qqbot\napcat\runtime-protocol-profile.spec.ts`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\ci\napcat-desktop-cn\README.md`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\README.md`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\API.md`
- Modify: `D:\MyFiles\KT\docs\qqbot-nas-runtime.md`

- [ ] **Step 1: Write failing profile-version expectation**

In `runtime-protocol-profile.spec.ts`, change:

```ts
desktopProfileVersion: 'desktop-cn-v2',
```

to:

```ts
desktopProfileVersion: 'desktop-cn-v3',
```

Run:

```powershell
corepack pnpm --dir 'D:\MyFiles\KT\Node\kt-template-online-api' exec jest test/modules/qqbot/napcat/runtime-protocol-profile.spec.ts --runTestsByPath --runInBand --testNamePattern "resolves Chinese Desktop Runtime defaults"
```

Expected: FAIL because service default is still `desktop-cn-v2`.

- [ ] **Step 2: Update service default**

In `napcat-runtime-profile.service.ts`, change:

```ts
'desktop-cn-v2',
```

to:

```ts
'desktop-cn-v3',
```

- [ ] **Step 3: Update README commands**

Replace `ci/napcat-desktop-cn/README.md` with:

```md
# NapCat Chinese Desktop Runtime Image

This image consumes a source-built NapCatQQ Shell artifact staged from `D:\MyFiles\KT\GitHub\NapCatQQ`.

Build NapCatQQ first:

```powershell
corepack pnpm --dir D:\MyFiles\KT\GitHub\NapCatQQ install --frozen-lockfile
corepack pnpm --dir D:\MyFiles\KT\GitHub\NapCatQQ --filter napcat-webui-frontend run build
corepack pnpm --dir D:\MyFiles\KT\GitHub\NapCatQQ run build:shell
```

Stage Docker build context:

```powershell
node scripts/napcat-desktop-cn-stage-build.mjs `
  --napcat-root D:\MyFiles\KT\GitHub\NapCatQQ `
  --out .kt-workspace\napcat-desktop-cn-build
```

Build and verify:

```powershell
$baseImage = docker image inspect mlikiowa/napcat-docker:latest --format '{{index .RepoDigests 0}}'
if (-not $baseImage) { throw 'NapCat upstream image digest not found; pull and inspect the image before building.' }
docker build `
  --build-arg NAPCAT_BASE_IMAGE=$baseImage `
  -t kt-napcat-desktop-cn:desktop-cn-v3 `
  -f .kt-workspace/napcat-desktop-cn-build/ci/napcat-desktop-cn/Dockerfile `
  .kt-workspace/napcat-desktop-cn-build

$name = "kt-napcat-v3-verify-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
docker run -d --name $name kt-napcat-desktop-cn:desktop-cn-v3
docker exec $name sh /ci/napcat-desktop-cn/verify.sh
docker rm -f $name
```

Record the final image digest in `QQBOT_NAPCAT_IMAGE`.
```

- [ ] **Step 4: Update project docs**

In `README.md`, `API.md`, and `D:\MyFiles\KT\docs\qqbot-nas-runtime.md`, add a short note under the existing QQBot/NapCat runtime sections:

```md
NapCat Chinese Desktop Runtime v3 uses a source-built `NapCat.Shell` artifact from the KT `NapCatQQ` fork. The image must be staged with `scripts/napcat-desktop-cn-stage-build.mjs`; production should point `QQBOT_NAPCAT_IMAGE` to the verified `kt-napcat-desktop-cn:desktop-cn-v3` digest.
```

- [ ] **Step 5: Run profile tests**

Run:

```powershell
corepack pnpm --dir 'D:\MyFiles\KT\Node\kt-template-online-api' exec jest test/modules/qqbot/napcat/runtime-protocol-profile.spec.ts --runTestsByPath --runInBand
```

Expected: PASS.

## Task 10: Validate API Image Integration and Commit

**Files:**
- All API files changed in Tasks 7 to 9.
- Root docs changed in Task 9.

- [ ] **Step 1: Run focused API tests**

Run:

```powershell
corepack pnpm --dir 'D:\MyFiles\KT\Node\kt-template-online-api' exec jest test/modules/qqbot/napcat/napcat-desktop-cn-image.spec.ts test/modules/qqbot/napcat/runtime-protocol-profile.spec.ts --runTestsByPath --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run API typecheck**

Run:

```powershell
corepack pnpm --dir 'D:\MyFiles\KT\Node\kt-template-online-api' run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run diff check**

Run:

```powershell
git -C 'D:\MyFiles\KT\Node\kt-template-online-api' diff --check
git -C 'D:\MyFiles\KT' diff --check -- TASKS.md docs/qqbot-nas-runtime.md
```

Expected: no whitespace errors.

- [ ] **Step 4: Run global review**

Run:

```powershell
pnpm --dir 'D:\MyFiles\KT\mcp\ktWorkflow' run global-review
```

Expected: `findings=[]`.

- [ ] **Step 5: Commit API repo**

Run:

```powershell
git -C 'D:\MyFiles\KT\Node\kt-template-online-api' status --short
git -C 'D:\MyFiles\KT\Node\kt-template-online-api' add ci/napcat-desktop-cn scripts/napcat-desktop-cn-stage-build.mjs src/modules/qqbot/napcat/application/runtime/napcat-runtime-profile.service.ts test/modules/qqbot/napcat README.md API.md
git -C 'D:\MyFiles\KT\Node\kt-template-online-api' commit -m "feat: 接入NapCat源码构建镜像"
```

- [ ] **Step 6: Commit root docs**

Run:

```powershell
git -C 'D:\MyFiles\KT' status --short
git -C 'D:\MyFiles\KT' add docs/qqbot-nas-runtime.md TASKS.md
git -C 'D:\MyFiles\KT' commit -m "docs: 记录NapCat源码构建运行态"
```

If the root repo has unrelated dirty files, stage only `docs/qqbot-nas-runtime.md` and `TASKS.md`.

## Task 11: Build Image and Run Local or NAS Verify

**Files:**
- No source files unless verification exposes a targeted bug.

- [ ] **Step 1: Stage build context**

Run from `D:\MyFiles\KT\Node\kt-template-online-api`:

```powershell
node scripts/napcat-desktop-cn-stage-build.mjs `
  --napcat-root D:\MyFiles\KT\GitHub\NapCatQQ `
  --out .kt-workspace\napcat-desktop-cn-build
```

Expected: output contains `forkCommit`, `upstreamBaseCommit`, `napcatMjsSha256`, and `outputRoot`.

- [ ] **Step 2: Build image**

Run:

```powershell
$baseImage = docker image inspect mlikiowa/napcat-docker:latest --format '{{index .RepoDigests 0}}'
if (-not $baseImage) { docker pull mlikiowa/napcat-docker:latest; $baseImage = docker image inspect mlikiowa/napcat-docker:latest --format '{{index .RepoDigests 0}}' }
docker build `
  --build-arg NAPCAT_BASE_IMAGE=$baseImage `
  -t kt-napcat-desktop-cn:desktop-cn-v3 `
  -f .kt-workspace/napcat-desktop-cn-build/ci/napcat-desktop-cn/Dockerfile `
  .kt-workspace/napcat-desktop-cn-build
```

Expected: image builds successfully.

- [ ] **Step 3: Run image verify**

Run:

```powershell
$name = "kt-napcat-v3-verify-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
docker run -d --name $name kt-napcat-desktop-cn:desktop-cn-v3
docker exec $name sh /ci/napcat-desktop-cn/verify.sh
docker rm -f $name
docker image inspect kt-napcat-desktop-cn:desktop-cn-v3 --format '{{.Id}}'
```

Expected: verify exits 0 and image id is printed.

## Task 12: Deploy and Canary Online

**Files:**
- No source files unless online verification exposes a targeted bug.

- [ ] **Step 1: Push only after user approval**

Run only when the user asks to publish:

```powershell
git -C 'D:\MyFiles\KT\GitHub\NapCatQQ' status --short --branch
git -C 'D:\MyFiles\KT\Node\kt-template-online-api' status --short --branch
git -C 'D:\MyFiles\KT' status --short --branch
```

Expected: only intentional commits are ahead.

- [ ] **Step 2: Push API and fork branches**

Run:

```powershell
git -C 'D:\MyFiles\KT\GitHub\NapCatQQ' push -u origin codex/qr-refresh-login-state
git -C 'D:\MyFiles\KT\Node\kt-template-online-api' push origin main
```

Expected: both pushes succeed.

- [ ] **Step 3: Observe API deployment**

Run:

```powershell
pnpm --dir 'D:\MyFiles\KT\mcp\ktWorkflow' run deploy-observation -- --project api --job KT-Template/KT-Template-API/main --execute
```

Expected: Jenkins succeeds, K8s Deployment updated, new Pod Running/Ready, restartCount stable.

- [ ] **Step 4: Configure production image**

Using the existing NAS/K8s env update workflow, set:

```text
QQBOT_NAPCAT_IMAGE=kt-napcat-desktop-cn:desktop-cn-v3
QQBOT_NAPCAT_DESKTOP_PROFILE_VERSION=desktop-cn-v3
```

Expected: API Pod sees the new env after rollout.

- [ ] **Step 5: Canary one account**

Use the current Admin update-login flow for one user-approved account. Evidence to capture:

```text
NapCat fork commit:
NapCat image id:
scan session id:
old qrcode sha prefix:
new qrcode sha prefix:
/app/napcat/cache/qrcode.png old mtime:
/app/napcat/cache/qrcode.png new mtime:
RefreshQRcode accepted:
RefreshQRcode updated:
SSE final observed state:
```

Expected:

- stale `QQLoginStatus=true + online=false` no longer returns `QQ Is Logined`.
- NapCat emits a new QR event or returns `accepted=true, updated=false` with no stale QR exposed.
- API `scan/status` never returns the old QR hash.
- Admin/SSE shows either a new QR or a precise pending reason.

## Self-Review Checklist

- Spec goal 1, source fork: Tasks 1 to 6.
- Spec goal 2, stale login state: Tasks 2 to 4.
- Spec goal 3, refresh observability: Tasks 2, 3, 5, 12.
- Spec goal 4, no stale QR in WebUI handlers: Task 4.
- Spec goal 5, API stale-QR guard retained: Tasks 7 to 10 do not edit API login service.
- Spec goal 6, source artifact image: Tasks 7 to 11.
- Spec goal 7, local and online verification: Tasks 6, 10, 11, 12.
- No placeholder markers remain in this plan.
