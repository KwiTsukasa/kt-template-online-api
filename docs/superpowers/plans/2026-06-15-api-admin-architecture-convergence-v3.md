# API/Admin Architecture Convergence V3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the third-phase target architecture true in code by migrating all API legacy roots into `src/modules/**`, enforcing structure tests, slimming every API/Admin domain, preserving behavior, and deleting `src/admin`, `src/blog`, `src/minio`, `src/wordpress`, and `src/qqbot`.

**Architecture:** Work from hard RED structure gates, then migrate one domain at a time. Each domain task includes three inseparable pieces: move ownership into the target module, remove duplicate/unused transitional code, and run behavior checks that prove existing routes and Admin pages still work. The final task deletes old roots and runs the full convergence gate.

**Tech Stack:** NestJS 11, TypeORM 0.3, MySQL, Jest, pnpm 9 API workspace, Vben Admin 5, Vue 3 TSX/Vue SFC, Vitest, pnpm 10 Admin workspace, ktWorkflow global review, Superpowers review.

---

## Scope Check

This plan covers two repos because the approved spec requires API and Admin to converge together:

- API repo: `D:\MyFiles\KT\Node\kt-template-online-api`, branch `dev-api-architecture-convergence-v3`.
- Admin repo: `D:\MyFiles\KT\Vue\kt-template-admin`, branch `dev-admin-architecture-convergence-v3`.
- Root repo: `D:\MyFiles\KT`, branch `main`, used only for `TASKS.md` record updates.

The work is one architecture-convergence batch, not a new product phase. Do not split into an API-only plan and an Admin-only plan; the Admin caller/page slimming is part of the same completion gate.

## Current State Evidence

API old roots currently exist:

| Root | Files | Directories |
| --- | ---: | ---: |
| `src/admin` | 42 | 11 |
| `src/blog` | 13 | 0 |
| `src/minio` | 5 | 0 |
| `src/wordpress` | 9 | 0 |
| `src/qqbot` | 55 | 14 |

`src/modules/**` currently imports old roots:

| Alias | Hits |
| --- | ---: |
| `@/admin/` | 37 |
| `@/blog/` | 7 |
| `@/minio/` | 3 |
| `@/wordpress/` | 7 |
| `@/qqbot/` | 50 |

Admin current touched domains:

- API callers: `apps/web-antdv-next/src/api/system/**`, `apps/web-antdv-next/src/api/blog/**`, `apps/web-antdv-next/src/api/qqbot/**`.
- Pages: `apps/web-antdv-next/src/views/system/**`, `apps/web-antdv-next/src/views/blog/**`, `apps/web-antdv-next/src/views/qqbot/**`.

## Execution Rules

- Do not push.
- Do not deploy.
- Do not run online database writes.
- Do not create `.worktree`.
- Use `apply_patch` for manual code edits.
- Use `git mv` for file moves when practical so history stays readable.
- Before deleting a file, run `rg` for the exported class/function/type and for the relative path stem.
- Every task must leave the repo status understandable: only paths named by the task should be changed.
- Every domain migration must record its slimming decisions in `docs/refactor-v3/architecture-convergence-inventory.md`.
- If a domain has a feature that is only reachable by reflection, SQL seed, menu route, plugin manifest, or Nest DI, prove it with a test or smoke before deleting it.
- Keep route paths and response shapes stable unless the task explicitly updates Admin callers and smoke evidence.

## File Structure Map

### API Files To Create

| Path | Responsibility |
| --- | --- |
| `test/refactor-v3/architecture-convergence.spec.ts` | Hard API structure gate for old roots, forbidden imports, target modules, and app module imports. |
| `docs/refactor-v3/architecture-convergence-inventory.md` | Per-domain slimming evidence: delete, merge, keep, and uncertain decisions. |
| `docs/refactor-v3/architecture-convergence-verification.md` | Final command evidence and smoke summary. |

### API Files To Move Or Rewrite

| Source | Target |
| --- | --- |
| `src/admin/auth/**` | `src/modules/admin/identity/auth/**` |
| `src/admin/user/**` | `src/modules/admin/identity/user/**` |
| `src/admin/role/**` | `src/modules/admin/identity/role/**` |
| `src/admin/menu/**` | `src/modules/admin/identity/menu/**` |
| `src/admin/dept/**` | `src/modules/admin/identity/dept/**` |
| `src/admin/admin.types.ts` | `src/modules/admin/contract/admin.types.ts` |
| `src/admin/component/**` | `src/modules/admin/platform-config/component/**` |
| `src/admin/dict/**` | `src/modules/admin/platform-config/dict/**` |
| `src/admin/notice/**` | `src/modules/admin/platform-config/notice/**` |
| `src/admin/system-log/**` | `src/modules/admin/platform-config/system-log/**` |
| `src/admin/timezone/**` | `src/modules/admin/platform-config/timezone/**` |
| `src/admin/example/**` | Delete unless route/menu/test evidence proves it is active. |
| `src/blog/**` | `src/modules/blog/**`, split controller/DTO/service/entity by local responsibility. |
| `src/wordpress/**` | `src/modules/wordpress/**`, split controller/DTO/service/types by local responsibility. |
| `src/minio/**` | `src/modules/asset/**`, keep `/minio/*` routes but remove old source root. |
| `src/qqbot/account/qqbot-napcat-login.service.ts` | `src/modules/qqbot/napcat/login/qqbot-napcat-login.service.ts` |
| `src/qqbot/account/qqbot-napcat-watchdog.service.ts` | `src/modules/qqbot/napcat/login/qqbot-napcat-watchdog.service.ts` |
| `src/qqbot/napcat/**` | `src/modules/qqbot/napcat/**` |
| `src/qqbot/account/**` except NapCat login services | `src/modules/qqbot/core/account/**` |
| `src/qqbot/command/**` | `src/modules/qqbot/core/command/**` |
| `src/qqbot/config/**` | `src/modules/qqbot/core/config/**` |
| `src/qqbot/connection/**` | `src/modules/qqbot/core/connection/**` |
| `src/qqbot/dashboard/**` | `src/modules/qqbot/core/dashboard/**` |
| `src/qqbot/dedupe/**` | `src/modules/qqbot/core/dedupe/**` |
| `src/qqbot/event/**` | `src/modules/qqbot/core/event/**` |
| `src/qqbot/message/**` | `src/modules/qqbot/core/message/**` |
| `src/qqbot/mqtt/**` | `src/modules/qqbot/core/mqtt/**` |
| `src/qqbot/permission/**` | `src/modules/qqbot/core/permission/**` |
| `src/qqbot/rule/**` | `src/modules/qqbot/core/rule/**` |
| `src/qqbot/send/**` | `src/modules/qqbot/core/send/**` |
| `src/qqbot/plugin/**` | Replace with `src/modules/qqbot/plugin-platform/**` contracts or delete old registry. |
| `src/qqbot/qqbot.types.ts` | `src/modules/qqbot/core/contract/qqbot.types.ts` |
| `src/qqbot/qqbot.constants.ts` | `src/modules/qqbot/core/contract/qqbot.constants.ts` |
| `src/qqbot/qqbot-cooldown.policy.ts` | `src/modules/qqbot/core/domain/qqbot-cooldown.policy.ts` |
| `src/qqbot/qqbot.module.ts` | Delete after `QqbotCoreModule` and `QqbotPluginPlatformModule` own all providers. |

### Admin Files To Create Or Modify

| Path | Responsibility |
| --- | --- |
| `apps/web-antdv-next/src/api/qqbot/index.ts` | QQBot core caller/type boundary. |
| `apps/web-antdv-next/src/api/qqbot/plugin.ts` | Plugin platform caller/type boundary. |
| `apps/web-antdv-next/src/api/qqbot/napcat.ts` | NapCat device/login/SSE helpers and Chinese progress labels. |
| `apps/web-antdv-next/src/api/system/*.ts` | System caller cleanup and type de-duplication. |
| `apps/web-antdv-next/src/api/blog/*.ts` | Blog/WordPress/Asset caller cleanup and type de-duplication. |
| `apps/web-antdv-next/src/views/system/**` | System page slimming and route/menu consistency. |
| `apps/web-antdv-next/src/views/blog/**` | Blog/WordPress/Asset page slimming and shared list/upload/import state. |
| `apps/web-antdv-next/src/views/qqbot/modules/status.ts` | Shared QQBot status/tag/progress mappings. |
| `apps/web-antdv-next/src/views/qqbot/modules/actions.tsx` | Shared QQBot table and operation actions. |
| `apps/web-antdv-next/src/views/qqbot/**` | QQBot Core, Plugin Platform, and NapCat page cleanup. |
| `apps/web-antdv-next/src/api/qqbot/napcat.spec.ts` | Keep and extend NapCat helper tests. |

## Task 0: Preflight And Inventory Baseline

**Files:**
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\docs\refactor-v3\architecture-convergence-inventory.md`
- Modify: `D:\MyFiles\KT\TASKS.md`

- [ ] **Step 1: Confirm clean repos and branches**

Run:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api status --short --branch
git -C D:\MyFiles\KT\Vue\kt-template-admin status --short --branch
git -C D:\MyFiles\KT status --short --branch
```

Expected:

```text
## dev-api-architecture-convergence-v3
## dev-admin-architecture-convergence-v3
## main
```

- [ ] **Step 2: Confirm package managers**

Run:

```powershell
Get-Content D:\MyFiles\KT\Node\kt-template-online-api\package.json | Select-String '"packageManager"'
Get-Content D:\MyFiles\KT\Vue\kt-template-admin\package.json | Select-String '"packageManager"|"engines"'
Get-Content D:\MyFiles\KT\Vue\kt-template-admin\.node-version
```

Expected:

```text
"packageManager": "pnpm@9.15.9+sha512
"packageManager": "pnpm@10.28.2"
22.22.0
```

- [ ] **Step 3: Add inventory document**

Use `apply_patch` to create `D:\MyFiles\KT\Node\kt-template-online-api\docs\refactor-v3\architecture-convergence-inventory.md`:

```markdown
# Architecture Convergence Inventory

## Baseline

| Area | Current Evidence | Target Evidence |
| --- | --- | --- |
| API legacy roots | `src/admin`, `src/blog`, `src/minio`, `src/wordpress`, `src/qqbot` exist. | These paths do not exist. |
| API forbidden module imports | `src/modules/**` imports old roots. | No import from `@/admin`, `@/blog`, `@/minio`, `@/wordpress`, or `@/qqbot`. |
| Admin System | System pages and callers exist under `views/system` and `api/system`. | No duplicate caller/type/page state after cleanup. |
| Admin Blog/Asset | Blog, WordPress, and Asset callers/pages exist under `api/blog` and `views/blog`. | Shared list/upload/import state where behavior repeats. |
| Admin QQBot | QQBot callers/pages exist under `api/qqbot` and `views/qqbot`. | Core, Plugin Platform, and NapCat state boundaries are explicit. |

## Domain Decisions

| Domain | Deleted | Merged | Kept | Evidence |
| --- | --- | --- | --- | --- |
| Admin/Auth/Platform Config | none yet | none yet | current files before migration | baseline only |
| Blog/WordPress/Asset | none yet | none yet | current files before migration | baseline only |
| Runtime/Common | none yet | none yet | current files before migration | baseline only |
| QQBot Core/NapCat | none yet | none yet | current files before migration | baseline only |
| Plugin Platform/Plugins | none yet | none yet | current files before migration | baseline only |
| Admin UI | none yet | none yet | current files before migration | baseline only |
```

- [ ] **Step 4: Run baseline scans**

Run:

```powershell
$api = 'D:\MyFiles\KT\Node\kt-template-online-api'
$roots = @('src/admin','src/blog','src/minio','src/wordpress','src/qqbot')
foreach ($root in $roots) {
  $path = Join-Path $api $root
  if (Test-Path $path) {
    $files = @(rg --files $path)
    Write-Output "$root files=$($files.Count)"
  }
}
rg -n '@/(admin|blog|minio|wordpress|qqbot)/' D:\MyFiles\KT\Node\kt-template-online-api\src\modules
```

Expected: old roots and forbidden imports are present before migration.

- [ ] **Step 5: Commit baseline inventory**

Run:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add docs/refactor-v3/architecture-convergence-inventory.md
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "docs: 建立架构收敛清理清单"
```

Expected: commit succeeds and includes only the inventory document.

## Task 1: API RED Structure Gate

**Files:**
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\test\refactor-v3\architecture-convergence.spec.ts`

- [ ] **Step 1: Write failing structure test**

Create `D:\MyFiles\KT\Node\kt-template-online-api\test\refactor-v3\architecture-convergence.spec.ts` with this content:

```ts
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const repoRoot = join(__dirname, '..', '..');
const srcRoot = join(repoRoot, 'src');

const legacyRoots = ['admin', 'blog', 'minio', 'wordpress', 'qqbot'];
const moduleRoots = ['admin', 'asset', 'blog', 'wordpress', 'qqbot'];
const qqbotRoots = ['core', 'napcat', 'plugin-platform', 'plugins'];

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const absolute = join(dir, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) return listFiles(absolute);
    return [absolute];
  });
}

function readTextFiles(dir: string): Array<{ file: string; text: string }> {
  return listFiles(dir)
    .filter((file) => /\.(ts|tsx|vue|js|mjs|cjs)$/.test(file))
    .map((file) => ({
      file: relative(repoRoot, file).replace(/\\/g, '/'),
      text: readFileSync(file, 'utf8'),
    }));
}

describe('architecture convergence', () => {
  it('does not keep API legacy source roots', () => {
    const existing = legacyRoots.filter((root) =>
      existsSync(join(srcRoot, root)),
    );

    expect(existing).toEqual([]);
  });

  it('keeps all business modules under src/modules', () => {
    const missing = moduleRoots.filter(
      (root) => !existsSync(join(srcRoot, 'modules', root)),
    );

    expect(missing).toEqual([]);
  });

  it('keeps QQBot subdomains under src/modules/qqbot', () => {
    const missing = qqbotRoots.filter(
      (root) => !existsSync(join(srcRoot, 'modules', 'qqbot', root)),
    );

    expect(missing).toEqual([]);
  });

  it('does not import old roots from src/modules', () => {
    const forbidden = /@\/(?:admin|blog|minio|wordpress|qqbot)\//;
    const offenders = readTextFiles(join(srcRoot, 'modules'))
      .filter(({ text }) => forbidden.test(text))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it('does not import old roots from app module', () => {
    const appModule = readFileSync(join(srcRoot, 'app.module.ts'), 'utf8');

    expect(appModule).not.toMatch(/from ['"]\.\/(?:admin|blog|minio|wordpress|qqbot)/);
    expect(appModule).not.toMatch(/from ['"]@\/(?:admin|blog|minio|wordpress|qqbot)\//);
  });
});
```

- [ ] **Step 2: Run the RED test**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand --runTestsByPath test/refactor-v3/architecture-convergence.spec.ts
```

Expected: FAIL. The failure must mention existing old roots and forbidden imports.

- [ ] **Step 3: Commit the RED gate**

Run:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add test/refactor-v3/architecture-convergence.spec.ts
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "test: 增加架构收敛结构门禁"
```

Expected: commit succeeds with the failing test. The failure is intentional and will turn green after migration.

## Task 2: Admin/Auth/Platform Config Migration And Slimming

**Files:**
- Move: `D:\MyFiles\KT\Node\kt-template-online-api\src\admin\auth\**`
- Move: `D:\MyFiles\KT\Node\kt-template-online-api\src\admin\user\**`
- Move: `D:\MyFiles\KT\Node\kt-template-online-api\src\admin\role\**`
- Move: `D:\MyFiles\KT\Node\kt-template-online-api\src\admin\menu\**`
- Move: `D:\MyFiles\KT\Node\kt-template-online-api\src\admin\dept\**`
- Move: `D:\MyFiles\KT\Node\kt-template-online-api\src\admin\component\**`
- Move: `D:\MyFiles\KT\Node\kt-template-online-api\src\admin\dict\**`
- Move: `D:\MyFiles\KT\Node\kt-template-online-api\src\admin\notice\**`
- Move: `D:\MyFiles\KT\Node\kt-template-online-api\src\admin\system-log\**`
- Move: `D:\MyFiles\KT\Node\kt-template-online-api\src\admin\timezone\**`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\admin\identity\admin-identity.module.ts`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\admin\platform-config\admin-platform-config.module.ts`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\docs\refactor-v3\architecture-convergence-inventory.md`
- Tests: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\admin\admin-contract.spec.ts`
- Tests: `D:\MyFiles\KT\Node\kt-template-online-api\test\admin\**`

- [ ] **Step 1: Move Admin identity files**

Run:

```powershell
$api = 'D:\MyFiles\KT\Node\kt-template-online-api'
New-Item -ItemType Directory -Force -Path "$api\src\modules\admin\identity\auth" | Out-Null
New-Item -ItemType Directory -Force -Path "$api\src\modules\admin\identity\user" | Out-Null
New-Item -ItemType Directory -Force -Path "$api\src\modules\admin\identity\role" | Out-Null
New-Item -ItemType Directory -Force -Path "$api\src\modules\admin\identity\menu" | Out-Null
New-Item -ItemType Directory -Force -Path "$api\src\modules\admin\identity\dept" | Out-Null
git -C $api mv src/admin/auth/* src/modules/admin/identity/auth/
git -C $api mv src/admin/user/* src/modules/admin/identity/user/
git -C $api mv src/admin/role/* src/modules/admin/identity/role/
git -C $api mv src/admin/menu/* src/modules/admin/identity/menu/
git -C $api mv src/admin/dept/* src/modules/admin/identity/dept/
git -C $api mv src/admin/admin.types.ts src/modules/admin/contract/admin.types.ts
```

Expected: moved files appear under `src/modules/admin/identity/**` and `src/modules/admin/contract/admin.types.ts`.

- [ ] **Step 2: Move platform config files**

Run:

```powershell
$api = 'D:\MyFiles\KT\Node\kt-template-online-api'
New-Item -ItemType Directory -Force -Path "$api\src\modules\admin\platform-config\component" | Out-Null
New-Item -ItemType Directory -Force -Path "$api\src\modules\admin\platform-config\dict" | Out-Null
New-Item -ItemType Directory -Force -Path "$api\src\modules\admin\platform-config\notice" | Out-Null
New-Item -ItemType Directory -Force -Path "$api\src\modules\admin\platform-config\system-log" | Out-Null
New-Item -ItemType Directory -Force -Path "$api\src\modules\admin\platform-config\timezone" | Out-Null
git -C $api mv src/admin/component/* src/modules/admin/platform-config/component/
git -C $api mv src/admin/dict/* src/modules/admin/platform-config/dict/
git -C $api mv src/admin/notice/* src/modules/admin/platform-config/notice/
git -C $api mv src/admin/system-log/* src/modules/admin/platform-config/system-log/
git -C $api mv src/admin/timezone/* src/modules/admin/platform-config/timezone/
```

Expected: moved files appear under `src/modules/admin/platform-config/**`.

- [ ] **Step 3: Decide and remove Admin example**

Run:

```powershell
$api = 'D:\MyFiles\KT\Node\kt-template-online-api'
rg -n 'AdminExampleController|admin/example|example' "$api\src" "$api\sql" "$api\test"
```

Expected: if the only source entry is `src/admin/example/admin-example.controller.ts`, delete it. If a menu, SQL seed, or test proves it is active, move it to `src/modules/admin/platform-config/example/` and add a contract test for the route.

For the delete path, run:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api rm -r src/admin/example
```

- [ ] **Step 4: Update imports to target Admin paths**

Replace imports using these mappings:

```text
@/admin/auth/ -> @/modules/admin/identity/auth/
@/admin/user/ -> @/modules/admin/identity/user/
@/admin/role/ -> @/modules/admin/identity/role/
@/admin/menu/ -> @/modules/admin/identity/menu/
@/admin/dept/ -> @/modules/admin/identity/dept/
@/admin/component/ -> @/modules/admin/platform-config/component/
@/admin/dict/ -> @/modules/admin/platform-config/dict/
@/admin/notice/ -> @/modules/admin/platform-config/notice/
@/admin/system-log/ -> @/modules/admin/platform-config/system-log/
@/admin/timezone/ -> @/modules/admin/platform-config/timezone/
@/admin/admin.types -> @/modules/admin/contract/admin.types
```

Run a focused check:

```powershell
rg -n '@\/admin\/' D:\MyFiles\KT\Node\kt-template-online-api\src D:\MyFiles\KT\Node\kt-template-online-api\test
```

Expected: no `@/admin/` imports remain in API source or tests.

- [ ] **Step 5: Rewrite admin module imports**

Update:

```text
D:\MyFiles\KT\Node\kt-template-online-api\src\modules\admin\identity\admin-identity.module.ts
D:\MyFiles\KT\Node\kt-template-online-api\src\modules\admin\platform-config\admin-platform-config.module.ts
```

The module files must import controllers, services, entities, and submodules from `@/modules/admin/**`, not from `@/admin/**`.

- [ ] **Step 6: Update inventory**

Append to `docs/refactor-v3/architecture-convergence-inventory.md`:

```markdown
| Admin/Auth/Platform Config | `src/admin/example` if no active route evidence; empty old admin subdirectories | auth/user/role/menu/dept/component/dict/notice/system-log/timezone moved into `src/modules/admin/**`; duplicate old imports removed | route paths and public DTO class names kept | `rg '@/admin/' src test` returns no source hits; admin focused Jest passes |
```

- [ ] **Step 7: Verify Admin API domain**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand --runTestsByPath test/modules/admin/admin-contract.spec.ts test/admin/auth/admin-password-crypto.service.spec.ts test/admin/admin-menu.service.spec.ts test/admin/dict/dict.service.spec.ts test/admin/notice/admin-notice.controller.spec.ts test/admin/notice/admin-notice.service.spec.ts test/admin/system-log/system-log.controller.spec.ts test/admin/system-log/system-log.service.spec.ts
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit Admin API migration**

Run:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add src/modules/admin test docs/refactor-v3/architecture-convergence-inventory.md
git -C D:\MyFiles\KT\Node\kt-template-online-api add -u src/admin src/modules/admin test
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "refactor: 收敛Admin与平台配置模块"
```

Expected: commit succeeds. `src/admin` may still exist if non-empty from cross-domain imports, but no code should import `@/admin/`.

## Task 3: Blog, WordPress, And Asset Migration And Slimming

**Files:**
- Move: `D:\MyFiles\KT\Node\kt-template-online-api\src\blog\**`
- Move: `D:\MyFiles\KT\Node\kt-template-online-api\src\wordpress\**`
- Move: `D:\MyFiles\KT\Node\kt-template-online-api\src\minio\**`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\blog\blog-content.module.ts`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\wordpress\wordpress-mirror.module.ts`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\asset\asset.module.ts`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\docs\refactor-v3\architecture-convergence-inventory.md`
- Tests: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\blog\blog-module-contract.spec.ts`
- Tests: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\wordpress\wordpress-module-contract.spec.ts`
- Tests: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\asset\asset-module-contract.spec.ts`
- Tests: `D:\MyFiles\KT\Node\kt-template-online-api\test\blog\**`
- Tests: `D:\MyFiles\KT\Node\kt-template-online-api\test\wordpress\wordpress.service.spec.ts`

- [ ] **Step 1: Move Blog files into target subfolders**

Run:

```powershell
$api = 'D:\MyFiles\KT\Node\kt-template-online-api'
New-Item -ItemType Directory -Force -Path "$api\src\modules\blog\contract" | Out-Null
New-Item -ItemType Directory -Force -Path "$api\src\modules\blog\application" | Out-Null
New-Item -ItemType Directory -Force -Path "$api\src\modules\blog\infrastructure\persistence" | Out-Null
git -C $api mv src/blog/*controller.ts src/modules/blog/contract/
git -C $api mv src/blog/*dto.ts src/modules/blog/contract/
git -C $api mv src/blog/*service.ts src/modules/blog/application/
git -C $api mv src/blog/*entity.ts src/modules/blog/infrastructure/persistence/
git -C $api mv src/blog/blog.module.ts src/modules/blog/blog-content.legacy-module.ts
```

Expected: old `src/blog` has no files after the move.

- [ ] **Step 2: Move WordPress files into target subfolders**

Run:

```powershell
$api = 'D:\MyFiles\KT\Node\kt-template-online-api'
New-Item -ItemType Directory -Force -Path "$api\src\modules\wordpress\contract" | Out-Null
New-Item -ItemType Directory -Force -Path "$api\src\modules\wordpress\application" | Out-Null
New-Item -ItemType Directory -Force -Path "$api\src\modules\wordpress\domain" | Out-Null
git -C $api mv src/wordpress/*controller.ts src/modules/wordpress/contract/
git -C $api mv src/wordpress/*dto.ts src/modules/wordpress/contract/
git -C $api mv src/wordpress/*types.ts src/modules/wordpress/domain/
git -C $api mv src/wordpress/*service.ts src/modules/wordpress/application/
git -C $api mv src/wordpress/wordpress.module.ts src/modules/wordpress/wordpress-mirror.legacy-module.ts
```

Expected: old `src/wordpress` has no files after the move.

- [ ] **Step 3: Move MinIO files into Asset module**

Run:

```powershell
$api = 'D:\MyFiles\KT\Node\kt-template-online-api'
New-Item -ItemType Directory -Force -Path "$api\src\modules\asset\contract" | Out-Null
New-Item -ItemType Directory -Force -Path "$api\src\modules\asset\application" | Out-Null
New-Item -ItemType Directory -Force -Path "$api\src\modules\asset\domain" | Out-Null
git -C $api mv src/minio/minio.controller.ts src/modules/asset/contract/asset-minio.controller.ts
git -C $api mv src/minio/minio.dto.ts src/modules/asset/contract/asset-minio.dto.ts
git -C $api mv src/minio/minio.service.ts src/modules/asset/application/asset-minio.service.ts
git -C $api mv src/minio/minio.types.ts src/modules/asset/domain/asset-minio.types.ts
git -C $api mv src/minio/minio.module.ts src/modules/asset/asset-minio.legacy-module.ts
```

Expected: old `src/minio` has no files after the move. Public route decorators may remain `/minio/*`.

- [ ] **Step 4: Update imports for Blog/WordPress/Asset**

Replace imports using these mappings:

```text
@/blog/ -> @/modules/blog/
@/wordpress/ -> @/modules/wordpress/
@/minio/minio.controller -> @/modules/asset/contract/asset-minio.controller
@/minio/minio.dto -> @/modules/asset/contract/asset-minio.dto
@/minio/minio.service -> @/modules/asset/application/asset-minio.service
@/minio/minio.types -> @/modules/asset/domain/asset-minio.types
@/minio/minio.module -> @/modules/asset/asset-minio.legacy-module
```

Run:

```powershell
rg -n '@\/(blog|wordpress|minio)\/' D:\MyFiles\KT\Node\kt-template-online-api\src D:\MyFiles\KT\Node\kt-template-online-api\test
```

Expected: no old Blog, WordPress, or MinIO imports remain.

- [ ] **Step 5: Collapse legacy module wrappers**

Update these module files so they import local target classes directly and do not import the moved `*.legacy-module.ts` wrappers:

```text
D:\MyFiles\KT\Node\kt-template-online-api\src\modules\blog\blog-content.module.ts
D:\MyFiles\KT\Node\kt-template-online-api\src\modules\wordpress\wordpress-mirror.module.ts
D:\MyFiles\KT\Node\kt-template-online-api\src\modules\asset\asset.module.ts
```

After each module imports local controllers/services/entities directly, delete:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api rm src/modules/blog/blog-content.legacy-module.ts
git -C D:\MyFiles\KT\Node\kt-template-online-api rm src/modules/wordpress/wordpress-mirror.legacy-module.ts
git -C D:\MyFiles\KT\Node\kt-template-online-api rm src/modules/asset/asset-minio.legacy-module.ts
```

- [ ] **Step 6: Run slimming scans for Blog/WordPress/Asset**

Run:

```powershell
rg -n 'BlogModule|WordpressModule|MinioClientModule|MinioClientService|MinioUploadFile' D:\MyFiles\KT\Node\kt-template-online-api\src D:\MyFiles\KT\Node\kt-template-online-api\test
rg -n 'blog-content\.legacy|wordpress-mirror\.legacy|asset-minio\.legacy' D:\MyFiles\KT\Node\kt-template-online-api\src D:\MyFiles\KT\Node\kt-template-online-api\test
```

Expected: old module wrapper names have no hits. Public class names may remain only when route behavior or tests depend on them.

- [ ] **Step 7: Update inventory**

Append:

```markdown
| Blog/WordPress/Asset | old `src/blog`, `src/wordpress`, `src/minio`; legacy module wrappers after local imports replaced | MinIO internal files renamed into Asset module; Blog and WordPress controller/service/entity files moved under target modules | existing route decorators and response DTO behavior | `rg '@/blog/|@/wordpress/|@/minio/' src test` has no hits; Blog/WordPress/Asset focused tests pass |
```

- [ ] **Step 8: Verify Blog/WordPress/Asset**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand --runTestsByPath test/modules/blog/blog-module-contract.spec.ts test/modules/wordpress/wordpress-module-contract.spec.ts test/modules/asset/asset-module-contract.spec.ts test/blog/blog-article.service.spec.ts test/blog/blog-term.service.spec.ts test/blog/blog-theme-config.service.spec.ts test/wordpress/wordpress.service.spec.ts
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit Blog/WordPress/Asset migration**

Run:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add src/modules/blog src/modules/wordpress src/modules/asset test docs/refactor-v3/architecture-convergence-inventory.md
git -C D:\MyFiles\KT\Node\kt-template-online-api add -u src/blog src/wordpress src/minio src/modules/blog src/modules/wordpress src/modules/asset test
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "refactor: 收敛Blog WordPress Asset模块"
```

Expected: commit succeeds.

## Task 4: QQBot Core And NapCat Migration And Slimming

**Files:**
- Move: `D:\MyFiles\KT\Node\kt-template-online-api\src\qqbot\account\**`
- Move: `D:\MyFiles\KT\Node\kt-template-online-api\src\qqbot\command\**`
- Move: `D:\MyFiles\KT\Node\kt-template-online-api\src\qqbot\config\**`
- Move: `D:\MyFiles\KT\Node\kt-template-online-api\src\qqbot\connection\**`
- Move: `D:\MyFiles\KT\Node\kt-template-online-api\src\qqbot\dashboard\**`
- Move: `D:\MyFiles\KT\Node\kt-template-online-api\src\qqbot\dedupe\**`
- Move: `D:\MyFiles\KT\Node\kt-template-online-api\src\qqbot\event\**`
- Move: `D:\MyFiles\KT\Node\kt-template-online-api\src\qqbot\message\**`
- Move: `D:\MyFiles\KT\Node\kt-template-online-api\src\qqbot\mqtt\**`
- Move: `D:\MyFiles\KT\Node\kt-template-online-api\src\qqbot\permission\**`
- Move: `D:\MyFiles\KT\Node\kt-template-online-api\src\qqbot\rule\**`
- Move: `D:\MyFiles\KT\Node\kt-template-online-api\src\qqbot\send\**`
- Move: `D:\MyFiles\KT\Node\kt-template-online-api\src\qqbot\napcat\**`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\core\qqbot-core.module.ts`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\napcat\**`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\docs\refactor-v3\architecture-convergence-inventory.md`
- Tests: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\qqbot\core\**`
- Tests: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\qqbot\napcat\**`
- Tests: `D:\MyFiles\KT\Node\kt-template-online-api\test\qqbot\**`

- [ ] **Step 1: Move QQBot core directories**

Run:

```powershell
$api = 'D:\MyFiles\KT\Node\kt-template-online-api'
$core = "$api\src\modules\qqbot\core"
foreach ($name in @('account','command','config','connection','dashboard','dedupe','event','message','mqtt','permission','rule','send')) {
  New-Item -ItemType Directory -Force -Path "$core\$name" | Out-Null
  git -C $api mv "src/qqbot/$name/*" "src/modules/qqbot/core/$name/"
}
New-Item -ItemType Directory -Force -Path "$core\contract" | Out-Null
New-Item -ItemType Directory -Force -Path "$core\domain" | Out-Null
git -C $api mv src/qqbot/qqbot.types.ts src/modules/qqbot/core/contract/qqbot.types.ts
git -C $api mv src/qqbot/qqbot.constants.ts src/modules/qqbot/core/contract/qqbot.constants.ts
git -C $api mv src/qqbot/qqbot-cooldown.policy.ts src/modules/qqbot/core/domain/qqbot-cooldown.policy.ts
```

Expected: core files are under `src/modules/qqbot/core/**`.

- [ ] **Step 2: Move NapCat runtime files**

Run:

```powershell
$api = 'D:\MyFiles\KT\Node\kt-template-online-api'
$napcat = "$api\src\modules\qqbot\napcat"
New-Item -ItemType Directory -Force -Path "$napcat\login" | Out-Null
New-Item -ItemType Directory -Force -Path "$napcat\infrastructure\persistence" | Out-Null
git -C $api mv src/modules/qqbot/core/account/qqbot-napcat-login.service.ts src/modules/qqbot/napcat/login/qqbot-napcat-login.service.ts
git -C $api mv src/modules/qqbot/core/account/qqbot-napcat-watchdog.service.ts src/modules/qqbot/napcat/login/qqbot-napcat-watchdog.service.ts
git -C $api mv src/qqbot/napcat/qqbot-account-napcat.entity.ts src/modules/qqbot/napcat/infrastructure/persistence/qqbot-account-napcat.entity.ts
git -C $api mv src/qqbot/napcat/qqbot-napcat-container.entity.ts src/modules/qqbot/napcat/infrastructure/persistence/qqbot-napcat-container.entity.ts
git -C $api mv src/qqbot/napcat/qqbot-napcat-container.service.ts src/modules/qqbot/napcat/qqbot-napcat-container.service.ts
```

Expected: NapCat files are under `src/modules/qqbot/napcat/**`.

- [ ] **Step 3: Remove old QQBot module wrapper after providers are local**

Update `src/modules/qqbot/core/qqbot-core.module.ts` so it imports from `@/modules/qqbot/core/**` and `@/modules/qqbot/napcat/**`.

Run:

```powershell
rg -n '@\/qqbot\/' D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\core D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\napcat
```

Expected: no hits in core or napcat modules.

After all providers are local, delete old wrapper:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api rm src/qqbot/qqbot.module.ts
```

- [ ] **Step 4: Update source and test imports**

Replace:

```text
@/qqbot/account/ -> @/modules/qqbot/core/account/
@/qqbot/command/ -> @/modules/qqbot/core/command/
@/qqbot/config/ -> @/modules/qqbot/core/config/
@/qqbot/connection/ -> @/modules/qqbot/core/connection/
@/qqbot/dashboard/ -> @/modules/qqbot/core/dashboard/
@/qqbot/dedupe/ -> @/modules/qqbot/core/dedupe/
@/qqbot/event/ -> @/modules/qqbot/core/event/
@/qqbot/message/ -> @/modules/qqbot/core/message/
@/qqbot/mqtt/ -> @/modules/qqbot/core/mqtt/
@/qqbot/permission/ -> @/modules/qqbot/core/permission/
@/qqbot/rule/ -> @/modules/qqbot/core/rule/
@/qqbot/send/ -> @/modules/qqbot/core/send/
@/qqbot/napcat/ -> @/modules/qqbot/napcat/
@/qqbot/qqbot.types -> @/modules/qqbot/core/contract/qqbot.types
@/qqbot/qqbot.constants -> @/modules/qqbot/core/contract/qqbot.constants
@/qqbot/qqbot-cooldown.policy -> @/modules/qqbot/core/domain/qqbot-cooldown.policy
```

Run:

```powershell
rg -n '@\/qqbot\/' D:\MyFiles\KT\Node\kt-template-online-api\src D:\MyFiles\KT\Node\kt-template-online-api\test
```

Expected: only plugin-platform migration leftovers may remain before Task 5; no core or napcat imports should target old roots.

- [ ] **Step 5: Run QQBot core and NapCat slimming scans**

Run:

```powershell
rg -n 'QqbotModule|@\/qqbot\/qqbot\.module|qqbot-napcat-login\.service|qqbot-napcat-watchdog\.service' D:\MyFiles\KT\Node\kt-template-online-api\src D:\MyFiles\KT\Node\kt-template-online-api\test
rg -n 'quick-login|password-login|new-device|CaptchaLogin|GetNewDeviceQRCode|PollNewDeviceQR|NewDeviceLogin' D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\napcat D:\MyFiles\KT\Node\kt-template-online-api\test\modules\qqbot\napcat
```

Expected: old `QqbotModule` has no hits. NapCat login flow terms remain in target module and tests.

- [ ] **Step 6: Update inventory**

Append:

```markdown
| QQBot Core/NapCat | old `src/qqbot/qqbot.module.ts`; old core and napcat roots after moves | account/command/config/connection/dashboard/dedupe/event/message/mqtt/permission/rule/send moved into `src/modules/qqbot/core`; NapCat login/container/persistence moved into `src/modules/qqbot/napcat` | route decorators, command parsing, send queue, device persistence, captcha, new-device, and manual QR semantics | core and NapCat focused Jest pass; `rg '@/qqbot/' src/modules/qqbot/core src/modules/qqbot/napcat` has no hits |
```

- [ ] **Step 7: Verify QQBot core and NapCat**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand --runTestsByPath test/modules/qqbot/core/qqbot-core-module-contract.spec.ts test/modules/qqbot/core/qqbot-core-command-contract.spec.ts test/modules/qqbot/core/qqbot-core-command-smoke.spec.ts test/modules/qqbot/core/qqbot-core-send-contract.spec.ts test/modules/qqbot/core/qqbot-core-status-contract.spec.ts test/modules/qqbot/napcat/device-identity.spec.ts test/modules/qqbot/napcat/login-state-machine.spec.ts test/modules/qqbot/napcat/new-device-flow.spec.ts test/qqbot/connection/qqbot-reverse-ws.service.spec.ts test/qqbot/send/qqbot-send.service.spec.ts test/qqbot/send/qqbot-rate-limit.service.spec.ts test/qqbot/command/qqbot-command-parser.service.spec.ts test/qqbot/account/qqbot-account.service.spec.ts test/qqbot/account/qqbot-napcat-login.service.spec.ts test/qqbot/account/qqbot-napcat-watchdog.service.spec.ts
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit QQBot core and NapCat migration**

Run:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add src/modules/qqbot/core src/modules/qqbot/napcat test docs/refactor-v3/architecture-convergence-inventory.md
git -C D:\MyFiles\KT\Node\kt-template-online-api add -u src/qqbot src/modules/qqbot/core src/modules/qqbot/napcat test
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "refactor: 收敛QQBot核心与NapCat模块"
```

Expected: commit succeeds.

## Task 5: Plugin Platform And Existing Plugin Slimming

**Files:**
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\plugin-platform\**`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\plugins\**`
- Delete: `D:\MyFiles\KT\Node\kt-template-online-api\src\qqbot\plugin\**`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\docs\refactor-v3\architecture-convergence-inventory.md`
- Tests: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\qqbot\plugin-platform\**`
- Tests: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\qqbot\plugins\**`
- Tests: `D:\MyFiles\KT\Node\kt-template-online-api\test\qqbot\plugins\**`

- [ ] **Step 1: Replace old plugin registry imports**

Run:

```powershell
rg -n '@\/qqbot\/plugin|QqbotPluginRegistryService|QqbotEventPluginRegistryService|QqbotIntegrationPlugin' D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot D:\MyFiles\KT\Node\kt-template-online-api\test
```

Expected: hits exist before this task.

Update target code so:

```text
QqbotIntegrationPlugin imports come from `@/modules/qqbot/core/contract/qqbot.types`.
Plugin registry behavior comes from `@/modules/qqbot/plugin-platform/**`.
No target module imports `@/qqbot/plugin/**`.
```

- [ ] **Step 2: Delete old plugin registry root**

After imports are replaced, run:

```powershell
rg -n '@\/qqbot\/plugin|QqbotPluginRegistryService|QqbotEventPluginRegistryService' D:\MyFiles\KT\Node\kt-template-online-api\src D:\MyFiles\KT\Node\kt-template-online-api\test
```

Expected: no hits that require `src/qqbot/plugin/**`.

Then run:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api rm -r src/qqbot/plugin
```

- [ ] **Step 3: Scan existing plugins for full-module slimming**

Run:

```powershell
rg -n 'axios|fetch\(|http\.|@\/admin\/|@\/qqbot\/|legacyKeys|bangDream|ff14Market' D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\plugins
```

Expected:

- Direct HTTP clients in FF14 Market and FFLogs are absent or replaced by host runtime HTTP SDK.
- `@/admin/` and `@/qqbot/` imports are removed.
- `legacyKeys` remain only in plugin metadata objects where external compatibility requires them.
- `bangDream` and `ff14Market` legacy strings remain only in compatibility mappings or tests that prove alias behavior.

- [ ] **Step 4: Remove plugin internal dead buckets**

Create a candidate list from files that contain old-root imports, direct HTTP calls, or legacy aliases:

Run:

```powershell
$api = 'D:\MyFiles\KT\Node\kt-template-online-api'
$candidateFiles = @(
  'src/modules/qqbot/plugins/ff14Market/qqbot-ff14-client.service.ts',
  'src/modules/qqbot/plugins/ff14Market/qqbot-ff14-worlds.ts',
  'src/modules/qqbot/plugins/ff14Market/qqbot-ff14-market.plugin.ts',
  'src/modules/qqbot/plugins/fflogs/qqbot-fflogs-client.service.ts',
  'src/modules/qqbot/plugins/fflogs/qqbot-fflogs.plugin.ts',
  'src/modules/qqbot/plugins/repeater/qqbot-repeater.plugin.ts',
  'src/modules/qqbot/plugins/bangDream/application/bangdream-renderer.facade.ts',
  'src/modules/qqbot/plugins/bangDream/qqbot-bangdream.plugin.ts'
)
foreach ($file in $candidateFiles) {
  $absolute = Join-Path $api $file
  if (Test-Path $absolute) {
    Write-Output "===== $file ====="
    Select-String -Path $absolute -Pattern 'export (class|function|interface|type|const) ' | ForEach-Object { $_.Line.Trim() }
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($file)
    rg -n --fixed-strings $stem "$api\src" "$api\test"
  }
}
```

Delete a candidate file only when this scan shows no live references outside the file itself and no manifest or test depends on it. Keep the file when a manifest, registry, or test references it, then remove only the old import/direct-call line.

Record each deletion or keep decision in the inventory table.

- [ ] **Step 5: Verify plugin platform and plugin behavior**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand --runTestsByPath test/modules/qqbot/plugin-platform/manifest.spec.ts test/modules/qqbot/plugin-platform/cli.spec.ts test/modules/qqbot/plugin-platform/persistence-contract.spec.ts test/modules/qqbot/plugin-platform/plugin-platform-api-contract.spec.ts test/modules/qqbot/plugin-platform/worker-runtime.spec.ts test/modules/qqbot/plugins/plugin-registry-compat.spec.ts test/modules/qqbot/plugins/plugin-platform-migration.spec.ts test/modules/qqbot/plugins/plugin-controller-http-smoke.spec.ts test/qqbot/plugins/ff14Market/qqbot-ff14-worlds.spec.ts test/qqbot/plugins/fflogs/qqbot-fflogs-client.service.spec.ts test/qqbot/plugins/repeater/qqbot-repeater.plugin.spec.ts test/qqbot/plugins/bangDream/registry/operation-registry.spec.ts test/qqbot/plugins/bangDream/registry/command-sql.spec.ts
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
```

Expected: PASS.

- [ ] **Step 6: Update inventory**

Append:

```markdown
| Plugin Platform/Plugins | old `src/qqbot/plugin`; plugin files with no external or test references | registry behavior moved to plugin platform; plugin interfaces moved to target contracts; direct old-root imports removed | plugin manifest, legacy alias compatibility, worker runtime, host HTTP SDK, operation registry, event behavior | plugin platform focused Jest passes; plugin scan has no `@/admin/` or `@/qqbot/` imports |
```

- [ ] **Step 7: Commit plugin migration**

Run:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add src/modules/qqbot/plugin-platform src/modules/qqbot/plugins test docs/refactor-v3/architecture-convergence-inventory.md
git -C D:\MyFiles\KT\Node\kt-template-online-api add -u src/qqbot src/modules/qqbot/plugin-platform src/modules/qqbot/plugins test
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "refactor: 收敛QQBot插件平台与现有插件"
```

Expected: commit succeeds.

## Task 6: Admin Full-Domain Slimming And Caller Boundaries

**Files:**
- Modify: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\api\system\**`
- Modify: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\api\blog\**`
- Modify: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\api\qqbot\**`
- Modify: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\views\system\**`
- Modify: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\views\blog\**`
- Modify: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\views\qqbot\**`
- Create: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\views\qqbot\modules\status.ts`
- Create: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\views\qqbot\modules\actions.tsx`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\docs\refactor-v3\architecture-convergence-inventory.md`
- Test: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\api\qqbot\napcat.spec.ts`

- [ ] **Step 1: Scan Admin callers and pages**

Run:

```powershell
$admin = 'D:\MyFiles\KT\Vue\kt-template-admin'
rg -n 'deprecated|legacy|兼容|旧|废弃|console\.log' "$admin\apps\web-antdv-next\src\api\system" "$admin\apps\web-antdv-next\src\api\blog" "$admin\apps\web-antdv-next\src\api\qqbot" "$admin\apps\web-antdv-next\src\views\system" "$admin\apps\web-antdv-next\src\views\blog" "$admin\apps\web-antdv-next\src\views\qqbot"
rg -n '登录成功|登录失败|需要验证码|新设备|运行态清理失败|online|offline|enabled|disabled|pending' "$admin\apps\web-antdv-next\src\views" "$admin\apps\web-antdv-next\src\api"
```

Expected: scan output identifies duplicated state labels and legacy comments before cleanup.

- [ ] **Step 2: Create shared QQBot status module**

Create `apps/web-antdv-next/src/views/qqbot/modules/status.ts`:

```ts
import type { TagProps } from 'antdv-next';

export const qqbotStatusLabels = {
  disabled: '已禁用',
  enabled: '已启用',
  failed: '失败',
  offline: '离线',
  online: '在线',
  pending: '处理中',
  unknown: '未知',
} as const;

export type QqbotStatusKey = keyof typeof qqbotStatusLabels;

export function getQqbotStatusLabel(status: string | undefined): string {
  if (!status) return qqbotStatusLabels.unknown;
  return qqbotStatusLabels[(status as QqbotStatusKey)] ?? status;
}

export function getQqbotStatusColor(status: string | undefined): TagProps['color'] {
  if (status === 'online' || status === 'enabled') return 'success';
  if (status === 'offline' || status === 'disabled') return 'default';
  if (status === 'failed') return 'error';
  if (status === 'pending') return 'processing';
  return 'default';
}
```

- [ ] **Step 3: Create shared QQBot actions module**

Create `apps/web-antdv-next/src/views/qqbot/modules/actions.tsx`:

```tsx
import { Button, Popconfirm, Space } from 'antdv-next';
import type { Component } from 'vue';

export interface QqbotActionItem {
  danger?: boolean;
  disabled?: boolean;
  icon?: Component;
  key: string;
  label: string;
  loading?: boolean;
  confirmText?: string;
  onClick: () => void | Promise<void>;
}

export function renderQqbotActions(actions: QqbotActionItem[]) {
  return (
    <Space size="small">
      {actions.map((action) => {
        const button = (
          <Button
            danger={action.danger}
            disabled={action.disabled}
            icon={action.icon ? <action.icon /> : undefined}
            loading={action.loading}
            size="small"
            type="link"
            onClick={action.confirmText ? undefined : action.onClick}
          >
            {action.label}
          </Button>
        );

        if (!action.confirmText) return <span key={action.key}>{button}</span>;

        return (
          <Popconfirm
            key={action.key}
            title={action.confirmText}
            onConfirm={action.onClick}
          >
            {button}
          </Popconfirm>
        );
      })}
    </Space>
  );
}
```

- [ ] **Step 4: Replace duplicate QQBot status/action logic**

Update these pages to import `getQqbotStatusLabel`, `getQqbotStatusColor`, or `renderQqbotActions` where they duplicate status tags or action buttons:

```text
apps/web-antdv-next/src/views/qqbot/account/list.tsx
apps/web-antdv-next/src/views/qqbot/command/list.tsx
apps/web-antdv-next/src/views/qqbot/rule/list.tsx
apps/web-antdv-next/src/views/qqbot/message/list.tsx
apps/web-antdv-next/src/views/qqbot/permission/list.tsx
apps/web-antdv-next/src/views/qqbot/plugin/list.tsx
apps/web-antdv-next/src/views/qqbot/sendLog/list.tsx
```

Run:

```powershell
rg -n '登录成功|登录失败|需要验证码|新设备二维码|运行态清理失败' D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\views\qqbot
```

Expected: NapCat-specific progress labels remain in `api/qqbot/napcat.ts` and NapCat UI only; other QQBot pages do not copy these strings.

- [ ] **Step 5: Slim System and Blog/Admin pages**

Run reference scans:

```powershell
$admin = 'D:\MyFiles\KT\Vue\kt-template-admin'
rg -n 'ktTableDemo|clipboard|demo|legacy|deprecated|兼容旧|旧路由' "$admin\apps\web-antdv-next\src\views\system" "$admin\apps\web-antdv-next\src\views\blog" "$admin\apps\web-antdv-next\src\api\system" "$admin\apps\web-antdv-next\src\api\blog"
rg -n 'views/system/ktTableDemo|system/ktTableDemo|ktTableDemo' "$admin\apps\web-antdv-next\src\router" "$admin\apps\web-antdv-next\src\views" "$admin\apps\web-antdv-next\src\api"
```

Expected: if `views/system/ktTableDemo` has no menu/route/test entry, delete it. If a route or menu entry proves it is active, keep it and record the evidence.

Delete inactive demo files only after the scan proves no active entry:

```powershell
git -C D:\MyFiles\KT\Vue\kt-template-admin rm -r apps/web-antdv-next/src/views/system/ktTableDemo
```

- [ ] **Step 6: Keep NapCat helper tests green**

Extend `apps/web-antdv-next/src/api/qqbot/napcat.spec.ts` so it also asserts shared progress labels remain centralized:

```ts
it('keeps new-device labels centralized in the NapCat caller helpers', () => {
  expect(NAPCAT_LOGIN_PROGRESS_LABELS['new-device-required']).toBe(
    '需要新设备验证二维码',
  );
  expect(NAPCAT_LOGIN_PROGRESS_LABELS['new-device-scanned']).toBe(
    '新设备二维码已扫码',
  );
  expect(NAPCAT_LOGIN_PROGRESS_LABELS['new-device-confirming']).toBe(
    '新设备确认中',
  );
});
```

- [ ] **Step 7: Verify Admin**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\Vue\kt-template-admin exec vitest run apps/web-antdv-next/src/api/qqbot/napcat.spec.ts
pnpm --dir D:\MyFiles\KT\Vue\kt-template-admin -F @vben/web-antdv-next run typecheck
```

Expected: PASS.

- [ ] **Step 8: Update inventory**

Append to the API inventory document:

```markdown
| Admin UI | inactive demo pages and no-entry components proven by `rg`; duplicated status/action helpers | QQBot status/action rendering centralized under `views/qqbot/modules`; repeated NapCat progress labels kept in caller helper | System, Blog/WordPress/Asset, QQBot, Plugin, and NapCat visible behavior | Admin Vitest helper test and typecheck pass |
```

- [ ] **Step 9: Commit Admin changes and API inventory**

Run:

```powershell
git -C D:\MyFiles\KT\Vue\kt-template-admin add apps/web-antdv-next/src/api apps/web-antdv-next/src/views
git -C D:\MyFiles\KT\Vue\kt-template-admin commit -m "refactor: 收敛Admin全域管理边界"
git -C D:\MyFiles\KT\Node\kt-template-online-api add docs/refactor-v3/architecture-convergence-inventory.md
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "docs: 记录Admin全域瘦身证据"
```

Expected: two commits succeed, one per repo.

## Task 7: Final Legacy Root Deletion And Green Structure Gate

**Files:**
- Delete: `D:\MyFiles\KT\Node\kt-template-online-api\src\admin`
- Delete: `D:\MyFiles\KT\Node\kt-template-online-api\src\blog`
- Delete: `D:\MyFiles\KT\Node\kt-template-online-api\src\minio`
- Delete: `D:\MyFiles\KT\Node\kt-template-online-api\src\wordpress`
- Delete: `D:\MyFiles\KT\Node\kt-template-online-api\src\qqbot`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\docs\refactor-v3\architecture-convergence-verification.md`
- Modify: `D:\MyFiles\KT\TASKS.md`

- [ ] **Step 1: Prove no old imports remain**

Run:

```powershell
rg -n '@\/(admin|blog|minio|wordpress|qqbot)\/' D:\MyFiles\KT\Node\kt-template-online-api\src D:\MyFiles\KT\Node\kt-template-online-api\test
```

Expected: no hits.

- [ ] **Step 2: Delete remaining empty old roots**

Run:

```powershell
$api = 'D:\MyFiles\KT\Node\kt-template-online-api'
foreach ($root in @('src/admin','src/blog','src/minio','src/wordpress','src/qqbot')) {
  $path = Join-Path $api $root
  if (Test-Path $path) {
    git -C $api rm -r $root
  }
}
```

Expected: any remaining old root path is removed from Git.

- [ ] **Step 3: Run the structure gate green**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand --runTestsByPath test/refactor-v3/architecture-convergence.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Run final API verification**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand
```

Expected: PASS.

- [ ] **Step 5: Run final Admin verification**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\Vue\kt-template-admin exec vitest run apps/web-antdv-next/src/api/qqbot/napcat.spec.ts
pnpm --dir D:\MyFiles\KT\Vue\kt-template-admin -F @vben/web-antdv-next run typecheck
```

Expected: PASS.

- [ ] **Step 6: Run local behavior smoke**

Run API smoke using the existing bounded script:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
```

Then start or reuse the local API only when a real interface smoke is needed. Required smoke evidence:

```text
GET /health/runtime
Admin login and menu load
Blog public list/detail
Asset upload/download/remove through existing MinIO routes
QQBot command test
Plugin validate/install-local/enable/health
NapCat simulated login state machine
```

Expected: every smoke either passes or records a concrete blocker and stable next action. Do not call the work complete with a missing smoke.

- [ ] **Step 7: Write final verification document**

Create `docs/refactor-v3/architecture-convergence-verification.md`:

```markdown
# Architecture Convergence Verification

## Structure

- API old roots: removed.
- Forbidden imports from `src/modules/**` to old roots: zero.
- `src/app.module.ts`: imports target modules only.

## API Verification

- Structure gate: pass.
- Typecheck: pass.
- Jest: pass.
- Local smoke: pass with recorded command evidence.

## Admin Verification

- NapCat helper Vitest: pass.
- Typecheck: pass.
- Page smoke: pass with recorded routes.

## Review

- KT global review: pass.
- Superpowers review: pass.
```

- [ ] **Step 8: Update TASKS**

Update `D:\MyFiles\KT\TASKS.md` with a short record:

```markdown
### 2026-06-15：API/Admin 第三期架构收敛完成

- 范围：`Node/kt-template-online-api`、`Vue/kt-template-admin`、`TASKS.md`。
- 关键词：旧根删除、`src/modules/**` 强门禁、全模块瘦身、Admin 全域边界、结构测试、API/Admin 本地验证。
- 验证：记录结构 gate、API typecheck/Jest、Admin Vitest/typecheck、local smoke、global review、Superpowers review 的最终结果。
```

- [ ] **Step 9: Run review gates**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run global-review -- --contentScanMode changed --includeContentScan true
```

Expected: `findings=[]`.

Use Superpowers requesting-code-review before declaring implementation complete.

- [ ] **Step 10: Commit final verification**

Run:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add src test docs/refactor-v3/architecture-convergence-inventory.md docs/refactor-v3/architecture-convergence-verification.md
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "test: 完成架构收敛验证闭环"
git -C D:\MyFiles\KT add TASKS.md
git -C D:\MyFiles\KT commit -m "docs: 记录架构收敛闭环"
```

Expected: commits succeed and worktrees remain clean.

## Final Completion Gate

Before reporting the goal complete, run:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api status --short --branch
git -C D:\MyFiles\KT\Vue\kt-template-admin status --short --branch
git -C D:\MyFiles\KT status --short --branch
rg --files D:\MyFiles\KT\Node\kt-template-online-api\src\admin D:\MyFiles\KT\Node\kt-template-online-api\src\blog D:\MyFiles\KT\Node\kt-template-online-api\src\minio D:\MyFiles\KT\Node\kt-template-online-api\src\wordpress D:\MyFiles\KT\Node\kt-template-online-api\src\qqbot
rg -n '@\/(admin|blog|minio|wordpress|qqbot)\/' D:\MyFiles\KT\Node\kt-template-online-api\src\modules
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand --runTestsByPath test/refactor-v3/architecture-convergence.spec.ts
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
pnpm --dir D:\MyFiles\KT\Vue\kt-template-admin -F @vben/web-antdv-next run typecheck
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run global-review -- --contentScanMode changed --includeContentScan true
```

Expected:

```text
API/Admin/root status clean.
Old root scan returns no files.
Forbidden import scan returns no hits.
Structure gate passes.
API typecheck passes.
Admin typecheck passes.
global-review findings=[].
```

## Plan Self-Review

### Spec Coverage

| Spec Requirement | Plan Coverage |
| --- | --- |
| Clean worktree before work | Task 0 |
| API old roots deleted | Tasks 1, 2, 3, 4, 5, 7 |
| `src/modules/**` forbidden old imports | Tasks 1 and 7 |
| Admin/Auth/Platform Config migration and slimming | Task 2 |
| Blog/WordPress/Asset migration and slimming | Task 3 |
| QQBot Core and NapCat migration and slimming | Task 4 |
| Plugin Platform and existing plugin slimming | Task 5 |
| Admin full-domain slimming | Task 6 |
| Runtime/Common slimming rule | Task 0 inventory and Task 7 final scan; module-private utilities discovered during Tasks 2-5 are moved back into domains before commit |
| Behavior preservation | Focused Jest, typecheck, local smoke, Admin Vitest/typecheck |
| No meaningless backup artifacts | Execution Rules and commit scopes |
| Documentation and TASKS update | Tasks 0 and 7 |
| KT global review and Superpowers review | Task 7 |

### Placeholder Scan

No deferred placeholder work is allowed. Each task names the files to move or modify, the commands to run, and the expected result. Discovery commands have bounded decision rules: delete only with no-reference evidence, keep only with route/menu/test/manifest evidence.

### Type And Path Consistency

- API paths use `D:\MyFiles\KT\Node\kt-template-online-api`.
- Admin paths use `D:\MyFiles\KT\Vue\kt-template-admin`.
- Old API roots always mean `src/admin`, `src/blog`, `src/minio`, `src/wordpress`, and `src/qqbot`.
- Target API root is always `src/modules/**`.
- Admin route/page smoke remains under `apps/web-antdv-next/src/**`.
