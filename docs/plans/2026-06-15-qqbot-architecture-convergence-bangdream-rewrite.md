# QQBot Architecture Convergence And BangDream Rewrite Implementation Plan

> **Execution note:** Execute this plan task-by-task with the KT-local workflow and use the checkboxes to track plan state.

**Goal:** Make the approved third-phase QQBot target architecture true in code: core, plugin-platform, napcat, built-in plugins, BangDream, Admin callers/pages, local validation, deployment observation, and online account smoke must all close.

**Architecture:** Execute as strict batch gates. Each batch starts with RED checks that fail on the current loose structure, then moves code into the approved boundaries, removes obsolete implementation, updates schema/docs/Admin, verifies locally, reviews, and commits only the scoped result.

**Tech Stack:** NestJS 11, TypeORM 0.3, MySQL, pnpm 9 API workspace, Vben Admin 5 / Vue 3 / TSX / Ant Design Vue, pnpm 10 Admin workspace, Jest, Vitest, Playwright/browser smoke, ktWorkflow MCP, Jenkins/K8s, NapCat WebUI and OneBot runtime.

---

## Success Boundary

This plan is complete only when all of these are true:

- `src/modules/qqbot/core/**`, `src/modules/qqbot/plugin-platform/**`, and `src/modules/qqbot/napcat/**` use the approved `contract/application/domain/infrastructure/{persistence,integration}/schema` structure.
- Core imports no concrete plugin implementation and registers no concrete plugin provider.
- Plugin Platform owns manifest validation, package install, lifecycle, worker runtime, operation registry, event dispatcher, SDK host adapters, runtime events, and account binding.
- Every built-in plugin uses the same package structure under `src/modules/qqbot/plugins/<pluginKey>/plugin.json` and `src/**`.
- BangDream is rebuilt as `plugins/bangdream`, old `bangDream` business code is removed, and the 15 approved operations remain behavior-compatible.
- FF14 Market, FFLogs, and Repeater are rebuilt as `ff14-market`, `fflogs`, and `repeater` packages with no Nest/Admin/Core/env/direct HTTP or direct fs dependencies.
- NapCat device identity, container runtime, login session, challenge, new-device flow, and cleanup failure semantics are recoverable from persistence.
- Admin callers and pages are split by QQBot core, Plugin Platform, and NapCat state domains.
- Local API/Admin tests, local real interface smoke, browser smoke, KT global review, KT global review, push/deploy observation, and online QQBot/NapCat smoke are recorded.

## Current Baseline

- API repo: `D:\MyFiles\KT\Node\kt-template-online-api`, branch `dev-api-architecture-convergence-v3`, package manager `pnpm@9.15.9`, no `.node-version`, no `engines`.
- Admin repo: `D:\MyFiles\KT\Vue\kt-template-admin`, branch `dev-admin-architecture-convergence-v3`, package manager `pnpm@10.28.2`, `.node-version=22.22.0`, `engines.node >=20.19.0`, `engines.pnpm >=10.0.0`.
- Root repo: `D:\MyFiles\KT`, branch `main`.
- Existing API dirty work contains the already verified plugin operation pagination and NapCat new-device QR fix:
  - `package.json`
  - `pnpm-lock.yaml`
  - `src/modules/qqbot/napcat/integration/napcat-login-api.client.ts`
  - `src/modules/qqbot/plugin-platform/qqbot-plugin.controller.ts`
  - `src/modules/qqbot/plugins/bangdream/src/application/main-data-store.ts`
  - `test/modules/qqbot/napcat/new-device-flow.spec.ts`
  - `test/modules/qqbot/plugins/plugin-controller-http-smoke.spec.ts`
- Existing Admin dirty work contains the matching plugin pagination wrapper/page change:
  - `apps/web-antdv-next/src/api/qqbot/index.ts`
  - `apps/web-antdv-next/src/views/qqbot/plugin/list.tsx`
  - `apps/web-antdv-next/src/api/qqbot/index.spec.ts`
- Existing root dirty work contains KT governance/task context:
  - `AGENTS.md`
  - `TASKS.md`

## Non-Negotiable Execution Rules

- Do not start broad implementation while API/Admin/root dirty state is ambiguous.
- Preserve verified prior fixes by committing them as a baseline or by carrying their tests and behavior into Batch 1 before deleting old files.
- Use `apply_patch` for manual edits.
- Do not revert user changes outside the explicit baseline cleanup scope.
- Use at most three background subagents for independent audits or reviews, each with a Context Packet under `.kt-workspace/subagents/`.
- Every structural rule below must have an executable test or scan, not a prose-only promise.
- Do not push until local closure and review pass. The user goal requires online closure, so the final release batch includes push, Jenkins/K8s observation, and online smoke after local evidence is clean.
- Destructive DB or online state writes require named source, target, backup path, rollback command, action SQL/scripts, and verification query before execution.

## Batch 0: Baseline Cleanliness And Evidence Freeze

### Task 0.1: Confirm repository state

**Files:** no edits.

- [ ] Run:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api status --short --branch
git -C D:\MyFiles\KT\Vue\kt-template-admin status --short --branch
git -C D:\MyFiles\KT status --short --branch
```

- [ ] Confirm the dirty sets match `Current Baseline`.
- [ ] Stop and inspect before edits if any extra dirty path appears.

### Task 0.2: Preserve verified pagination and new-device QR fixes

**Files:**

- API dirty files listed in `Current Baseline`
- Admin dirty files listed in `Current Baseline`
- Root `AGENTS.md`, `TASKS.md`

- [ ] Re-run the focused checks for the existing fix:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand --runTestsByPath test/modules/qqbot/napcat/new-device-flow.spec.ts test/modules/qqbot/plugins/plugin-controller-http-smoke.spec.ts
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
pnpm --dir D:\MyFiles\KT\Vue\kt-template-admin -F @vben/web-antdv-next exec vitest run apps/web-antdv-next/src/api/qqbot/index.spec.ts
pnpm --dir D:\MyFiles\KT\Vue\kt-template-admin -F @vben/web-antdv-next run typecheck
```

- [ ] Commit the verified baseline in API with:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add package.json pnpm-lock.yaml src/modules/qqbot/napcat/integration/napcat-login-api.client.ts src/modules/qqbot/plugin-platform/qqbot-plugin.controller.ts src/modules/qqbot/plugins/bangdream/src/application/main-data-store.ts test/modules/qqbot/napcat/new-device-flow.spec.ts test/modules/qqbot/plugins/plugin-controller-http-smoke.spec.ts
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "fix: 补齐QQBot插件分页与新设备二维码"
```

- [ ] Commit the verified baseline in Admin with:

```powershell
git -C D:\MyFiles\KT\Vue\kt-template-admin add apps/web-antdv-next/src/api/qqbot/index.ts apps/web-antdv-next/src/api/qqbot/index.spec.ts apps/web-antdv-next/src/views/qqbot/plugin/list.tsx
git -C D:\MyFiles\KT\Vue\kt-template-admin commit -m "fix: 对齐QQBot插件分页页面"
```

- [ ] Commit root governance if the diff is only the multi-agent and task-context record:

```powershell
git -C D:\MyFiles\KT add AGENTS.md TASKS.md
git -C D:\MyFiles\KT commit -m "docs: 固化KT多代理协作规则"
```

### Task 0.3: Freeze behavior and file inventory

**Files:**

- Create or update: `D:\MyFiles\KT\Node\kt-template-online-api\docs\refactor-v3\qqbot-architecture-convergence-inventory.md`
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\qqbot\architecture\qqbot-current-operation-matrix.spec.ts`

- [ ] Record current operation keys, aliases, command seed linkage, route paths, DTO response shapes, SSE event keys, table ownership, and known online smoke entry commands.
- [ ] Record obsolete file groups to delete after replacements pass:
  - old feature buckets in `core/account|command|rule|send|...`
  - old `plugin-platform/manifest|persistence|registry|runtime|sdk` buckets when moved into approved layers
  - old `plugins/bangDream`, `plugins/ff14Market`, `plugins/fflogs`, `plugins/repeater`
  - old NapCat `device|container|login|integration|persistence.ts` buckets
- [ ] Add an operation matrix test that asserts all 15 BangDream operation keys plus FF14, FFLogs, and Repeater operations are discoverable before refactor.
- [ ] Verify:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand --runTestsByPath test/modules/qqbot/architecture/qqbot-current-operation-matrix.spec.ts
```

### Task 0.4: Commit Batch 0

- [ ] Run:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api diff --check
git -C D:\MyFiles\KT\Vue\kt-template-admin diff --check
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run global-review -- --project api --content-scan-mode changed
```

- [ ] Commit API inventory and matrix test:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add docs/refactor-v3/qqbot-architecture-convergence-inventory.md test/modules/qqbot/architecture/qqbot-current-operation-matrix.spec.ts
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "test: 冻结QQBot重构能力矩阵"
```

## Batch 1: RED Architecture Gates

### Task 1.1: Add core and module boundary gates

**Files:**

- Create: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\qqbot\architecture\qqbot-module-boundary.spec.ts`

- [ ] Add a scan that fails while any file under `src/modules/qqbot/core/**` imports `src/modules/qqbot/plugins/**`.
- [ ] Add a scan that fails while `QqbotCoreModule` registers concrete plugin services, `QqbotPluginController`, plugin registry concrete classes, or plugin SDK HTTP clients.
- [ ] Add a scan that fails while `src/modules/qqbot/core/domain/**` imports Nest, TypeORM, Docker/process/HTTP, Admin, or Plugin Platform concrete implementation.
- [ ] Add a scan that fails while `src/modules/qqbot/napcat/application/**` builds Docker/SSH shell strings.
- [ ] Verify RED:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand --runTestsByPath test/modules/qqbot/architecture/qqbot-module-boundary.spec.ts
```

Expected: fails on current structure with explicit path findings.

### Task 1.2: Add plugin package hard gates

**Files:**

- Create: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\qqbot\architecture\qqbot-plugin-package-boundary.spec.ts`

- [ ] Assert built-in plugin directories are exactly:

```text
bangdream
ff14-market
fflogs
repeater
```

- [ ] Assert each plugin has:

```text
plugin.json
src/index.ts
src/operations
src/events
src/domain
src/application
src/infrastructure/integration
src/infrastructure/storage
src/config
src/assets
src/migrations
src/tests
```

- [ ] Ban from plugin runtime source:
  - `@nestjs/`
  - `@/modules/admin`
  - `@/modules/qqbot/core`
  - `ConfigService`
  - `DictService`
  - `process.env`
  - direct `axios`
  - direct `fetch`
  - direct `fs` or `node:fs`
  - import-time timers or immediate remote loads
- [ ] Assert operation metadata source of truth is `plugin.json`, with no parallel TS operation registry exporting duplicate key/alias descriptions.
- [ ] Verify RED:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand --runTestsByPath test/modules/qqbot/architecture/qqbot-plugin-package-boundary.spec.ts
```

Expected: fails on current `bangDream`, `ff14Market`, Nest services, and old registries.

### Task 1.3: Add runtime behavior gates

**Files:**

- Create: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\qqbot\plugin-platform\plugin-lifecycle-runtime.spec.ts`
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\qqbot\core\qqbot-core-plugin-ports.spec.ts`
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\qqbot\napcat\napcat-persistent-login-state.spec.ts`
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\qqbot\plugins\bangdream-rewrite\bangdream-operation-parity.spec.ts`

- [ ] Lifecycle test covers install, enable, active registry refresh, operation execution, event dispatch, disable, uninstall, timeout, crash isolation, and runtime event persistence.
- [ ] Core ports test covers command prefix and alias matching in core, raw args handed to Plugin Platform, plugin output normalized back to command log/send queue, and plugin event dispatch after core does not consume a message.
- [ ] NapCat persistence test covers device identity reuse, session recovery, captcha challenge recovery, new-device challenge recovery, cleanup failure blocking success, and manual QR fallback state.
- [ ] BangDream parity test covers the 15 operation keys and asserts `bangdream.event.stage` keeps `imageCount=5`.
- [ ] Verify RED:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand --runTestsByPath test/modules/qqbot/plugin-platform/plugin-lifecycle-runtime.spec.ts test/modules/qqbot/core/qqbot-core-plugin-ports.spec.ts test/modules/qqbot/napcat/napcat-persistent-login-state.spec.ts test/modules/qqbot/plugins/bangdream-rewrite/bangdream-operation-parity.spec.ts
```

Expected: fails because current runtime and plugin package boundaries are not the approved model.

### Task 1.4: Commit Batch 1 RED gates

- [ ] Commit only tests and docs:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add test/modules/qqbot docs/refactor-v3/qqbot-architecture-convergence-inventory.md
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "test: 增加QQBot强收敛门禁"
```

## Batch 2: Core, Plugin Platform, And NapCat Structural Shells

### Task 2.1: Create approved module skeletons

**Files:**

- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\core\**`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\plugin-platform\**`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\napcat\**`

- [ ] Move core controllers/DTOs/constants into `core/contract`.
- [ ] Move core use-case services into `core/application`.
- [ ] Move pure policies, parser-independent command matching, rule state, permission state, send queue policy, and event normalization into `core/domain`.
- [ ] Move core TypeORM entities/repositories into `core/infrastructure/persistence`.
- [ ] Move OneBot WS, MQTT/bus, and runtime external adapters into `core/infrastructure/integration`.
- [ ] Add `core/schema/README.md` with owned tables, seed linkage, and verification SQL.
- [ ] Repeat the same structural split for `plugin-platform` and `napcat`.
- [ ] Update module barrels and imports without changing public route behavior.

### Task 2.2: Replace core plugin dependencies with ports

**Files:**

- Create: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\core\domain\plugin-execution.port.ts`
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\core\application\plugin-execution.adapter.ts`
- Modify: core command/rule/event services
- Modify: plugin-platform providers

- [ ] Define ports for:
  - `executeOperation(input)`
  - `dispatchEvent(input)`
  - `listActiveOperations(accountContext)`
  - `getOperationByCommand(commandId|operationKey)`
- [ ] Core command parser keeps only prefix, alias, command ID, and raw args extraction.
- [ ] FF14 positional parsing, FFLogs positional parsing, BangDream parsing, and Repeater triggering move out of core.
- [ ] Rule engine no longer directly calls Repeater; it dispatches an unconsumed message event to Plugin Platform.
- [ ] Core module imports Plugin Platform through exported abstract provider tokens only.

### Task 2.3: Verify Batch 2

- [ ] Run:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand --runTestsByPath test/modules/qqbot/architecture/qqbot-module-boundary.spec.ts test/modules/qqbot/core/qqbot-core-plugin-ports.spec.ts test/modules/qqbot/core/qqbot-core-command-contract.spec.ts test/modules/qqbot/core/qqbot-core-send-contract.spec.ts
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
```

- [ ] Run changed-file ESLint on touched API files.
- [ ] Confirm no deleted public route breaks by running the local command smoke after starting or reusing the local API service.

### Task 2.4: Commit Batch 2

- [ ] Run `git diff --check` and KT global review.
- [ ] Commit:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add src/modules/qqbot/core src/modules/qqbot/plugin-platform src/modules/qqbot/napcat test/modules/qqbot docs/refactor-v3 API.md README.md
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "refactor: 收敛QQBot核心模块边界"
```

## Batch 3: Plugin Platform Runtime And CLI

### Task 3.1: Implement manifest and package ownership

**Files:**

- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\plugin-platform\domain\**`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\plugin-platform\application\**`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\plugin-platform\infrastructure\persistence\**`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\plugin-platform\infrastructure\integration\**`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\scripts\qqbot-plugin\**`

- [ ] Manifest parser validates key, version, runtime, operations, events, permissions, config schema, assets, migrations, and legacy aliases.
- [ ] Package installer enforces hash, size, path whitelist, no path traversal, no hidden host import shortcuts, and controlled install root.
- [ ] `pnpm qqbot-plugin create <key>` scaffolds the exact package structure and no legacy directories.
- [ ] `pnpm qqbot-plugin validate <path>` runs manifest validation plus source boundary scan.
- [ ] `pnpm qqbot-plugin pack <path>` creates a package with deterministic file list and hash.
- [ ] `pnpm qqbot-plugin install-local <path>` validates, persists version, installs package, and returns installation/version IDs.

### Task 3.2: Implement lifecycle, worker runtime, registry, executor, dispatcher

**Files:**

- Modify: `src/modules/qqbot/plugin-platform/application/**`
- Modify: `src/modules/qqbot/plugin-platform/domain/**`
- Modify: `src/modules/qqbot/plugin-platform/infrastructure/integration/**`
- Modify: `src/modules/qqbot/plugin-platform/contract/**`

- [ ] Enable starts worker, loads manifest, activates plugin, persists runtime event, refreshes active operation/event registry.
- [ ] Disable deactivates and disposes worker, removes active operations/events, persists runtime event, and leaves command seed rows inactive.
- [ ] Upgrade enters `upgrading`, starts new worker, health-checks it, swaps active registry after success, and preserves previous active version on failure.
- [ ] Uninstall refuses active plugin, removes package and install records after disable, and records runtime event.
- [ ] Operation executor handles timeout, crash, structured plugin error, command log mapping, image output, and reply text without leaking secret summaries.
- [ ] Event dispatcher handles account binding, plugin config, event context, and plugin send queue SDK.
- [ ] Runtime event persistence is append-only and queryable by plugin, installation, severity, event type, and time.
- [ ] `/qqbot/plugin/*` compatibility routes move under `plugin-platform/contract`.
- [ ] `/qqbot/plugin-platform/*` management routes expose validate, upload/install, install-local, enable, disable, upgrade, uninstall, config, runtime events, account bindings, capabilities, operations page/list, and event handlers.

### Task 3.3: Verify Batch 3

- [ ] Run:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand --runTestsByPath test/modules/qqbot/plugin-platform/manifest.spec.ts test/modules/qqbot/plugin-platform/cli.spec.ts test/modules/qqbot/plugin-platform/persistence-contract.spec.ts test/modules/qqbot/plugin-platform/plugin-platform-api-contract.spec.ts test/modules/qqbot/plugin-platform/worker-runtime.spec.ts test/modules/qqbot/plugin-platform/plugin-lifecycle-runtime.spec.ts
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
```

- [ ] Run CLI smoke:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api qqbot-plugin create smoke-plugin --out .kt-workspace\test-artifacts\qqbot-plugin-cli\smoke-plugin
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api qqbot-plugin validate .kt-workspace\test-artifacts\qqbot-plugin-cli\smoke-plugin
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api qqbot-plugin pack .kt-workspace\test-artifacts\qqbot-plugin-cli\smoke-plugin --out .kt-workspace\test-artifacts\qqbot-plugin-cli
```

- [ ] Run local authenticated smoke for operation page/list and install/enable/disable if API service is available.

### Task 3.4: Commit Batch 3

- [ ] Run `git diff --check`, cleanup CLI artifacts under `.kt-workspace`, and KT global review.
- [ ] Commit:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add src/modules/qqbot/plugin-platform scripts/qqbot-plugin test/modules/qqbot/plugin-platform test/modules/qqbot/architecture docs/refactor-v3 API.md README.md package.json pnpm-lock.yaml
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "feat: 重建QQBot插件平台运行时"
```

## Batch 4: BangDream Full Rewrite

### Task 4.1: Build new `bangdream` package shell

**Files:**

- Create: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\plugins\bangdream\plugin.json`
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\plugins\bangdream\src\**`
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\plugins\bangdream\src\assets\**`
- Modify: command seed SQL and plugin platform seed SQL

- [ ] Use key `bangdream`; preserve legacy alias `bangDream` only in manifest compatibility and seed mapping.
- [ ] `plugin.json` is the only operation metadata source for key, aliases, trigger mode, descriptions, handler names, cooldowns, and permissions.
- [ ] `src/index.ts` exports only `createPlugin()`.
- [ ] Copy or move static assets into `src/assets` with license files preserved.
- [ ] Add package-local config schema and default dictionary/static config loaders through host SDK storage/assets.

### Task 4.2: Rewrite BangDream operations

**Files:**

- New package operation dirs:
  - `src/operations/song-search`
  - `src/operations/song-chart`
  - `src/operations/song-random`
  - `src/operations/song-meta`
  - `src/operations/card-search`
  - `src/operations/card-illustration`
  - `src/operations/character-search`
  - `src/operations/event-search`
  - `src/operations/event-stage`
  - `src/operations/player-search`
  - `src/operations/gacha-search`
  - `src/operations/gacha-simulate`
  - `src/operations/cutoff-detail`
  - `src/operations/cutoff-all`
  - `src/operations/cutoff-recent`

- [ ] For every operation, define parser, use case, output contract, renderer call, fixture inputs, and parity expectations.
- [ ] Keep domain code in:
  - `src/domain/song`
  - `src/domain/card`
  - `src/domain/character`
  - `src/domain/event`
  - `src/domain/gacha`
  - `src/domain/player`
  - `src/domain/cutoff`
  - `src/domain/catalog`
- [ ] Keep orchestration in `src/application`.
- [ ] Keep Bestdori, HHWX, asset loading, cache, and static patch adapters under `src/infrastructure/integration` or `src/infrastructure/storage`.
- [ ] Keep visual tokens and reusable canvas helpers under operation-local layout files or a small theme module inside the package.
- [ ] Do not import old BangDream implementation from new runtime code.
- [ ] Preserve visible Chinese wording and error semantics for known commands.
- [ ] Preserve image output counts, especially `bangdream.event.stage` `imageCount=5`.

### Task 4.3: Remove old BangDream implementation

**Files:**

- Delete: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\plugins\bangDream\**`
- Modify import paths, seed references, tests, docs, and runtime mapping.

- [ ] Delete old facade, old application services, old registry, old shared buckets, old provider buckets, old theme buckets, old static config buckets, and import-time side effects.
- [ ] Keep license files by moving them into the new package.
- [ ] Preserve only explicit oracle fixtures under tests if they are required for parity checks.

### Task 4.4: Verify Batch 4

- [ ] Run:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand --runTestsByPath test/modules/qqbot/plugins/bangdream-rewrite/bangdream-operation-parity.spec.ts test/modules/qqbot/architecture/qqbot-plugin-package-boundary.spec.ts test/modules/qqbot/plugins/plugin-platform-migration.spec.ts test/modules/qqbot/plugins/plugin-registry-compat.spec.ts
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
```

- [ ] Run BangDream render smoke:

```powershell
powershell -ExecutionPolicy Bypass -File D:\MyFiles\KT\Node\kt-template-online-api\scripts\bangdream-render-smoke.ps1 -OperationKey bangdream.event.stage -Text 310
powershell -ExecutionPolicy Bypass -File D:\MyFiles\KT\Node\kt-template-online-api\scripts\bangdream-render-smoke.ps1 -OperationKey bangdream.song.search -Text "fire bird"
powershell -ExecutionPolicy Bypass -File D:\MyFiles\KT\Node\kt-template-online-api\scripts\bangdream-render-smoke.ps1 -OperationKey bangdream.card.search -Text "香澄"
powershell -ExecutionPolicy Bypass -File D:\MyFiles\KT\Node\kt-template-online-api\scripts\bangdream-render-smoke.ps1 -OperationKey bangdream.cutoff.detail -Text "ycx"
powershell -ExecutionPolicy Bypass -File D:\MyFiles\KT\Node\kt-template-online-api\scripts\bangdream-render-smoke.ps1 -OperationKey bangdream.gacha.simulate -Text "10"
```

- [ ] Verify event stage smoke reports `imageCount=5`.
- [ ] Run a local `/qqbot/command/test` smoke for at least one BangDream text command with command ID and full command text.

### Task 4.5: Commit Batch 4

- [ ] Run `git diff --check` and KT global review.
- [ ] Commit:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add src/modules/qqbot/plugins/bangdream test/modules/qqbot/plugins/bangdream-rewrite test/modules/qqbot/architecture sql/refactor-v3 docs/refactor-v3 API.md
git -C D:\MyFiles\KT\Node\kt-template-online-api add -u src/modules/qqbot/plugins/bangdream/src
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "refactor: 重写BangDream插件"
```

## Batch 5: FF14 Market, FFLogs, And Repeater Rewrite

### Task 5.1: Rewrite FF14 Market package

**Files:**

- Create: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\plugins\ff14-market\plugin.json`
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\plugins\ff14-market\src\**`
- Delete: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\plugins\ff14Market\**`

- [ ] Split `resolve-item` and `market-price` operations.
- [ ] Move world, region, data center, item alias, and command parsing into plugin domain/application.
- [ ] Move XIVAPI and Universalis access into `src/infrastructure/integration` through host SDK HTTP.
- [ ] Move default world/dictionary into plugin config and SDK-backed storage.

### Task 5.2: Rewrite FFLogs package

**Files:**

- Create: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\plugins\fflogs\plugin.json`
- Create/modify: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\plugins\fflogs\src\**`

- [ ] Split OAuth token, GraphQL client, encounter catalog, localization, reply formatter, and config defaults.
- [ ] Store credential references in plugin config schema only.
- [ ] Prove no real secret appears in manifest, tests, docs, or committed config.

### Task 5.3: Rewrite Repeater package

**Files:**

- Create/modify: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\plugins\repeater\plugin.json`
- Create/modify: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\plugins\repeater\src\**`

- [ ] Implement message event handler under `src/events/message`.
- [ ] Move repeat state, threshold, cooldown, and text filtering into plugin domain.
- [ ] Use event context for account binding and SDK send queue for replies.
- [ ] Remove direct `QqbotSendService` usage.

### Task 5.4: Verify Batch 5

- [ ] Run:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand --runTestsByPath test/modules/qqbot/architecture/qqbot-plugin-package-boundary.spec.ts test/modules/qqbot/plugins/ff14-market test/modules/qqbot/plugins/fflogs test/modules/qqbot/plugins/repeater test/modules/qqbot/plugin-platform/plugin-lifecycle-runtime.spec.ts test/modules/qqbot/core/qqbot-core-plugin-ports.spec.ts
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
```

- [ ] Run local `/qqbot/command/test` smoke for one FF14 command and one FFLogs command.
- [ ] Run local event dispatcher smoke for Repeater.

### Task 5.5: Commit Batch 5

- [ ] Run `git diff --check` and KT global review.
- [ ] Commit:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add src/modules/qqbot/plugins/ff14-market src/modules/qqbot/plugins/fflogs src/modules/qqbot/plugins/repeater test/modules/qqbot/plugins test/modules/qqbot/architecture sql/refactor-v3 docs/refactor-v3 API.md
git -C D:\MyFiles\KT\Node\kt-template-online-api add -u src/modules/qqbot/plugins/ff14-market
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "refactor: 规范化QQBot内置插件包"
```

## Batch 6: NapCat Runtime Persistence And Login Flow

### Task 6.1: Rebuild NapCat persistence model

**Files:**

- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\napcat\infrastructure\persistence\**`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\sql\refactor-v3\00-full-schema.sql`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\sql\refactor-v3\01-seed-core.sql`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\sql\refactor-v3\99-verify.sql`

- [ ] Use target tables:
  - `napcat_container`
  - `napcat_device_identity`
  - `napcat_account_binding`
  - `napcat_login_session`
  - `napcat_login_challenge`
  - `napcat_runtime_cleanup`
- [ ] Keep legacy `qqbot_account_napcat` compatibility only through migration/adapter code until schema and online data are rebuilt.
- [ ] Persist container name, data dir, hostname, machine-id path, MAC, account binding, verification state, last login evidence, session state, challenge state, cleanup state, and error notice.
- [ ] Treat in-memory session as SSE listener cache only.

### Task 6.2: Split NapCat application and integration

**Files:**

- Modify: `src/modules/qqbot/napcat/contract/**`
- Modify: `src/modules/qqbot/napcat/application/**`
- Modify: `src/modules/qqbot/napcat/domain/**`
- Modify: `src/modules/qqbot/napcat/infrastructure/integration/**`

- [ ] Contract owns scan/create, scan/refresh, scan/status, captcha submit, SSE events, account runtime status, and route compatibility.
- [ ] Application owns login session use cases, container use cases, account binding use cases, and cleanup use cases.
- [ ] Domain owns quick/password/captcha/new-device/manual QR state machine and cleanup blocking rules.
- [ ] Integration owns NapCat WebUI client, Docker/SSH adapter, container log reader, QR/captcha/new-device API adapter.
- [ ] Docker/SSH shell construction appears only in `infrastructure/integration`.

### Task 6.3: Implement new-device API chain

**Files:**

- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\napcat\infrastructure\integration\napcat-login-api.client.ts`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\napcat\application\**`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\napcat\contract\**`

- [ ] Implement methods:

```ts
getNewDeviceQRCode(sessionId: string): Promise<NewDeviceQrCode>
pollNewDeviceQR(sessionId: string): Promise<NewDeviceQrStatus>
newDeviceLogin(sessionId: string): Promise<NewDeviceLoginResult>
```

- [ ] Map states:

```text
qr-pending -> scanned -> confirming -> verified
```

- [ ] If upstream only returns `jumpUrl`, convert it into a QR code payload for Admin while preserving the original URL as audit evidence.
- [ ] Keep captcha and new-device challenges separate.
- [ ] Keep cleanup failure as a blocker for success and QR fallback.

### Task 6.4: Verify Batch 6

- [ ] Run:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand --runTestsByPath test/modules/qqbot/napcat/device-identity.spec.ts test/modules/qqbot/napcat/login-state-machine.spec.ts test/modules/qqbot/napcat/new-device-flow.spec.ts test/modules/qqbot/napcat/napcat-persistent-login-state.spec.ts test/modules/qqbot/architecture/qqbot-module-boundary.spec.ts
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
```

- [ ] Run local simulated NapCat smoke proving:
  - same account rebuild reuses data directory, hostname, machine-id path, and MAC
  - captcha challenge remains pending across polling
  - new-device QR uses `GetNewDeviceQRCode`
  - scan status transitions to scanned and confirming
  - `NewDeviceLogin` completes
  - cleanup failure blocks success

### Task 6.5: Commit Batch 6

- [ ] Run `git diff --check` and KT global review.
- [ ] Commit:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add src/modules/qqbot/napcat test/modules/qqbot/napcat test/modules/qqbot/architecture sql/refactor-v3 docs/refactor-v3 API.md README.md
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "feat: 重建NapCat设备与登录运行时"
```

## Batch 7: Admin QQBot Boundary Sync

### Task 7.1: Split Admin API callers

**Files:**

- Modify: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\api\qqbot\index.ts`
- Create: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\api\qqbot\plugin.ts`
- Create: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\api\qqbot\napcat.ts`

- [ ] `index.ts` keeps core account, command, rule, message, send log, and dashboard callers.
- [ ] `plugin.ts` owns capability page/list, installation lifecycle, manifest/package actions, runtime events, account bindings, config, and plugin operations.
- [ ] `napcat.ts` owns login/session/device/SSE/captcha/new-device callers.
- [ ] Add focused Vitest coverage for response wrappers, pagination, SSE event normalization, and QR/captcha/new-device state mapping.

### Task 7.2: Split Admin pages by state domain

**Files:**

- Modify/create under `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\views\qqbot\**`
- Modify: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\router\routes\modules\qqbot.ts`

- [ ] Core pages own account, command, rule, message, send queue, and dashboard state.
- [ ] Plugin Platform pages own capability list, installation lifecycle, runtime events, account bindings, manifest/package actions, and config drawers.
- [ ] NapCat pages own account login, scan status, captcha, new-device QR, and runtime state.
- [ ] Keep route pages with a single stable root element.
- [ ] Use Chinese progress labels for:

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

- [ ] Render captcha and new-device QR as separate states.
- [ ] Do not clear a captcha URL only because a later status response omits the URL.

### Task 7.3: Verify Batch 7

- [ ] Run:

```powershell
pnpm --dir D:\MyFiles\KT\Vue\kt-template-admin -F @vben/web-antdv-next exec vitest run apps/web-antdv-next/src/api/qqbot
pnpm --dir D:\MyFiles\KT\Vue\kt-template-admin -F @vben/web-antdv-next run typecheck
```

- [ ] Start or reuse Admin dev server and API local service.
- [ ] Use in-app browser smoke for:
  - `/qqbot/plugin`
  - `/qqbot/command`
  - account login/NapCat login view
- [ ] Confirm browser console has no page render errors, route-switch blank page warnings, or API caller shape errors.

### Task 7.4: Commit Batch 7

- [ ] Run `git diff --check` and KT global review for Admin.
- [ ] Commit:

```powershell
git -C D:\MyFiles\KT\Vue\kt-template-admin add apps/web-antdv-next/src/api/qqbot apps/web-antdv-next/src/views/qqbot apps/web-antdv-next/src/router/routes/modules/qqbot.ts
git -C D:\MyFiles\KT\Vue\kt-template-admin commit -m "refactor: 收敛QQBot管理页面边界"
```

## Batch 8: Delete Obsolete Code And Governance Sync

### Task 8.1: Remove obsolete API code

**Files:**

- API QQBot files under `src/modules/qqbot/**`
- Tests under `test/modules/qqbot/**`
- Docs under `docs/refactor-v3/**`, `API.md`, `README.md`

- [ ] Remove any empty or obsolete buckets left by the refactor.
- [ ] Remove old plugin compatibility code after tests prove manifest legacy alias support works.
- [ ] Remove old tests that only protect old folder shapes.
- [ ] Keep compatibility routes only at contract/controller boundary.
- [ ] Run:

```powershell
rg -n "bangDream|ff14Market|QqbotBangDream|QqbotFf14|QqbotFflogs|QqbotRepeater|src/modules/qqbot/plugins/.*/qqbot-.*\\.plugin|src/modules/qqbot/plugins/.*/qqbot-.*\\.service" D:\MyFiles\KT\Node\kt-template-online-api\src D:\MyFiles\KT\Node\kt-template-online-api\test
```

Expected: no old runtime implementation references; only explicit legacy alias fixtures or compatibility tests remain.

### Task 8.2: Sync durable rules and task context

**Files:**

- Modify: `D:\MyFiles\KT\AGENTS.md`
- Modify: `D:\MyFiles\KT\TASKS.md`

- [ ] Replace stale BangDream stable-runtime guidance that allowed old `bangDream` business bucket structure.
- [ ] Add the new durable rule: built-in QQBot plugins use platform package structure and key names `bangdream`, `ff14-market`, `fflogs`, `repeater`.
- [ ] Record the completed architecture convergence batches and validation evidence in `TASKS.md` using short scope/keywords/verification text.

### Task 8.3: Verify Batch 8

- [ ] Run:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand --runTestsByPath test/modules/qqbot/architecture/qqbot-module-boundary.spec.ts test/modules/qqbot/architecture/qqbot-plugin-package-boundary.spec.ts test/modules/qqbot/plugin-platform/plugin-lifecycle-runtime.spec.ts test/modules/qqbot/plugins/bangdream-rewrite/bangdream-operation-parity.spec.ts test/modules/qqbot/napcat/napcat-persistent-login-state.spec.ts
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
pnpm --dir D:\MyFiles\KT\Vue\kt-template-admin -F @vben/web-antdv-next run typecheck
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run global-review -- --project api --content-scan-mode changed
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run global-review -- --project admin --content-scan-mode changed
```

### Task 8.4: Commit Batch 8

- [ ] Commit API cleanup:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add src/modules/qqbot test/modules/qqbot docs/refactor-v3 API.md README.md
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "refactor: 清理QQBot旧架构代码"
```

- [ ] Commit root governance:

```powershell
git -C D:\MyFiles\KT add AGENTS.md TASKS.md
git -C D:\MyFiles\KT commit -m "docs: 更新QQBot插件架构规则"
```

## Batch 9: Local Full Closure

### Task 9.1: API local verification

- [ ] Run:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api status --short --branch
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand --runTestsByPath test/modules/qqbot/architecture/qqbot-module-boundary.spec.ts test/modules/qqbot/architecture/qqbot-plugin-package-boundary.spec.ts test/modules/qqbot/core/qqbot-core-plugin-ports.spec.ts test/modules/qqbot/plugin-platform/plugin-lifecycle-runtime.spec.ts test/modules/qqbot/plugins/bangdream-rewrite/bangdream-operation-parity.spec.ts test/modules/qqbot/napcat/napcat-persistent-login-state.spec.ts
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest --runInBand
git -C D:\MyFiles\KT\Node\kt-template-online-api diff --check
```

### Task 9.2: API local real interface smoke

- [ ] Start or reuse a bounded local API service.
- [ ] Smoke:
  - `GET /health/runtime`
  - `GET /qqbot/plugin/operation/page`
  - `GET /qqbot/plugin/operation/list`
  - plugin install/enable/disable with local smoke package
  - `/qqbot/command/test` for BangDream
  - `/qqbot/command/test` for FF14 or FFLogs
  - simulated Repeater event dispatch
  - NapCat scan status and new-device simulated flow
- [ ] Save generated evidence under `.kt-workspace/test-artifacts`.
- [ ] Stop only Node/API processes started for this validation.

### Task 9.3: Admin local verification and browser smoke

- [ ] Run:

```powershell
git -C D:\MyFiles\KT\Vue\kt-template-admin status --short --branch
pnpm --dir D:\MyFiles\KT\Vue\kt-template-admin -F @vben/web-antdv-next exec vitest run apps/web-antdv-next/src/api/qqbot
pnpm --dir D:\MyFiles\KT\Vue\kt-template-admin -F @vben/web-antdv-next run typecheck
git -C D:\MyFiles\KT\Vue\kt-template-admin diff --check
```

- [ ] Use browser smoke for QQBot plugin platform page, command page, and NapCat login page.
- [ ] Stop only Vite/Admin processes started for this validation.

### Task 9.4: Documentation, cleanup, review, and commit status

- [ ] Run:

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run cleanup-history -- --dry-run
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run global-review -- --project api --content-scan-mode changed
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run global-review -- --project admin --content-scan-mode changed
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run global-review -- --project root --content-scan-mode changed
```

- [ ] Use KT workflow `KT global review` before claiming local closure.
- [ ] Resolve real Important findings and re-run focused review.

## Batch 10: Push, Deploy Observation, And Online Closure

### Task 10.1: Push implementation branches

- [ ] Confirm current branch and commits:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api status --short --branch
git -C D:\MyFiles\KT\Vue\kt-template-admin status --short --branch
git -C D:\MyFiles\KT status --short --branch
```

- [ ] Push API and Admin branches:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api push -u origin dev-api-architecture-convergence-v3
git -C D:\MyFiles\KT\Vue\kt-template-admin push -u origin dev-admin-architecture-convergence-v3
```

### Task 10.2: Observe Jenkins and K8s

- [ ] Observe API deployment with the stabilized workflow:

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run deploy-observation -- --project api --job KT-Template/KT-Template-API/main --execute
```

- [ ] Collect:
  - Jenkins build number
  - source commit hash
  - image tag
  - Deployment generation and observedGeneration
  - desired, updated, ready counts
  - selected Pod image
  - restart count
  - logs/events when failing
- [ ] Observe Admin deployment with the corresponding Jenkins/K8s evidence path used in the repo.

### Task 10.3: Online DB and seed alignment

- [ ] Before any write, state:
  - source DB
  - target DB
  - backup path under `.kt-workspace/db-sync`
  - rollback command
  - SQL scripts to apply
  - verification query set
- [ ] Backup online database.
- [ ] Apply schema/seed only after backup succeeds.
- [ ] Run verification SQL:

```powershell
mysql ... < D:\MyFiles\KT\Node\kt-template-online-api\sql\refactor-v3\99-verify.sql
```

### Task 10.4: Online functional smoke

- [ ] Smoke online:
  - `/health/runtime`
  - Admin login
  - Admin menu
  - QQBot plugin operation page/list
  - plugin install/enable/health on a controlled test package
  - `/qqbot/command/test` using operationKey-derived command ID and full command text
  - one BangDream operation that returns image output
  - one non-BangDream plugin operation
  - NapCat real account login flow
- [ ] If new-device appears, evidence must include:

```text
GetNewDeviceQRCode -> PollNewDeviceQR -> NewDeviceLogin
```

- [ ] Strip `replyText` from online QQBot smoke summaries.
- [ ] Pull back image smoke output under `.kt-workspace/test-artifacts` when image output is tested.

### Task 10.5: Final closeout

- [ ] Run:

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run cleanup-history -- --dry-run
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run self-test
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run global-review -- --project api --content-scan-mode changed
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run global-review -- --project admin --content-scan-mode changed
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run global-review -- --project root --content-scan-mode changed
```

- [ ] Run KT workflow `KT completion audit`.
- [ ] Run KT workflow `KT branch closeout`.
- [ ] Report final evidence with:
  - API/Admin/root commit hashes
  - pushed branch names
  - Jenkins/K8s deployment evidence
  - online smoke evidence
  - NapCat real account outcome
  - remaining risk if any check is blocked by external state

## Cross-Batch Review Rules

- Every batch that changes code runs `git diff --check`.
- Every batch that changes API/Admin contracts updates `API.md`, `docs/refactor-v3/**`, SQL seed/schema, Admin caller, and tests in the same or immediately following batch.
- Every batch commit is preceded by KT global review for the changed repo.
- After implementation batches, use KT workflow `KT global review` before claiming the batch done.
- If review reports a real Important issue, fix and re-run the relevant review before commit.
- If a reviewer reports a false positive caused by workflow rules, solidify the false-positive handling in `mcp/ktWorkflow` instead of leaving it as chat context.

## Plan Self-Review

| Approved Requirement | Plan Coverage |
| --- | --- |
| core/plugin-platform/napcat third-phase structure | Batches 1, 2, 6, 8 |
| Core cannot depend on concrete plugins | Batches 1, 2 |
| Plugin Platform owns runtime/lifecycle/registry/SDK | Batch 3 |
| Unified plugin package structure | Batches 1, 3, 4, 5, 8 |
| BangDream full rewrite and 15 operation parity | Batch 4 |
| FF14 Market, FFLogs, Repeater rewrite | Batch 5 |
| NapCat persistent device/session/challenge/cleanup | Batch 6 |
| New-device flow uses `GetNewDeviceQRCode -> PollNewDeviceQR -> NewDeviceLogin` | Batch 6 and Batch 10 |
| Admin caller/page boundary split and Chinese progress | Batch 7 |
| Schema/table redesign and verification | Batches 3, 4, 5, 6, 10 |
| Local tests, local interface smoke, browser smoke | Batch 9 |
| Push, Jenkins/K8s, online command and NapCat account closure | Batch 10 |
| Existing dirty baseline preserved before rewrite | Batch 0 |

## Implementation Entry

Start execution with KT workflow `KT batch execution`. Use subagents only for independent read-only audit or code-review work with a Context Packet. Main-thread implementation should begin at Batch 0 and must not skip RED gates in Batch 1.
