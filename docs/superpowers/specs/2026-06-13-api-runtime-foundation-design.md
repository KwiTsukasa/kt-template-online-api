# API Runtime Foundation Design

## Background

The API project has grown into several runtime-heavy domains: Admin, Blog,
WordPress, QQBot, MinIO, Loki logging, Jenkins/K8s deployment, and NAS-hosted
NapCat containers. The current module layout works, but reliability behavior is
spread across large services and scripts.

The most visible pressure points are:

- `src/qqbot/account/qqbot-napcat-login.service.ts` mixes session state, SSE
  events, quick login, password login, captcha, QR code fallback, cleanup, and
  NapCat WebUI calls.
- `src/qqbot/napcat/qqbot-napcat-container.service.ts` mixes database container
  state, SSH process execution, Docker script generation, runtime status checks,
  and NapCat WebUI requests.
- `src/wordpress/wordpress.service.ts` mixes WordPress auth, request transport,
  data normalization, markdown conversion, public article reads, and theme
  integration.
- Runtime configuration is read directly through `ConfigService.get(...)` in
  many services, with required keys, defaults, timeouts, and secret masking
  handled locally.
- Jenkins/K8s deployment already builds and rolls out the API, but post-rollout
  evidence still depends on manual observation and task-specific smoke commands.

The user selected the API-wide refactor priority as:

1. Runtime reliability.
2. Module boundaries.
3. Contract stability.
4. Testability.

The user also selected a combined path: first implement the API runtime
foundation, then extend that line into ktWorkflow/Jenkins/K8s automated
observation.

## Goal

Build an API Runtime Foundation that centralizes configuration, external
runtime calls, health reporting, cleanup semantics, and verification evidence,
then use NapCat and Jenkins/K8s as the first end-to-end reliability samples.

## Non-Goals

- Do not rewrite every API business module in the first phase.
- Do not migrate all Admin, Blog, WordPress, MinIO, QQBot, and common contracts
  at once.
- Do not replace existing Vben response wrappers or public API shapes during the
  runtime foundation phase unless a sample integration requires a narrow
  compatibility change.
- Do not bypass QQ or Tencent security checks. Captcha and new-device
  verification stay user-driven.
- Do not commit real secrets, backend `.env.development`, backend
  `.env.production`, database passwords, SSH keys, tokens, or production
  Kubernetes Secrets.

## Scope

This spec covers the first API-wide subproject:

- Add a runtime foundation inside the API project.
- Connect that foundation to two sample runtime paths:
  - API deployment observation through Jenkins/K8s and ktWorkflow.
  - QQBot NapCat runtime and login reliability.
- Create guardrails so future refactors move from runtime reliability into
  module boundaries, contract stability, and testability without large,
  unrelated rewrites.

Future subprojects should receive their own Superpowers specs:

- API module boundary refactor.
- API contract and DTO stability.
- API testability and large-service decomposition.

## Architecture

### Runtime Foundation Layer

Create a focused runtime layer rather than expanding `common` into a larger
utility bucket. The layer owns operational concerns, while business modules keep
domain state and user-facing behavior.

Proposed package boundary:

```text
src/runtime/
  runtime.module.ts
  config/
  client/
  health/
  evidence/
  cleanup/
  errors/
```

The exact file split can change during implementation, but each unit must have
one responsibility and a clear consumer:

- Runtime config is consumed by API modules and adapters.
- Runtime clients are consumed by integration adapters, not controllers.
- Runtime health is consumed by health controllers and deployment smoke.
- Runtime evidence is consumed by scripts, ktWorkflow, and final task records.
- Runtime cleanup is consumed by integration adapters that create temporary
  runtime state.

### RuntimeConfigModule

`RuntimeConfigModule` provides typed config profiles for the runtime paths that
matter first:

- app and HTTP server settings.
- database connection metadata needed for health checks.
- Loki logging and query settings.
- WordPress integration settings.
- MinIO integration settings.
- QQBot and NapCat runtime settings.
- Jenkins/K8s smoke observation settings where they are needed by scripts.

Each profile must provide:

- typed values with normalized number and boolean parsing.
- required key validation.
- safe defaults where the current project already has stable defaults.
- secret masking for logs, health output, evidence files, and review output.
- a safe snapshot method that never returns raw passwords, tokens, private keys,
  or secret values.

`ConfigService.get(...)` may remain in untouched legacy code during migration,
but new runtime code should consume typed config profiles.

### RuntimeHttpClient and RuntimeProcessClient

External calls should flow through runtime clients instead of ad hoc
`fetch`, `http.request`, `https.request`, or `spawn` logic.

`RuntimeHttpClient` handles:

- request timeout.
- operation name.
- safe target summary.
- duration.
- status code.
- response parsing failures.
- classified errors.

`RuntimeProcessClient` handles:

- bounded process execution.
- command family and safe argument summaries.
- stdin script support for NAS SSH here-string workflows.
- duration and exit code.
- timeout classification.
- stdout/stderr truncation for safe evidence.

These clients do not know domain rules. They return transport-level results that
adapters translate into domain state.

### RuntimeHealthService

Add a machine-readable runtime health endpoint such as:

```text
GET /health/runtime
```

The endpoint should support at least these states:

- `live`: the process is running and can answer HTTP requests.
- `ready`: critical dependencies and required config are available.
- `degraded`: optional dependencies are unavailable, but core API behavior can
  continue.
- `blocked`: required config is missing or a critical dependency is unavailable.

Initial probes should be lightweight. They should not perform destructive work
or expensive business operations. The first implementation can keep the existing
K8s TCP readiness probe and let Jenkins/ktWorkflow call `/health/runtime`.
Switching the Kubernetes readiness probe to HTTP should happen only after the
endpoint proves stable online.

### RuntimeEvidenceService

Runtime evidence should be emitted as structured JSON under
`.kt-workspace/test-artifacts/...` and summarized in final reports.

Evidence records should include:

- title and task type.
- target project and environment.
- command or endpoint name.
- safe target summary.
- start time, end time, and duration.
- result status.
- classified error when present.
- validation assertions.
- cleanup result.

Evidence must not include full logs, raw tokens, raw passwords, SSH keys, full
base64 image payloads, or production Secret values.

### RuntimeCleanup Semantics

Cleanup must be explicit and reportable. Runtime operations that create
temporary state must return cleanup results instead of burying cleanup failure in
logs.

For NapCat, cleanup failure includes:

- failing to remove runtime login password environment variables.
- failing to clean temporary SSH scripts or runtime artifacts started by this
  task.
- failing to preserve or verify required persistent device state.

Cleanup failure must not be overwritten by ordinary offline or login-failed
messages.

### NapCatRuntimeAdapter

NapCat becomes the first domain adapter for the runtime foundation.

It should own runtime concerns that currently sit inside large QQBot services:

- SSH/Docker script execution through `RuntimeProcessClient`.
- Docker device identity persistence.
- NapCat WebUI calls through `RuntimeHttpClient`.
- timeout and retry classification.
- safe runtime evidence for container rebuilds, captcha, new-device verification,
  and cleanup.

The QQBot account/login services should keep domain state:

- account binding.
- login session lifecycle.
- SSE progress.
- expected selfId checks.
- success and failure messages.

The adapter must support the confirmed NapCat upstream new-device flow:

1. `PasswordLogin` or `CaptchaLogin` returns `needNewDevice`, `jumpUrl`, and
   `newDevicePullQrCodeSig`.
2. API calls `GetNewDeviceQRCode` with `uin` and `jumpUrl`.
3. API keeps the same scan session pending and exposes a user-facing new-device
   QR state through SSE/Admin.
4. API polls `PollNewDeviceQR` using `bytesToken`.
5. When the user confirms the QR, API calls `NewDeviceLogin` with `uin`,
   `passwordMd5`, and `newDevicePullQrCodeSig`.
6. API checks login state, cleans runtime password state, binds the account, and
   records evidence.

### DeployObservationAdapter

Deployment observation starts from ktWorkflow and can reuse API evidence
formats. It should collect:

- Jenkins job and build number.
- commit hash.
- image tag.
- Kubernetes Deployment generation and observedGeneration.
- updated and ready replica counts.
- running Pod selected by image tag.
- restart count.
- recent Pod logs or events when failing.
- `/health/runtime` response.
- task-specific smoke result.

Rollout success alone is deployment evidence, not functional success.

## Data Flow

The target flow is:

```text
Controller or script
  -> business service
  -> domain adapter
  -> runtime config/client/cleanup/health/evidence
  -> external system
```

External results flow back as:

```text
external system result
  -> runtime client classification
  -> domain adapter translation
  -> business service state update
  -> controller/SSE/API response
  -> runtime evidence summary
```

For NapCat login, that means:

```text
Admin refresh login
  -> QqbotNapcatLoginService session state
  -> NapCatRuntimeAdapter
  -> RuntimeProcessClient for Docker/SSH
  -> RuntimeHttpClient for NapCat WebUI
  -> classified status
  -> SSE Chinese progress and scan/status response
  -> runtime evidence
```

For deployment observation, that means:

```text
push/commit
  -> Jenkins build and K8s rollout
  -> ktWorkflow DeployObservationAdapter
  -> Kubernetes and health checks
  -> task smoke
  -> runtime evidence
  -> closeout decision
```

## Error Model

Runtime errors should be classified before business code decides the user-facing
message.

### `config_error`

Required configuration is missing, dangerous, or unreadable.

Examples:

- missing database host.
- missing explicit QQBot account secret.
- missing NapCat SSH target.
- unreadable SSH key path.

Result: blocked. Do not claim deploy or runtime success.

### `dependency_unavailable`

The external dependency is unreachable or not authorized.

Examples:

- WordPress timeout.
- Loki query timeout.
- NapCat WebUI unavailable.
- SSH command timeout.

Result: degraded or blocked, depending on dependency criticality.

### `operation_failed`

The dependency is reachable but the business operation did not complete.

Examples:

- NapCat requires captcha.
- NapCat requires new-device verification.
- QQ account mismatch.
- WordPress returns an upstream validation error.

Result: domain service keeps pending, returns a business error, or falls back
according to its state machine.

### `cleanup_failed`

Primary work may have completed or partially completed, but cleanup failed.

Examples:

- `NAPCAT_QUICK_PASSWORD` could not be removed.
- temporary runtime evidence could not be cleaned.
- a remote temporary file created by this run remains.

Result: block success reporting until the cleanup failure is handled or reported
as a stable blocker.

## Phased Delivery

### Phase 1: Runtime Foundation Skeleton

Create the runtime module, typed config profiles, health types, evidence types,
and lightweight `/health/runtime` endpoint.

Initial validation:

- targeted Jest for config parsing, masking, health state aggregation, and
  evidence serialization.
- `pnpm run typecheck`.
- one real local or reused-service request to `/health/runtime` when the
  endpoint exists.

### Phase 2: Deployment Observation Foundation

Add ktWorkflow/Jenkins/K8s observation support that can use the new health and
evidence format.

Initial validation:

- ktWorkflow typecheck and self-test.
- dry-run or read-only deploy observation against the current API deployment.
- evidence written under `.kt-workspace/test-artifacts`.

### Phase 3: NapCat Runtime Adapter Sample

Refactor the NapCat runtime boundary around device persistence, WebUI calls,
new-device QR flow, runtime password cleanup, and SSH/Docker evidence.

Required behavior:

- Docker container rebuild preserves device identity files:
  - `$DATA_DIR/QQ` mounted to `/app/.config/QQ`.
  - `$DATA_DIR/device.env` stores stable MAC and hostname.
  - `$DATA_DIR/machine-id` mounts to `/etc/machine-id:ro`.
  - Docker run uses `--mac-address` and `--hostname`.
- Reset login state must not delete `device.env` or `machine-id`.
- Captcha and new-device verification keep the same scan session pending.
- New-device verification follows `GetNewDeviceQRCode -> PollNewDeviceQR ->
  NewDeviceLogin`.
- SSE/Admin progress remains Chinese and user-facing:
  - quick login.
  - password login.
  - captcha required.
  - new-device QR generated.
  - scanned.
  - confirming.
  - success or failure.
- Runtime login password cleanup failure blocks success.

Initial validation:

- targeted Jest around NapCat device persistence and new-device login flow.
- API typecheck.
- local or reused service request for changed login endpoints.
- online account smoke after push and rollout.

### Phase 4: Boundary Ratchet

Add guardrails so future runtime work uses the foundation.

Guardrails:

- new external integration code should not directly scatter
  `ConfigService.get(...)` without a typed runtime profile.
- new runtime calls should use runtime clients or justify why not.
- new deployment completion claims should include rollout, health, and smoke
  evidence.
- new cleanup-sensitive flows should return cleanup evidence.

Validation:

- ktWorkflow global review rule updates.
- ktWorkflow self-test.
- documentation sync for README/API/docs/TASKS/Obsidian entries as required.

## Verification Strategy

Verification scales with risk:

- docs-only spec commit: self-review, `git diff --check`, and scoped review.
- runtime foundation code: targeted Jest and typecheck.
- interface changes: real local or reused-service request.
- deployment automation: read-only observation or dry run first, then online
  observation after push.
- NapCat runtime changes: targeted Jest, real API request, Jenkins/K8s rollout,
  and online account smoke.

Completion of the full workstream requires:

- KT documentation sync.
- cleanup-history final `deleted=[]` evidence when artifacts are produced.
- KT global review with no blocking findings.
- Superpowers code review evidence.
- ktWorkflow closeout evidence.

## Worktree Cleanliness

The earlier NapCat half-implementation draft was explicitly abandoned before
this spec was committed. Future implementation work should start from a clean
API worktree, apart from committed design and planning documents. If new local
changes appear before implementation starts, inspect and classify them before
editing.

## Acceptance Criteria

The first implementation plan is ready when it can produce these outcomes in
order:

1. API has a runtime foundation skeleton with typed config, health, evidence,
   and classified error primitives.
2. Jenkins/K8s/ktWorkflow can observe a deployment using the shared evidence
   shape.
3. NapCat login and container runtime become the first real adapter sample.
4. Online verification proves rollout, health, and at least one real runtime
   smoke path.
5. The next API refactor phase can start from module boundaries rather than
   re-solving runtime reliability.
