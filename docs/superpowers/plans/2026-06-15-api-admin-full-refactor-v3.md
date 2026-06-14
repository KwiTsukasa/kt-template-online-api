# API/Admin Full Refactor V3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the third-phase API/Admin full-module refactor from the approved design: rebuild schema, migrate all API modules, rebuild the QQBot plugin platform, finish NapCat device/login flow, sync Admin, and close locally before one unified push and online smoke.

**Architecture:** Execute as a batch-gated migration. API owns schema, domain contracts, runtime state, plugin execution, and deployment smoke; Admin follows API contracts in the same batch or the next immediate task. Each batch starts with RED checks, ends with local verification, KT review, Superpowers review, and separate API/Admin commits.

**Tech Stack:** NestJS 11, TypeORM 0.3, MySQL, pnpm 9 API workspace, Vben Admin 5 / Vue 3 / TSX / Ant Design Vue, pnpm 10 Admin workspace, Jest, Playwright, ktWorkflow MCP, Jenkins/K8s/NapCat runtime.

---

## Scope Check

The approved spec spans several independent subsystems: database rebuild, API module migration, Admin contract sync, plugin runtime, existing plugin rewrite, NapCat runtime, and online release. Keep one master plan so the third-phase goal stays intact, but execute it as batch-gated work. Do not merge two batches into one commit window.

Every batch must leave the product in a locally verifiable state. Batch 8 is the only push/deploy batch.

## Current State Evidence

- API repo: `D:\MyFiles\KT\Node\kt-template-online-api`, implementation branch `dev-api-full-refactor-v3`, package manager `pnpm@9.15.9`, no `.node-version`, no `engines`.
- Admin repo: `D:\MyFiles\KT\Vue\kt-template-admin`, implementation branch `dev-admin-full-refactor-v3`, package manager `pnpm@10.28.2`, `.node-version=22.22.0`, `engines.node >=20.19.0`, `engines.pnpm >=10.0.0`.
- Admin repo has three old dirty files authorized by the user to discard during implementation preparation:
  - `README.md`
  - `apps/web-antdv-next/src/api/qqbot/index.ts`
  - `apps/web-antdv-next/src/views/qqbot/account/list.tsx`
- API existing top-level source roots: `src/admin`, `src/blog`, `src/common`, `src/middleware`, `src/minio`, `src/qqbot`, `src/runtime`, `src/wordpress`.
- API existing SQL roots: `sql/vben-admin-init.sql`, `sql/blog-init.sql`, `sql/blog-menu.sql`, `sql/qqbot-init.sql`, plus migration/fix scripts.
- Admin existing app root: `apps/web-antdv-next/src`, with `api`, `views`, `router`, `components`, `store`, `locales`.

## Execution Rules

- Use `apply_patch` for manual file edits.
- Do not push before Batch 8.
- Do not run destructive DB commands until Batch 8 and user confirms the action window.
- Do not treat Jenkins/K8s success as functional success.
- For API interface changes, run a real local request or a bounded smoke script.
- For Admin page changes, run a route/page smoke with browser evidence.
- If a local Node/Vite service is started, clean the process before ending the work turn.
- If a recurring blocker appears twice, record the stable solution before a third raw attempt.

## File Structure Map

### API Files To Create

| Path | Responsibility |
| --- | --- |
| `docs/refactor-v3/schema-map.md` | Batch 0 full schema ownership map. |
| `docs/refactor-v3/api-admin-contract-matrix.md` | API route, DTO, SSE, and Admin caller/page matrix. |
| `docs/refactor-v3/breaking-changes.md` | Approved route, DTO, schema, seed, and Admin contract breaks. |
| `docs/refactor-v3/rebuild-runbook.md` | Local dry run, online backup, schema rebuild, smoke, and rollback runbook. |
| `sql/refactor-v3/00-full-schema.sql` | Full new schema, no historical patch accumulation. |
| `sql/refactor-v3/01-seed-core.sql` | Initial seed for Admin, menus, platform settings, QQBot core, and plugin metadata. |
| `sql/refactor-v3/99-verify.sql` | SQL checks that prove required tables, seed rows, and indexes exist. |
| `scripts/refactor-v3/db-dry-run.ps1` | Local empty DB rebuild smoke wrapper. |
| `scripts/refactor-v3/db-backup-online.ps1` | Online backup command wrapper without secrets. |
| `scripts/refactor-v3/db-restore-online.ps1` | Online rollback wrapper without secrets. |
| `scripts/refactor-v3/local-smoke.ps1` | Bounded local smoke entry for API contract checks. |
| `src/modules/admin/**` | New Admin/Auth/Platform Config module. |
| `src/modules/blog/**` | New Blog content module. |
| `src/modules/wordpress/**` | New WordPress mirror/sync module. |
| `src/modules/asset/**` | New Asset/MinIO ownership module. |
| `src/modules/qqbot/core/**` | New QQBot account, command, message, permission, send queue core. |
| `src/modules/qqbot/plugin-platform/**` | Manifest, registry, CLI, worker runtime, RPC, installation lifecycle. |
| `src/modules/qqbot/plugins/**` | Rewritten BangDream, FF14 Market, FFLogs, Repeater plugin packages. |
| `src/modules/qqbot/napcat/**` | NapCat container, device identity, login session, challenge, cleanup runtime. |
| `test/refactor-v3/**` | Cross-batch schema, contract, smoke, and release guard tests. |
| `test/modules/**` | New module-scoped tests matching `src/modules/**`. |

### API Files To Modify

| Path | Responsibility |
| --- | --- |
| `src/app.module.ts` | Replace legacy module imports with new `src/modules/**` modules when each batch is ready. |
| `src/runtime/**` | Keep `/health/runtime` stable, add runtime clients/adapters needed by modules. |
| `src/common/**` | Keep only shared response, error, time, Snowflake, logger, decorator helpers. |
| `src/admin/**` | Legacy module removed after Batch 2 compatibility tests pass. |
| `src/blog/**` | Legacy module removed after Batch 3 compatibility tests pass. |
| `src/wordpress/**` | Legacy module removed after Batch 3 compatibility tests pass. |
| `src/minio/**` | Replaced by `src/modules/asset/**` after Batch 3. |
| `src/qqbot/**` | Legacy core/plugin/NapCat modules removed after Batches 4-7. |
| `API.md` | API contract changes and breaking changes summary. |
| `README.md` | Refactor/development command entry updates. |

### Admin Files To Create Or Modify

| Path | Responsibility |
| --- | --- |
| `apps/web-antdv-next/src/api/system/*.ts` | Sync Admin/Auth/Platform Config API contracts. |
| `apps/web-antdv-next/src/api/blog/*.ts` | Sync Blog/WordPress/Asset API contracts. |
| `apps/web-antdv-next/src/api/qqbot/index.ts` | Replace old QQBot API types and callers. |
| `apps/web-antdv-next/src/api/qqbot/plugin.ts` | Plugin platform API caller. |
| `apps/web-antdv-next/src/api/qqbot/napcat.ts` | NapCat login/device/SSE caller. |
| `apps/web-antdv-next/src/views/system/**` | Identity, menu, role, dept, dict, setting, notice pages. |
| `apps/web-antdv-next/src/views/blog/**` | Blog, WordPress, Asset management pages. |
| `apps/web-antdv-next/src/views/qqbot/**` | QQBot account, command, rule, message, send queue, plugin, NapCat pages. |
| `apps/web-antdv-next/src/router/routes/modules/system.ts` | Menu route sync if frontend routes change. |
| `apps/web-antdv-next/src/router/routes/modules/blog.ts` | Blog route sync. |
| `apps/web-antdv-next/src/router/routes/modules/qqbot.ts` | QQBot/plugin/NapCat route sync. |
| `apps/web-antdv-next/src/locales/langs/zh-CN/system.json` | Visible Chinese labels for new states and pages. |

## Batch 0: Workspace And Migration Preparation

### Task 0.1: Prepare API branch

**Files:**
- No file edits in this task.

- [x] **Step 1: Verify API worktree is clean**

Run:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api status --short --branch
```

Expected:

```text
## main...origin/main [ahead 3]
```

- [x] **Step 2: Create API implementation branch**

Run:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api switch -c dev-api-full-refactor-v3
```

Expected:

```text
Switched to a new branch 'dev-api-full-refactor-v3'
```

- [x] **Step 3: Confirm branch**

Run:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api branch --show-current
```

Expected:

```text
dev-api-full-refactor-v3
```

Actual note: `dev/api-full-refactor-v3` could not be created because the API repository already has a local `dev` branch, so Git cannot create a nested ref under `refs/heads/dev`. The implementation branch is `dev-api-full-refactor-v3` to preserve the existing `dev` branch.

### Task 0.2: Clean authorized Admin old artifacts and prepare branch

**Files:**
- Restore only:
  - `D:\MyFiles\KT\Vue\kt-template-admin\README.md`
  - `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\api\qqbot\index.ts`
  - `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\views\qqbot\account\list.tsx`

- [x] **Step 1: Verify Admin dirty set is exactly authorized**

Run:

```powershell
git -C D:\MyFiles\KT\Vue\kt-template-admin status --short
```

Expected:

```text
 M README.md
 M apps/web-antdv-next/src/api/qqbot/index.ts
 M apps/web-antdv-next/src/views/qqbot/account/list.tsx
```

- [x] **Step 2: Stop if any extra path appears**

If the output contains another path, stop and ask the user before cleanup.

- [x] **Step 3: Restore authorized old files**

Run:

```powershell
git -C D:\MyFiles\KT\Vue\kt-template-admin restore -- README.md apps/web-antdv-next/src/api/qqbot/index.ts apps/web-antdv-next/src/views/qqbot/account/list.tsx
```

Expected: command exits `0`.

- [x] **Step 4: Confirm Admin worktree is clean**

Run:

```powershell
git -C D:\MyFiles\KT\Vue\kt-template-admin status --short --branch
```

Expected:

```text
## main...origin/main
```

- [x] **Step 5: Create Admin implementation branch**

Run:

```powershell
git -C D:\MyFiles\KT\Vue\kt-template-admin switch -c dev-admin-full-refactor-v3
```

Expected:

```text
Switched to a new branch 'dev-admin-full-refactor-v3'
```

### Task 0.3: Create migration control documents

**Files:**
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\docs\refactor-v3\schema-map.md`
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\docs\refactor-v3\api-admin-contract-matrix.md`
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\docs\refactor-v3\breaking-changes.md`
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\docs\refactor-v3\rebuild-runbook.md`

- [x] **Step 1: Add `schema-map.md`**

Use this content:

```markdown
# Refactor V3 Schema Map

## Global Rules

- Primary keys are Snowflake `BIGINT`; API/Admin boundary treats IDs as strings.
- Table names use lower snake case.
- Queryable values are structured columns, not JSON-only fields.
- Event/log tables are append-only and have retention strategy.
- New schema is full initialization SQL, not historical `ALTER TABLE` patches.

## Domains

| Domain | Tables | Owner Batch | Notes |
| --- | --- | --- | --- |
| Admin Identity | `admin_user`, `admin_role`, `admin_permission`, `admin_menu`, `admin_department`, `admin_user_role`, `admin_role_permission`, `admin_role_menu` | Batch 2 | Login, menu, role, permission, department. |
| Platform Config | `platform_dict_group`, `platform_dict_item`, `platform_component_template`, `platform_setting` | Batch 2 | Dict and component template split from legacy Admin misc. |
| Blog Content | `blog_post`, `blog_taxonomy`, `blog_term`, `blog_post_term`, `blog_theme_profile`, `blog_import_job` | Batch 3 | Categories and tags use relation table. |
| WordPress Mirror | `wordpress_site`, `wordpress_auth_session`, `wordpress_remote_post`, `wordpress_remote_term`, `wordpress_sync_job`, `wordpress_sync_mapping` | Batch 3 | Remote state separate from local Blog content. |
| Asset | `asset_bucket`, `asset_object`, `asset_reference`, `asset_access_grant` | Batch 3 | MinIO object ownership and access grant. |
| System Event | `system_notice`, `system_event`, `system_event_dedupe`, `system_event_delivery` | Batch 2 | MySQL stores actionable events; Loki remains log query source. |
| Runtime Evidence | `runtime_evidence_index` | Batch 1 | Safe index only, no large logs or secrets. |
| QQBot Core | `qqbot_account`, `qqbot_connection_session`, `qqbot_capability_binding`, `qqbot_permission_policy`, `qqbot_command`, `qqbot_command_alias`, `qqbot_rule`, `qqbot_conversation`, `qqbot_message`, `qqbot_send_task`, `qqbot_send_log`, `qqbot_dedupe_event` | Batch 4 | Account, connection, permission, command, message, send queue. |
| NapCat Runtime | `napcat_container`, `napcat_device_identity`, `napcat_account_binding`, `napcat_login_session`, `napcat_login_challenge`, `napcat_runtime_cleanup` | Batch 7 | Device identity and login challenge state. |
| QQBot Plugin Platform | `qqbot_plugin`, `qqbot_plugin_version`, `qqbot_plugin_installation`, `qqbot_plugin_operation`, `qqbot_plugin_event_handler`, `qqbot_plugin_account_binding`, `qqbot_plugin_config`, `qqbot_plugin_asset`, `qqbot_plugin_runtime_event` | Batch 5 | Manifest, install lifecycle, runtime health, bindings. |
| Plugin-Owned Data | plugin namespace tables | Batch 6 | Table names start with registered plugin namespace. |
```

- [x] **Step 2: Add `api-admin-contract-matrix.md`**

Use this content:

```markdown
# API/Admin Contract Matrix

| Batch | API Contract | Admin Surface | Smoke Evidence |
| --- | --- | --- | --- |
| 1 | `GET /health/runtime` plain JSON, runtime adapter internals | Runtime status remains available | `curl http://localhost:<port>/health/runtime` |
| 2 | `/auth/*`, `/admin/user/*`, `/admin/menu/*`, `/admin/role/*`, `/admin/dept/*`, `/admin/dict/*`, `/admin/notice/*` | Login, menu, system pages | Login request, menu load, route render |
| 3 | `/blog/*`, `/wordpress/*`, `/asset/*` | Blog, WordPress, Asset pages | Public blog request, Admin list request, asset upload smoke |
| 4 | `/qqbot/account/*`, `/qqbot/command/*`, `/qqbot/rule/*`, `/qqbot/message/*`, `/qqbot/send/*` | QQBot core pages | `/qqbot/command/test` local request |
| 5 | `/qqbot/plugin-platform/*` | Plugin upload/install/enable/config/health pages | local test plugin install and enable |
| 6 | plugin operations exposed through QQBot command/event routing | Existing plugin pages and operation views | BangDream, FF14, FFLogs, Repeater smoke |
| 7 | `/qqbot/napcat/*`, login SSE events | NapCat device/login progress pages | simulated captcha and new-device session |
| 8 | public deployed URLs | deployed Admin | online smoke bundle |
```

- [x] **Step 3: Add `breaking-changes.md`**

Use this content:

```markdown
# Refactor V3 Breaking Changes

## Approved

| Area | Change | Reason | First Batch |
| --- | --- | --- | --- |
| Database | Rebuild all API-owned tables from new full schema | Current data is not important and old schema blocks clean module ownership | Batch 0 |
| SQL init | Replace historical patch scripts with `sql/refactor-v3/*` | Avoid accumulated `ALTER TABLE` history | Batch 0 |
| Admin QQBot API types | Replace old QQBot caller types with new contract | New QQBot Core, Plugin Platform, and NapCat state model | Batch 4 |

## Protected Behavior

- Admin login succeeds.
- Admin menu loads.
- Vben success/error wrappers remain stable for Admin APIs.
- `/health/runtime` remains plain JSON.
- Blog public list/detail remain available.
- QQBot command test remains available.
- QQBot status keeps OneBot, container, WebUI, and QQ login state separate.
- NapCat cleanup failure blocks success.
```

- [x] **Step 4: Add `rebuild-runbook.md`**

Use this content:

```markdown
# Refactor V3 Rebuild Runbook

## Local Dry Run

1. Create an empty local database dedicated to refactor V3.
2. Apply `sql/refactor-v3/00-full-schema.sql`.
3. Apply `sql/refactor-v3/01-seed-core.sql`.
4. Run `sql/refactor-v3/99-verify.sql`.
5. Start API against the dry-run database.
6. Run `scripts/refactor-v3/local-smoke.ps1`.

## Online Backup

1. Confirm the exact API image tag and current database name.
2. Run `scripts/refactor-v3/db-backup-online.ps1`.
3. Record backup path, timestamp, source database, and restore command.

## Online Rebuild

1. Stop or limit API write traffic.
2. Apply full schema and seed scripts.
3. Run verify SQL.
4. Deploy API/Admin image versions bound to this schema.
5. Run online smoke bundle.

## Rollback

1. Stop write traffic.
2. Restore the recorded backup or previous schema bundle.
3. Roll back API/Admin images.
4. Re-run smoke for the restored version.
```

- [x] **Step 5: Verify docs exist**

Run:

```powershell
Test-Path D:\MyFiles\KT\Node\kt-template-online-api\docs\refactor-v3\schema-map.md
Test-Path D:\MyFiles\KT\Node\kt-template-online-api\docs\refactor-v3\api-admin-contract-matrix.md
Test-Path D:\MyFiles\KT\Node\kt-template-online-api\docs\refactor-v3\breaking-changes.md
Test-Path D:\MyFiles\KT\Node\kt-template-online-api\docs\refactor-v3\rebuild-runbook.md
```

Expected:

```text
True
True
True
True
```

### Task 0.4: Add schema skeleton and RED schema test

**Files:**
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\sql\refactor-v3\00-full-schema.sql`
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\sql\refactor-v3\01-seed-core.sql`
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\sql\refactor-v3\99-verify.sql`
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\test\refactor-v3\schema-map.spec.ts`

- [x] **Step 1: Write failing schema test**

Create `test/refactor-v3/schema-map.spec.ts`:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..');

const requiredTables = [
  'admin_user',
  'admin_role',
  'admin_permission',
  'admin_menu',
  'admin_department',
  'platform_dict_group',
  'platform_dict_item',
  'blog_post',
  'blog_taxonomy',
  'blog_term',
  'wordpress_site',
  'asset_object',
  'system_notice',
  'runtime_evidence_index',
  'qqbot_account',
  'qqbot_command',
  'qqbot_send_task',
  'qqbot_plugin',
  'qqbot_plugin_installation',
  'qqbot_plugin_runtime_event',
  'napcat_device_identity',
  'napcat_login_session',
  'napcat_login_challenge',
];

describe('refactor v3 schema skeleton', () => {
  it('declares every required table in the full schema file', () => {
    const sql = readFileSync(
      join(root, 'sql/refactor-v3/00-full-schema.sql'),
      'utf8',
    );

    for (const table of requiredTables) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it('declares core seed and verification scripts', () => {
    const seed = readFileSync(
      join(root, 'sql/refactor-v3/01-seed-core.sql'),
      'utf8',
    );
    const verify = readFileSync(
      join(root, 'sql/refactor-v3/99-verify.sql'),
      'utf8',
    );

    expect(seed).toContain('INSERT INTO admin_user');
    expect(seed).toContain('INSERT INTO qqbot_command');
    expect(seed).toContain('INSERT INTO qqbot_plugin');
    expect(verify).toContain('admin_user');
    expect(verify).toContain('qqbot_command');
    expect(verify).toContain('qqbot_plugin');
    expect(verify).toContain('napcat_device_identity');
  });
});
```

- [x] **Step 2: Run RED check**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand --runTestsByPath test/refactor-v3/schema-map.spec.ts
```

Expected: FAIL because `sql/refactor-v3/00-full-schema.sql` does not exist.

- [x] **Step 3: Add minimal SQL skeleton**

Create the three SQL files with table declarations, seed markers, and verify markers. Use full table definitions before ending Batch 0; the initial minimal version only makes the RED check meaningful.

- [x] **Step 4: Run GREEN check**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand --runTestsByPath test/refactor-v3/schema-map.spec.ts
```

Expected: PASS.

### Task 0.5: Add DB dry-run wrappers

**Files:**
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\scripts\refactor-v3\db-dry-run.ps1`
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\scripts\refactor-v3\db-backup-online.ps1`
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\scripts\refactor-v3\db-restore-online.ps1`
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\scripts\refactor-v3\local-smoke.ps1`

- [x] **Step 1: Add dry-run script**

Create `db-dry-run.ps1`:

```powershell
param(
  [Parameter(Mandatory=$true)][string]$Database,
  [string]$HostName = "127.0.0.1",
  [int]$Port = 3306,
  [string]$User = "root"
)

$ErrorActionPreference = "Stop"
if ($Database -notmatch '^[A-Za-z0-9_]+$') {
  throw "Database must match ^[A-Za-z0-9_]+$"
}

$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$schema = Join-Path $root "sql\refactor-v3\00-full-schema.sql"
$seed = Join-Path $root "sql\refactor-v3\01-seed-core.sql"
$verify = Join-Path $root "sql\refactor-v3\99-verify.sql"

function Invoke-MysqlSource {
  param(
    [Parameter(Mandatory = $true)][string]$Path
  )

  $sourcePath = (Resolve-Path -LiteralPath $Path).Path.Replace("\", "/")
  mysql -h $HostName -P $Port -u $User $Database --execute="source $sourcePath"
}

mysql -h $HostName -P $Port -u $User -e "DROP DATABASE IF EXISTS ``$Database``; CREATE DATABASE ``$Database`` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
Invoke-MysqlSource -Path $schema
Invoke-MysqlSource -Path $seed
Invoke-MysqlSource -Path $verify
```

- [x] **Step 2: Add online backup script**

Create `db-backup-online.ps1`:

```powershell
param(
  [Parameter(Mandatory=$true)][string]$Database,
  [Parameter(Mandatory=$true)][string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
if ($Database -notmatch '^[A-Za-z0-9_]+$') {
  throw "Database must match ^[A-Za-z0-9_]+$"
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$target = Join-Path $OutputDirectory "$Database-refactor-v3-$stamp.sql"
mysqldump --set-gtid-purged=OFF --single-transaction --routines --triggers --default-character-set=utf8mb4 "--result-file=$target" $Database
Write-Output $target
```

- [x] **Step 3: Add restore script**

Create `db-restore-online.ps1`:

```powershell
param(
  [Parameter(Mandatory=$true)][string]$Database,
  [Parameter(Mandatory=$true)][string]$BackupFile
)

$ErrorActionPreference = "Stop"
if ($Database -notmatch '^[A-Za-z0-9_]+$') {
  throw "Database must match ^[A-Za-z0-9_]+$"
}
if (-not (Test-Path -LiteralPath $BackupFile -PathType Leaf)) {
  throw "BackupFile does not exist"
}

$sourcePath = (Resolve-Path -LiteralPath $BackupFile).Path.Replace("\", "/")
mysql -e "DROP DATABASE IF EXISTS ``$Database``; CREATE DATABASE ``$Database`` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql --default-character-set=utf8mb4 $Database --execute="source $sourcePath"
```

- [x] **Step 4: Add local smoke script**

Create `local-smoke.ps1`:

```powershell
param(
  [string]$BaseUrl = "http://127.0.0.1:5320"
)

$ErrorActionPreference = "Stop"
$runtime = Invoke-RestMethod -Method Get -Uri "$BaseUrl/health/runtime" -TimeoutSec 10
if (-not $runtime.service) {
  throw "Runtime health response did not include service"
}
Write-Output "runtime.service=$($runtime.service)"
```

- [x] **Step 5: Validate scripts parse**

Run:

```powershell
powershell -NoProfile -Command '$null = [scriptblock]::Create((Get-Content -Raw -LiteralPath "D:\MyFiles\KT\Node\kt-template-online-api\scripts\refactor-v3\db-dry-run.ps1")); "ok"'
powershell -NoProfile -Command '$null = [scriptblock]::Create((Get-Content -Raw -LiteralPath "D:\MyFiles\KT\Node\kt-template-online-api\scripts\refactor-v3\local-smoke.ps1")); "ok"'
powershell -NoProfile -Command '$null = [scriptblock]::Create((Get-Content -Raw -LiteralPath "D:\MyFiles\KT\Node\kt-template-online-api\scripts\refactor-v3\db-backup-online.ps1")); "ok"'
powershell -NoProfile -Command '$null = [scriptblock]::Create((Get-Content -Raw -LiteralPath "D:\MyFiles\KT\Node\kt-template-online-api\scripts\refactor-v3\db-restore-online.ps1")); "ok"'
```

Expected:

```text
ok
ok
ok
ok
```

### Task 0.6: Batch 0 verification and commits

**Files:**
- Modify: `D:\MyFiles\KT\TASKS.md`
- API commit includes only Batch 0 API files.
- Root commit includes only `TASKS.md`.

- [ ] **Step 1: Run API Batch 0 checks**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand --runTestsByPath test/refactor-v3/schema-map.spec.ts
git -C D:\MyFiles\KT\Node\kt-template-online-api diff --check
```

Expected: Jest PASS and diff check exits `0`.

- [ ] **Step 2: Run doc sync**

Run MCP tool:

```text
kt_change_doc_sync(project=api, taskType=docs)
```

Expected: all required docs are updated or explicitly reported as not needed.

- [ ] **Step 3: Run KT global review**

Run MCP tool:

```text
kt_global_code_review(projects=["api","root"], contentScanMode="changed", includeContentScan=true)
```

Expected: `findings=[]`.

- [ ] **Step 4: Commit API Batch 0**

Run:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add docs/refactor-v3 sql/refactor-v3 scripts/refactor-v3 test/refactor-v3
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "chore: 准备第三期迁移脚手架"
```

- [ ] **Step 5: Commit TASKS record**

Run:

```powershell
git -C D:\MyFiles\KT add TASKS.md
git -C D:\MyFiles\KT commit -m "docs: 记录第三期迁移准备"
```

## Batch 1: Runtime/Common Foundation

### Task 1.1: Add runtime adapter contracts

**Files:**
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\src\runtime\client\runtime-http-client.types.ts`
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\src\runtime\client\runtime-process-client.types.ts`
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\src\runtime\client\runtime-docker-client.types.ts`
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\test\runtime\runtime-client-contract.spec.ts`

- [x] **Step 1: Write RED contract test**

Test expectations:

```ts
describe('runtime client contracts', () => {
  it('uses explicit timeout and redaction fields for external calls', () => {
    const request = {
      url: 'https://example.invalid',
      method: 'GET' as const,
      timeoutMs: 1000,
      redactHeaders: ['authorization'],
    };

    expect(request.timeoutMs).toBeGreaterThan(0);
    expect(request.redactHeaders).toContain('authorization');
  });
});
```

- [x] **Step 2: Create type files**

Define request/response types for HTTP, process, and Docker calls. Each request type includes `timeoutMs`, `correlationId`, and `safeSummary`.

- [x] **Step 3: Export contracts**

Modify `src/runtime/index.ts` to export the new client contract types.

- [x] **Step 4: Verify**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand --runTestsByPath test/runtime/runtime-client-contract.spec.ts test/runtime/runtime-health.service.spec.ts test/runtime/runtime-health.controller.spec.ts
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
```

Expected: PASS.

### Task 1.2: Keep common narrow and stable

**Files:**
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\src\common\index.ts`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\src\common\common.module.ts`
- Test: existing `test/common/*.spec.ts`

- [x] **Step 1: List exported common symbols**

Run:

```powershell
Get-Content D:\MyFiles\KT\Node\kt-template-online-api\src\common\index.ts
```

- [x] **Step 2: Remove only exports made obsolete by new runtime contracts**

Keep response wrappers, filters, interceptors, time decorators, Snowflake, logger config, and generic tools.

Actual note: no runtime client or now-obsolete export was present in `src/common/index.ts` or `src/common/common.module.ts`, so Common stayed unchanged to avoid artificial churn.

- [x] **Step 3: Verify common tests**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand --runTestsByPath test/common/tool.service.spec.ts test/common/swagger-response.spec.ts test/common/kt-date-time.decorator.spec.ts test/common/api-request-log.interceptor.spec.ts
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
```

Expected: PASS.

### Task 1.3: Commit Batch 1

**Files:**
- Modify: `D:\MyFiles\KT\TASKS.md`
- API and root commits.

- [x] **Step 1: Run Batch 1 review gates**

Run MCP tools:

```text
kt_change_doc_sync(project=api, taskType=refactor)
kt_global_code_review(projects=["api","root"], contentScanMode="changed", includeContentScan=true)
```

Expected: required docs resolved and `findings=[]`.

- [x] **Step 2: Commit**

Run:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add src/runtime src/common test/runtime test/common docs/refactor-v3
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "refactor: 重整运行时与通用基础层"
git -C D:\MyFiles\KT add TASKS.md
git -C D:\MyFiles\KT commit -m "docs: 记录第三期基础层迁移"
```

## Batch 2: Admin/Auth/Platform Config

Reusable guardrail for later module batches: route contract tests must prove both
decorator route compatibility and module graph reachability. If a route remains
available through an imported legacy module, assert the importing module metadata
and assert that the imported controller is not also registered directly.

### Task 2.1: Build new Admin module boundary

**Files:**
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\admin\admin.module.ts`
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\admin\identity\**`
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\admin\platform-config\**`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\src\app.module.ts`
- Test: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\admin\admin-contract.spec.ts`

- [x] **Step 1: Write RED route compatibility test**

Create assertions for login, menu, user, role, dept, dict, notice controller paths using `test/helpers/controller-route.helper.ts`.

- [x] **Step 2: Create module shell**

Create `src/modules/admin/admin.module.ts` with controllers and providers grouped by `identity` and `platform-config`.

- [x] **Step 3: Move one domain at a time**

Move identity first, then menu/permission, then dict/component/notice. After each move, run the related Jest file.

Actual: Batch 2 kept legacy `src/admin/**` files in place and created the new shell boundary by grouping identity and platform-config controllers/providers. Dict and notice remain reachable through imported legacy modules to avoid duplicate controller registration.

- [x] **Step 4: Verify**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand --runTestsByPath test/admin/auth/admin-password-crypto.service.spec.ts test/admin/admin-menu.service.spec.ts test/admin/dict/dict.service.spec.ts test/admin/notice/admin-notice.service.spec.ts test/modules/admin/admin-contract.spec.ts
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
```

Expected: PASS.

### Task 2.2: Sync Admin frontend system callers and pages

**Files:**
- Modify: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\api\core\auth.ts`
- Modify: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\api\core\menu.ts`
- Modify: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\api\system\*.ts`
- Modify: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\views\system\**`

- [x] **Step 1: Update API types to string IDs**

All ID fields crossing the API boundary use `string`.

Actual: no Admin frontend edit was needed. The targeted `core` and `system` API wrappers already use string IDs for user, role, menu, dept, dict, and notice contracts; the only `id: number` scan hit is the local `SystemKtTableDemo` demo row type, not a backend contract.

- [x] **Step 2: Ensure route page roots are stable**

Every changed route page has a single stable root element.

Actual: targeted system pages already use a single `Page` root, with modal/drawer children inside the page root.

- [x] **Step 3: Verify Admin typecheck**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\Vue\kt-template-admin -F @vben/web-antdv-next run typecheck
```

Expected: PASS.

- [x] **Step 4: Run local login/menu smoke**

Start API and Admin only for this smoke. Save evidence under `.kt-workspace/test-artifacts/admin-system/<date>/`.

Actual: because Admin frontend had no code diff in this batch, full dev-server login was not started. The interface smoke used a local Nest TestingModule HTTP server with real Admin boundary controllers from `ADMIN_IDENTITY_CONTROLLERS` and `ADMIN_PLATFORM_CONFIG_CONTROLLERS`, then called `GET /auth/password-public-key`, `GET /menu/all`, `GET /dict/codes`, and `GET /system/notice/list` successfully.

### Task 2.3: Commit Batch 2

Run:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add src/modules/admin src/app.module.ts test/modules/admin sql/refactor-v3 docs/refactor-v3
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "refactor: 迁移后台身份权限与平台配置"
git -C D:\MyFiles\KT\Vue\kt-template-admin add apps/web-antdv-next/src/api/core apps/web-antdv-next/src/api/system apps/web-antdv-next/src/views/system apps/web-antdv-next/src/router
git -C D:\MyFiles\KT\Vue\kt-template-admin commit -m "refactor: 同步后台系统管理契约"
git -C D:\MyFiles\KT add TASKS.md
git -C D:\MyFiles\KT commit -m "docs: 记录第三期系统管理迁移"
```

Actual: Admin repo remained clean after Task 2.2 verification, so Batch 2 creates no Admin commit.

## Batch 3: Blog/WordPress/Asset

### Task 3.1: Build Blog, WordPress, and Asset modules

**Files:**
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\blog\**`
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\wordpress\**`
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\asset\**`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\src\app.module.ts`
- Test: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\blog\**`
- Test: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\wordpress\**`
- Test: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\asset\**`

- [x] **Step 1: Write RED tests for public Blog behavior**

Cover article list, article detail, term relation, and theme profile.

- [x] **Step 2: Write RED tests for WordPress mapping**

Cover remote ID to local post/term mapping and sync job state.

- [x] **Step 3: Write RED tests for Asset ownership**

Cover object owner module, MIME metadata, reference, and access grant.

- [x] **Step 4: Implement modules**

Keep route compatibility for public Blog endpoints and Admin-facing endpoints. Move MinIO ownership out of legacy `src/minio` into `src/modules/asset`.

- [x] **Step 5: Verify**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand --runTestsByPath test/blog/blog-article.service.spec.ts test/blog/blog-term.service.spec.ts test/wordpress/wordpress.service.spec.ts test/modules/blog test/modules/wordpress test/modules/asset
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
```

Expected: PASS.

Actual note: Batch 3 moved API ownership to transitional `BlogContentModule`, `WordpressMirrorModule`, and `AssetModule` boundaries while retaining legacy business internals behind imported modules for compatibility. Contract tests now parse `sql/refactor-v3/00-full-schema.sql` through `test/helpers/sql-schema.helper.ts` so domain expectations catch SQL schema drift instead of only repeating local constants. Route compatibility and duplicate-controller safety are covered by module graph tests, with `QqbotModule` mocked in metadata-only specs to avoid unrelated BangDream/NapCat side effects.

### Task 3.2: Sync Admin Blog/WordPress/Asset pages

**Files:**
- Modify: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\api\blog\index.ts`
- Modify: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\api\blog\wordpress.ts`
- Create: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\api\blog\asset.ts`
- Modify: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\views\blog\**`
- Modify: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\router\routes\modules\blog.ts`

- [x] **Step 1: Update callers**

Use string IDs and explicit response types.

- [x] **Step 2: Keep pages work-focused**

Use KtTable or existing forms; avoid landing-page or card-heavy redesign.

- [x] **Step 3: Verify**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\Vue\kt-template-admin -F @vben/web-antdv-next run typecheck
```

Expected: PASS.

Actual note: Admin Blog/WordPress ID-facing types were aligned to string IDs, `api/blog/asset.ts` was added against the existing `/minio/*` compatibility routes, and the Blog router/page layout was left unchanged because Batch 3 did not introduce a new visible page structure.

### Task 3.3: Commit Batch 3

Run:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add src/modules/blog src/modules/wordpress src/modules/asset src/app.module.ts test/modules sql/refactor-v3 docs/refactor-v3 API.md README.md
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "refactor: 迁移博客镜像与资产模块"
git -C D:\MyFiles\KT\Vue\kt-template-admin add apps/web-antdv-next/src/api/blog apps/web-antdv-next/src/views/blog apps/web-antdv-next/src/router/routes/modules/blog.ts
git -C D:\MyFiles\KT\Vue\kt-template-admin commit -m "refactor: 同步博客与资产管理页面"
```

## Batch 4: QQBot Core

### Task 4.1: Build QQBot core module

**Files:**
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\core\**`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\src\app.module.ts`
- Test: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\qqbot\core\**`

- [ ] **Step 1: Write RED status-separation tests**

Cover OneBot connection, container status, WebUI status, and QQ login status as separate fields.

- [ ] **Step 2: Write RED command tests**

Cover operation key lookup, command ID usage, aliases, cooldown, permission policy, and parser validation.

- [ ] **Step 3: Write RED send queue tests**

Cover queue reservation, rate limit, send log, and dedupe event behavior.

- [ ] **Step 4: Implement core**

Move account, connection, command, rule, message, permission, send, dedupe, and dashboard logic into `src/modules/qqbot/core`.

- [ ] **Step 5: Verify**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand --runTestsByPath test/qqbot/command/qqbot-command-parser.service.spec.ts test/qqbot/send/qqbot-send.service.spec.ts test/qqbot/send/qqbot-rate-limit.service.spec.ts test/qqbot/event/qqbot-event.service.spec.ts test/modules/qqbot/core
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
```

Expected: PASS.

### Task 4.2: Sync Admin QQBot core pages

**Files:**
- Modify: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\api\qqbot\index.ts`
- Modify: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\views\qqbot\account\**`
- Modify: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\views\qqbot\command\list.tsx`
- Modify: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\views\qqbot\rule\list.tsx`
- Modify: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\views\qqbot\message\list.tsx`
- Modify: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\views\qqbot\sendLog\list.tsx`

- [ ] **Step 1: Split status fields in the API types**

Define `oneBotStatus`, `containerStatus`, `webuiStatus`, and `qqLoginStatus` separately.

- [ ] **Step 2: Keep account page single-root**

If modal/drawer components are siblings, wrap the route in one root container.

- [ ] **Step 3: Verify**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\Vue\kt-template-admin -F @vben/web-antdv-next run typecheck
```

Expected: PASS.

### Task 4.3: Run local QQBot command smoke

Run API locally, query enabled command by `operationKey`, pass `commandId`, and include full command text.

Expected evidence:

- request URL
- command ID
- operation key
- response status
- sanitized response summary without `replyText`

### Task 4.4: Commit Batch 4

Run:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add src/modules/qqbot/core src/app.module.ts test/modules/qqbot/core sql/refactor-v3 docs/refactor-v3 API.md
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "refactor: 迁移QQBot核心模块"
git -C D:\MyFiles\KT\Vue\kt-template-admin add apps/web-antdv-next/src/api/qqbot apps/web-antdv-next/src/views/qqbot apps/web-antdv-next/src/router/routes/modules/qqbot.ts
git -C D:\MyFiles\KT\Vue\kt-template-admin commit -m "refactor: 同步QQBot核心管理页"
```

## Batch 5: QQBot Plugin Platform

### Task 5.1: Build plugin platform schema and manifest contracts

**Files:**
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\plugin-platform\manifest\**`
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\plugin-platform\persistence\**`
- Test: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\qqbot\plugin-platform\manifest.spec.ts`

- [ ] **Step 1: Write RED manifest validation tests**

Cover plugin key, semantic version, SDK version, operations, events, config schema, assets, migrations, permissions, and runtime limits.

- [ ] **Step 2: Implement manifest parser**

Reject unknown permissions, duplicate operation keys, duplicate event keys, missing runtime budgets, and package paths outside plugin root.

- [ ] **Step 3: Verify**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand --runTestsByPath test/modules/qqbot/plugin-platform/manifest.spec.ts
```

Expected: PASS.

### Task 5.2: Build plugin CLI

**Files:**
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\scripts\qqbot-plugin\cli.ts`
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\scripts\qqbot-plugin\templates\basic\plugin.json`
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\scripts\qqbot-plugin\templates\basic\src\index.ts`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\package.json`
- Test: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\qqbot\plugin-platform\cli.spec.ts`

- [ ] **Step 1: Add package script**

Add:

```json
{
  "scripts": {
    "qqbot-plugin": "ts-node -r tsconfig-paths/register scripts/qqbot-plugin/cli.ts"
  }
}
```

Keep existing scripts.

- [ ] **Step 2: Implement commands**

Commands:

```text
create <pluginKey>
validate <path>
pack <path>
install-local <package>
```

- [ ] **Step 3: Verify CLI**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api qqbot-plugin create demo-plugin
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api qqbot-plugin validate .\plugins\demo-plugin
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api qqbot-plugin pack .\plugins\demo-plugin
```

Expected: commands exit `0`, package includes content hash.

### Task 5.3: Build worker runtime and lifecycle

**Files:**
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\plugin-platform\runtime\**`
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\plugin-platform\sdk\**`
- Test: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\qqbot\plugin-platform\worker-runtime.spec.ts`

- [ ] **Step 1: Write RED RPC tests**

Cover `load`, `activate`, `executeOperation`, `handleEvent`, `health`, `deactivate`, `dispose`, timeout, and crash isolation.

- [ ] **Step 2: Implement host-side runtime**

Worker messages include correlation ID, timeout budget, operation ID, safe input summary, and structured output.

- [ ] **Step 3: Implement SDK**

Expose only send queue, plugin config, plugin storage, runtime HTTP client, plugin asset loader, operation context, and event context.

- [ ] **Step 4: Verify**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand --runTestsByPath test/modules/qqbot/plugin-platform/worker-runtime.spec.ts
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
```

Expected: PASS.

### Task 5.4: Sync Admin plugin platform page

**Files:**
- Create: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\api\qqbot\plugin.ts`
- Modify: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\views\qqbot\plugin\list.tsx`
- Modify: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\router\routes\modules\qqbot.ts`

- [ ] **Step 1: Add plugin caller**

Caller methods: upload, validate, install, enable, disable, upgrade, uninstall, update config, list runtime events, list account bindings.

- [ ] **Step 2: Build management page**

Use tables, status tags, drawers/modals for upload/config/events, and Chinese operation labels.

- [ ] **Step 3: Verify**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\Vue\kt-template-admin -F @vben/web-antdv-next run typecheck
```

Expected: PASS.

### Task 5.5: Commit Batch 5

Run:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add src/modules/qqbot/plugin-platform scripts/qqbot-plugin test/modules/qqbot/plugin-platform package.json sql/refactor-v3 docs/refactor-v3 API.md README.md
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "feat: 建立QQBot插件平台"
git -C D:\MyFiles\KT\Vue\kt-template-admin add apps/web-antdv-next/src/api/qqbot apps/web-antdv-next/src/views/qqbot/plugin apps/web-antdv-next/src/router/routes/modules/qqbot.ts
git -C D:\MyFiles\KT\Vue\kt-template-admin commit -m "feat: 增加QQBot插件管理页"
```

## Batch 6: Existing Plugin Rewrite

### Task 6.1: Rewrite BangDream as platform plugin

**Files:**
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\plugins\bangDream\plugin.json`
- Create/modify: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\plugins\bangDream\**`
- Test: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\qqbot\plugins\bangDream\**`

- [ ] **Step 1: Preserve business directories**

Keep business capabilities in `song`, `card`, `character`, `event`, `gacha`, `player`, `cutoff`, `catalog`, with cross-cutting code only in `application`, `registry`, `hook`, `provider`, `policy`, `theme`, `config`, `dictionary`, `search`, `shared`.

- [ ] **Step 2: Convert operation registry to manifest metadata**

Keep operation keys and aliases stable. `handlerName` becomes worker-internal.

- [ ] **Step 3: Verify BangDream**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand --runTestsByPath test/qqbot/plugins/bangDream/registry/operation-registry.spec.ts test/qqbot/plugins/bangDream/registry/command-sql.spec.ts test/modules/qqbot/plugins/bangDream
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
```

Expected: PASS. Event stage smoke keeps `imageCount=5`.

### Task 6.2: Rewrite FF14 Market, FFLogs, and Repeater

**Files:**
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\plugins\ff14Market\**`
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\plugins\fflogs\**`
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\plugins\repeater\**`
- Test: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\qqbot\plugins\ff14Market\**`
- Test: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\qqbot\plugins\fflogs\**`
- Test: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\qqbot\plugins\repeater\**`

- [ ] **Step 1: FF14 Market**

Use host runtime HTTP SDK for external requests. No direct axios client in plugin code.

- [ ] **Step 2: FFLogs**

Use plugin config for credential references. No real secret in manifest, tests, docs, or commits.

- [ ] **Step 3: Repeater**

Use host send queue and account binding. Do not bypass rate limit.

- [ ] **Step 4: Verify**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand --runTestsByPath test/qqbot/plugins/ff14Market/qqbot-ff14-worlds.spec.ts test/qqbot/plugins/fflogs/qqbot-fflogs-client.service.spec.ts test/qqbot/plugins/repeater/qqbot-repeater.plugin.spec.ts test/modules/qqbot/plugins/ff14Market test/modules/qqbot/plugins/fflogs test/modules/qqbot/plugins/repeater
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
```

Expected: PASS.

### Task 6.3: Commit Batch 6

Run:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add src/modules/qqbot/plugins test/modules/qqbot/plugins sql/refactor-v3 docs/refactor-v3 API.md
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "refactor: 重写现有QQBot插件"
```

## Batch 7: NapCat Runtime

### Task 7.1: Build NapCat device persistence model

**Files:**
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\napcat\device\**`
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\napcat\container\**`
- Test: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\qqbot\napcat\device-identity.spec.ts`

- [ ] **Step 1: Write RED persistence test**

Assert that rebuilding a container for the same account reuses data directory, hostname, machine-id path, and MAC address from `napcat_device_identity`.

- [ ] **Step 2: Implement device identity service**

Device identity owns container name, data dir, hostname, machine ID path, MAC, account binding, verification status, and last login evidence.

- [ ] **Step 3: Verify**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand --runTestsByPath test/modules/qqbot/napcat/device-identity.spec.ts
```

Expected: PASS.

### Task 7.2: Build NapCat login state machine

**Files:**
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\napcat\login\**`
- Test: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\qqbot\napcat\login-state-machine.spec.ts`

- [ ] **Step 1: Write RED state tests**

Cover this order:

```text
quick-login -> password-login -> captcha -> new-device -> manual-qr -> success/failure
```

Also cover cleanup failure blocking success.

- [ ] **Step 2: Implement login session and challenge states**

Keep captcha and new-device challenge state pending until explicitly resolved, expired, or failed.

- [ ] **Step 3: Verify**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand --runTestsByPath test/modules/qqbot/napcat/login-state-machine.spec.ts
```

Expected: PASS.

### Task 7.3: Implement new-device NapCat API flow

**Files:**
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\napcat\integration\napcat-login-api.client.ts`
- Test: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\qqbot\napcat\new-device-flow.spec.ts`

- [ ] **Step 1: Write RED new-device flow test**

Test sequence:

```text
GetNewDeviceQRCode -> PollNewDeviceQR -> NewDeviceLogin
```

Expected state mapping:

```text
qr-pending -> scanned -> confirming -> verified
```

- [ ] **Step 2: Implement client methods**

Methods:

```ts
getNewDeviceQRCode(sessionId: string): Promise<NewDeviceQrCode>
pollNewDeviceQR(sessionId: string): Promise<NewDeviceQrStatus>
newDeviceLogin(sessionId: string): Promise<NewDeviceLoginResult>
```

- [ ] **Step 3: Verify**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand --runTestsByPath test/modules/qqbot/napcat/new-device-flow.spec.ts
```

Expected: PASS.

### Task 7.4: Sync Admin NapCat login page and SSE Chinese progress

**Files:**
- Create: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\api\qqbot\napcat.ts`
- Modify: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\views\qqbot\account\**`
- Create: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\views\qqbot\napcat\**`
- Modify: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\router\routes\modules\qqbot.ts`

- [ ] **Step 1: Add Chinese progress labels**

Labels include:

```text
正在快速登录
快速登录失败，进入密码登录
正在密码登录
需要验证码
验证码已提交，等待确认
需要新设备验证二维码
新设备二维码待扫码
新设备二维码已扫码
新设备确认中
新设备验证成功，继续登录
正在生成手动二维码
登录成功
登录失败
运行态清理失败
```

- [ ] **Step 2: Render captcha and new-device states separately**

Do not display new-device QR as captcha. Do not clear captcha state only because a subsequent poll omits URL.

- [ ] **Step 3: Verify Admin typecheck**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\Vue\kt-template-admin -F @vben/web-antdv-next run typecheck
```

Expected: PASS.

### Task 7.5: Run local NapCat simulated smoke

Use mocked NapCat responses or a local controlled container. Evidence must show:

- device identity reused after container rebuild
- captcha challenge remains pending
- new-device QR generated through `GetNewDeviceQRCode`
- poll transitions to scanned/confirming
- `NewDeviceLogin` completes
- cleanup failure blocks success

### Task 7.6: Commit Batch 7

Run:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add src/modules/qqbot/napcat test/modules/qqbot/napcat sql/refactor-v3 docs/refactor-v3 API.md
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "feat: 重建NapCat设备与登录运行时"
git -C D:\MyFiles\KT\Vue\kt-template-admin add apps/web-antdv-next/src/api/qqbot apps/web-antdv-next/src/views/qqbot apps/web-antdv-next/src/router/routes/modules/qqbot.ts
git -C D:\MyFiles\KT\Vue\kt-template-admin commit -m "feat: 完成NapCat登录进度管理页"
```

## Batch 8: Unified Local Closure, Push, Deploy, Online Smoke

### Task 8.1: Final local verification

Run:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api status --short --branch
git -C D:\MyFiles\KT\Vue\kt-template-admin status --short --branch
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand
pnpm --dir D:\MyFiles\KT\Vue\kt-template-admin -F @vben/web-antdv-next run typecheck
git -C D:\MyFiles\KT\Node\kt-template-online-api diff --check
git -C D:\MyFiles\KT\Vue\kt-template-admin diff --check
```

Expected: all commands exit `0`.

### Task 8.2: Run local full smoke

Required smoke evidence:

- `/health/runtime`
- Admin login
- Admin menu
- Blog public list/detail
- Asset upload/read
- QQBot command test
- Plugin install/enable/health
- Rewritten plugin operation
- NapCat simulated login flow

### Task 8.3: Ask user for push and DB rebuild window

Do not push or run online DB rebuild until the user explicitly confirms.

### Task 8.4: Push and observe deployment

After confirmation, push both repos.

Run:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api push -u origin dev-api-full-refactor-v3
git -C D:\MyFiles\KT\Vue\kt-template-admin push -u origin dev-admin-full-refactor-v3
```

Then collect Jenkins/K8s evidence:

- build number
- commit hash
- image tag
- Deployment generation and observedGeneration
- desired/updated/ready counts
- selected Pod image
- restart count
- Pod logs/events if failing

### Task 8.5: Online DB rebuild

Before writes:

- state source database
- state target database
- state backup path
- state restore command
- state SQL scripts to apply

Run online backup first. Apply schema only after backup succeeds.

### Task 8.6: Online full smoke

Required online evidence:

- `/health/runtime` returns service and status
- Admin login succeeds
- Admin menu loads
- Blog public pages work
- plugin package install/enable/health succeeds
- `/qqbot/command/test` uses operationKey-derived command ID and full command text
- NapCat real account login completes through the actual required path for that account
- if new-device appears, evidence includes `GetNewDeviceQRCode -> PollNewDeviceQR -> NewDeviceLogin`
- response summaries strip `replyText`

### Task 8.7: Final closeout

Run MCP tools:

```text
kt_change_doc_sync(project=api, taskType=deploy)
kt_change_doc_sync(project=admin, taskType=deploy)
kt_global_code_review(projects=["api","admin","root"], contentScanMode="changed", includeContentScan=true)
kt_cleanup_history(dryRun=true)
kt_workflow_loop_audit(stage="finish", requireCompletion=true)
```

Expected: required docs resolved, review findings resolved, cleanup final deleted count is `0`, and closeout can report complete.

## Cross-Batch Review Gates

Run these before every batch commit:

```text
kt_change_doc_sync(...)
kt_global_code_review(...)
```

Run Superpowers review before claiming a batch is finished:

```text
superpowers:requesting-code-review
```

If review finds a real Important issue, fix it and re-review before commit.

## Plan Self-Review

### Spec Coverage

| Spec Requirement | Plan Coverage |
| --- | --- |
| API/Admin dual-repo refactor | Tasks 0.1, 0.2, 2.2, 3.2, 4.2, 5.4, 7.4, 8.1-8.7 |
| Clean Admin authorized old artifacts during implementation preparation | Task 0.2 |
| Full database redesign and destructive rebuild with rollback | Tasks 0.3-0.5, 8.5 |
| Batch 0-8 local-first rhythm | Batch sections 0-8 and Cross-Batch Review Gates |
| Runtime/Common migration | Batch 1 |
| Admin/Auth/Platform Config migration | Batch 2 |
| Blog/WordPress/Asset migration | Batch 3 |
| QQBot Core migration | Batch 4 |
| QQBot Plugin Platform | Batch 5 |
| Existing plugin rewrite | Batch 6 |
| NapCat device persistence and login state machine | Batch 7 |
| New-device flow `GetNewDeviceQRCode -> PollNewDeviceQR -> NewDeviceLogin` | Task 7.3 |
| SSE/Admin Chinese progress | Task 7.4 |
| Unified push, Jenkins/K8s, DB rebuild, online smoke | Batch 8 |

### Type And Path Consistency

- API plan paths use `D:\MyFiles\KT\Node\kt-template-online-api`.
- Admin plan paths use `D:\MyFiles\KT\Vue\kt-template-admin`.
- New API implementation root is consistently `src/modules/**`.
- Legacy API roots are removed only after matching batch compatibility checks pass.
- Admin IDs crossing the API boundary are consistently planned as `string`.

## Final Completion Criteria

The third phase is complete only when all of these are true:

- API branch contains Batch 0-8 commits.
- Admin branch contains every Admin contract sync commit.
- API/Admin local verification passes.
- Online backup and rollback path are recorded.
- New schema is applied online.
- Jenkins/K8s observation matches pushed commits.
- Online functional smoke passes.
- NapCat real account flow completes, including device persistence and new-device flow when triggered.
- TASKS and required docs are updated.
- KT global review and Superpowers review are clean.
- No Node/Vite validation process started by the run remains alive.
