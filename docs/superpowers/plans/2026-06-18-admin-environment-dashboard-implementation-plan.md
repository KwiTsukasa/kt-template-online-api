# Admin Environment Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Admin `/dashboard/analytics` 改造成多站点环境状态总览总控面板，覆盖本机开发、NAS 线上、腾讯云、r4se 远程环境，并明确展示未接入证据，第一版只做观测与只读自检，不提供高风险写操作。

**Architecture:** 后端在 API `admin/platform-config` 下新增环境面板聚合模块，以 `Site -> Node -> Service -> Signal` 为统一模型；HTTP dashboard/self-check 负责状态快照和只读兜底，平台级 EnvironmentEventBus 通过 local/mqtt 模式收口 topic 事件并驱动 recent events 与 cache invalidation；内部服务信号从现有 Nest 服务读取，远程信号通过只读适配器读取 Jenkins、Kubernetes、Tencent Cloud、Caddy、WireGuard、OpenClash/Mihomo；前端保留 Vben Dashboard 路由，替换为 A 方案布局：顶部状态条、左侧站点栏、中间拓扑、右侧证据/动作抽屉、底部事件流。

**Tech Stack:** NestJS、TypeScript、TypeORM、axios、mqtt、tencentcloud-sdk-nodejs、Vben Admin、Vue 3、antdv-next、Vitest/Jest、Playwright 轻量页面烟测。

---

## Source Spec

- `D:\MyFiles\KT\Node\kt-template-online-api\docs\superpowers\specs\2026-06-18-admin-environment-dashboard-design.md`
- 当前确认的页面方向：方案 A `Site Command Center`
- 第一版能力边界：观测与只读自检；重启、部署、迁移、重建容器、插件启停、任务立即执行、Caddy/OpenClash 改配置等动作必须展示为禁用。

## File Structure Map

### API Repo

- `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\admin\platform-config\environment-dashboard\domain\environment-dashboard.types.ts`
- `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\admin\platform-config\environment-dashboard\application\environment-dashboard-status.mapper.ts`
- `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\admin\platform-config\environment-dashboard\application\environment-dashboard-action.catalog.ts`
- `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\admin\platform-config\environment-dashboard\application\environment-event.materializer.ts`
- `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\admin\platform-config\environment-dashboard\application\environment-dashboard.service.ts`
- `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\admin\platform-config\environment-dashboard\application\environment-dashboard-self-check.service.ts`
- `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\admin\platform-config\environment-dashboard\infrastructure\environment-dashboard-config.service.ts`
- `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\admin\platform-config\environment-dashboard\infrastructure\environment-dashboard-cache.service.ts`
- `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\admin\platform-config\environment-dashboard\infrastructure\environment-dashboard-evidence.mapper.ts`
- `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\admin\platform-config\environment-dashboard\infrastructure\event\environment-event-bus.service.ts`
- `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\admin\platform-config\environment-dashboard\infrastructure\event\environment-mqtt-topic.catalog.ts`
- `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\admin\platform-config\environment-dashboard\infrastructure\event\qqbot-environment-event.bridge.ts`
- `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\admin\platform-config\environment-dashboard\infrastructure\adapters\environment-readonly-http.client.ts`
- `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\admin\platform-config\environment-dashboard\infrastructure\adapters\jenkins-readonly.adapter.ts`
- `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\admin\platform-config\environment-dashboard\infrastructure\adapters\kubernetes-readonly.adapter.ts`
- `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\admin\platform-config\environment-dashboard\infrastructure\adapters\tencent-cloud-readonly.adapter.ts`
- `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\admin\platform-config\environment-dashboard\infrastructure\adapters\caddy-readonly.adapter.ts`
- `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\admin\platform-config\environment-dashboard\infrastructure\adapters\wireguard-readonly.adapter.ts`
- `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\admin\platform-config\environment-dashboard\infrastructure\adapters\mihomo-readonly.adapter.ts`
- `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\admin\platform-config\environment-dashboard\infrastructure\collectors\local-dev-signal.collector.ts`
- `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\admin\platform-config\environment-dashboard\infrastructure\collectors\nas-prod-signal.collector.ts`
- `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\admin\platform-config\environment-dashboard\presentation\environment-dashboard.controller.ts`
- `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\admin\platform-config\environment-dashboard\presentation\dto\environment-dashboard.dto.ts`
- `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\admin\platform-config\admin-platform-config.module.ts`
- `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\core\qqbot-core.module.ts`
- `D:\MyFiles\KT\Node\kt-template-online-api\src\modules\qqbot\plugin-platform\qqbot-plugin-platform.module.ts`
- `D:\MyFiles\KT\Node\kt-template-online-api\.env.example`
- `D:\MyFiles\KT\Node\kt-template-online-api\README.md`
- `D:\MyFiles\KT\Node\kt-template-online-api\API.md`
- `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\admin\environment-dashboard\*.spec.ts`

### Admin Repo

- `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\api\system\environment.ts`
- `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\views\dashboard\analytics\index.vue`
- `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\views\dashboard\analytics\components\EnvironmentStatusBar.vue`
- `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\views\dashboard\analytics\components\EnvironmentSiteRail.vue`
- `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\views\dashboard\analytics\components\EnvironmentTopology.vue`
- `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\views\dashboard\analytics\components\EnvironmentEvidencePanel.vue`
- `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\views\dashboard\analytics\components\EnvironmentEventStream.vue`
- `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\views\dashboard\analytics\types.ts`
- `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\views\dashboard\analytics\environment-dashboard.spec.tsx`
- `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\api\system\environment.spec.ts`
- `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\locales\langs\zh-CN\page.json`
- `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\locales\langs\en-US\page.json`

## Data Contract

The API response uses stable IDs so Admin can preserve selection across refreshes.

```ts
export type EnvironmentHealthStatus =
  | 'ok'
  | 'degraded'
  | 'down'
  | 'blocked'
  | 'isolated'
  | 'unknown'
  | 'unwired';

export type EnvironmentSiteStatus = 'online' | 'degraded' | 'isolated' | 'unknown';

export type EnvironmentSignalSourceKind =
  | 'live'
  | 'cached'
  | 'derived'
  | 'configured'
  | 'external-link'
  | 'unwired';

export interface EnvironmentDashboardResponse {
  generatedAt: string;
  refreshedAt: string;
  summary: EnvironmentDashboardSummary;
  sites: EnvironmentSite[];
  topology: EnvironmentTopology;
  actions: EnvironmentAction[];
  events: EnvironmentEvent[];
}

export interface EnvironmentEventEnvelope {
  eventId: string;
  topic: string;
  siteId: string;
  nodeId?: string;
  serviceId?: string;
  signalId?: string;
  severity: EnvironmentHealthStatus;
  sourceKind: 'local' | 'mqtt' | EnvironmentSignalSourceKind;
  observedAt: string;
  expiresAt?: string;
  retained?: boolean;
  summary: string;
  evidence?: EnvironmentEvidence[];
}
```

Severity aggregation order is fixed:

```ts
const severityWeight: Record<EnvironmentHealthStatus, number> = {
  ok: 0,
  unwired: 1,
  unknown: 1,
  degraded: 2,
  isolated: 3,
  down: 4,
  blocked: 5,
};
```

## Execution Rules

- Work on development branches in each touched repo; do not create `.worktree` directories.
- No backend `.env.development`, `.env.production`, real token, SSH key, cloud secret, Jenkins token, kube token, or database password may be committed.
- Every new or touched function/method/hook/event handler/exported arrow function must include JSDoc explaining purpose, parameter origin, return semantics, and side effects when present.
- High-risk actions are represented by disabled action records with `enabled: false` and `disabledReason`; controller must reject execution paths because this plan does not add a generic write-action endpoint.
- `unwired` and `unknown` are valid product states. A missing integration must be visible evidence, not a green health badge.
- MQTT is an event layer, not the only source of truth. Retained messages require `observedAt` and `expiresAt`; expired retained messages must become `unknown` or `unwired`.
- Admin must not connect to MQTT directly. Broker credentials and internal topics stay inside API runtime.
- For interface changes, verify through a real local HTTP request against the Nest app or an already running local service.

---

## Task 0: Baseline Branches And Dependency Check

- [ ] In API repo, confirm clean state:
  ```powershell
  cd D:\MyFiles\KT\Node\kt-template-online-api
  git status --short
  git rev-parse --abbrev-ref HEAD
  ```
  Expected output: no unstaged lines; branch is `main` or an existing development branch chosen by the user.

- [ ] Create or switch API development branch:
  ```powershell
  git switch -c codex/admin-environment-dashboard
  ```
  Expected output: `Switched to a new branch 'codex/admin-environment-dashboard'`.

- [ ] In Admin repo, confirm clean state and create branch:
  ```powershell
  cd D:\MyFiles\KT\Vue\kt-template-admin
  git status --short
  git switch -c codex/admin-environment-dashboard
  ```
  Expected output: no unstaged lines, then new branch message.

- [ ] Confirm package manager and engine gates:
  ```powershell
  cd D:\MyFiles\KT\Node\kt-template-online-api
  node -v
  pnpm -v
  pnpm pkg get packageManager
  pnpm pkg get engines
  ```
  Expected output: current Node and pnpm satisfy `engines`; if not, run `nvm ls` before changing version.

- [ ] Install Tencent Cloud official SDK in API repo only when it is not already present:
  ```powershell
  cd D:\MyFiles\KT\Node\kt-template-online-api
  pnpm add tencentcloud-sdk-nodejs
  ```
  Expected output: dependency added to `package.json` and lockfile. No credential values are written.

- [ ] Confirm the existing MQTT client dependency before adding any event-bus code:
  ```powershell
  cd D:\MyFiles\KT\Node\kt-template-online-api
  rg -n '"mqtt"' package.json pnpm-lock.yaml
  ```
  Expected output: `mqtt` is already present in `package.json`; do not add a second broker/client package.

## Task 1: API Contract, Status Mapper, And RED Tests

- [ ] Create `environment-dashboard.types.ts` with domain interfaces for site/node/service/signal/action/event/topology. Include status unions from the spec and source metadata:
  ```ts
  export interface EnvironmentSignal {
    id: string;
    label: string;
    status: EnvironmentHealthStatus;
    sourceKind: EnvironmentSignalSourceKind;
    summary: string;
    evidence: EnvironmentEvidence[];
    observedAt?: string;
    staleAfterSeconds?: number;
  }
  ```

- [ ] Create `environment-dashboard-status.mapper.ts` with documented helpers:
  - `pickWorstHealthStatus(statuses)`
  - `mapSiteStatus(statuses)`
  - `countSignals(sites)`
  - `normalizeObservedAt(dateLike)`

- [ ] Add RED test `test/modules/admin/environment-dashboard/environment-dashboard-status.spec.ts`:
  ```ts
  import {
    mapSiteStatus,
    pickWorstHealthStatus,
  } from '../../../../src/modules/admin/platform-config/environment-dashboard/application/environment-dashboard-status.mapper';

  describe('environment dashboard status mapper', () => {
    it('uses blocked as the strongest signal', () => {
      expect(pickWorstHealthStatus(['ok', 'down', 'blocked'])).toBe('blocked');
    });

    it('keeps unwired integrations visible without marking a site healthy', () => {
      expect(mapSiteStatus(['ok', 'unwired'])).toBe('unknown');
    });

    it('marks isolated remote sites separately from ordinary degradation', () => {
      expect(mapSiteStatus(['ok', 'isolated'])).toBe('isolated');
    });
  });
  ```

- [ ] Run RED:
  ```powershell
  cd D:\MyFiles\KT\Node\kt-template-online-api
  pnpm exec jest --runTestsByPath test/modules/admin/environment-dashboard/environment-dashboard-status.spec.ts --runInBand
  ```
  Expected output: fails before mapper implementation is complete because module or exported functions are missing.

- [ ] Implement mapper and rerun the same command.
  Expected output: test suite passes.

## Task 2: API Action Catalog And Disabled Write Boundaries

- [ ] Create `environment-dashboard-action.catalog.ts`. It must return all supported visible actions:
  - enabled readonly: `refresh-dashboard`, `run-self-check`, `open-runtime-logs`, `open-service-route`
  - disabled high-risk: `restart-api-pod`, `trigger-jenkins-deploy`, `run-db-migration`, `recreate-napcat-container`, `toggle-plugin`, `run-plugin-task-now`, `create-minio-bucket`, `wordpress-import`, `reload-caddy`, `switch-openclash`, `restart-tencent-cvm`, `modify-wireguard-peer`

- [ ] Add `test/modules/admin/environment-dashboard/environment-dashboard-action.catalog.spec.ts` asserting disabled actions are present and all write actions have `enabled: false`.

- [ ] Run RED, implement, rerun:
  ```powershell
  cd D:\MyFiles\KT\Node\kt-template-online-api
  pnpm exec jest --runTestsByPath test/modules/admin/environment-dashboard/environment-dashboard-action.catalog.spec.ts --runInBand
  ```
  Expected output after implementation: all action catalog tests pass.

## Task 3: API Evidence Helpers And Readonly HTTP Client

- [ ] Create `environment-dashboard-evidence.mapper.ts` with functions:
  - `liveEvidence(source, summary, observedAt, metadata)`
  - `unwiredEvidence(source, missingConfigKeys, documentationPath)`
  - `errorEvidence(source, error, observedAt)`
  - `cachedEvidence(source, summary, observedAt, expiresAt)`

- [ ] Create `environment-readonly-http.client.ts` wrapping axios with:
  - GET and HEAD only
  - timeout from environment dashboard config
  - response body truncation before evidence storage
  - secret-safe header handling

- [ ] Add tests:
  - `environment-dashboard-evidence.mapper.spec.ts`
  - `environment-readonly-http.client.spec.ts`

- [ ] Run targeted tests:
  ```powershell
  cd D:\MyFiles\KT\Node\kt-template-online-api
  pnpm exec jest --runTestsByPath test/modules/admin/environment-dashboard/environment-dashboard-evidence.mapper.spec.ts test/modules/admin/environment-dashboard/environment-readonly-http.client.spec.ts --runInBand
  ```
  Expected output: tests pass; no real network access is required because axios is mocked.

## Task 3A: API Platform Event Bus And MQTT Topic Contract

- [ ] Create `infrastructure/event/environment-mqtt-topic.catalog.ts` with documented topic builders:
  - `signal(siteId, nodeId, serviceId)`
  - `event(siteId, nodeId, serviceId)`
  - `selfCheckResult(siteId)`
  - `qqbotRuntime(selfId)`
  - `qqbotNapcatLogin(selfId)`
  - `pluginTaskRun(pluginKey, taskKey)`

- [ ] Create `infrastructure/event/environment-event-bus.service.ts`:
  - supports `ENV_DASHBOARD_EVENT_BUS=local|mqtt`
  - uses `ENV_DASHBOARD_MQTT_URL`, `ENV_DASHBOARD_MQTT_CLIENT_ID`, `ENV_DASHBOARD_MQTT_USERNAME`, `ENV_DASHBOARD_MQTT_PASSWORD`, and `ENV_DASHBOARD_MQTT_TOPIC_PREFIX`
  - subscribes only to the environment dashboard topic prefix
  - publishes local events through in-process subscribers for tests and dev
  - marks broker disconnect as an environment event
  - never logs broker credentials or full payloads

- [ ] Create `application/environment-event.materializer.ts`:
  - accepts `EnvironmentEventEnvelope`
  - rejects stale retained messages when `expiresAt` is earlier than current time
  - appends safe recent events for dashboard response
  - invalidates `environment-dashboard-cache.service.ts` when a non-stale signal event arrives
  - never turns MQTT-only data into green status without fresh `observedAt` evidence

- [ ] Create `infrastructure/event/qqbot-environment-event.bridge.ts`:
  - maps QQBot/NapCat runtime events into environment event envelopes
  - depends on a narrow bus interface, not QQBot topic constants inside dashboard application code
  - does not make environment dashboard depend on `QqbotBusService` implementation details

- [ ] Add RED/GREEN tests:
  ```powershell
  cd D:\MyFiles\KT\Node\kt-template-online-api
  pnpm exec jest --runTestsByPath test/modules/admin/environment-dashboard/environment-mqtt-topic.catalog.spec.ts test/modules/admin/environment-dashboard/environment-event-bus.service.spec.ts test/modules/admin/environment-dashboard/environment-event.materializer.spec.ts test/modules/admin/environment-dashboard/qqbot-environment-event.bridge.spec.ts --runInBand
  ```
  Expected output after implementation: topic mapping is deterministic, expired retained signal becomes non-green, broker disconnect creates an event without marking every service down, and QQBot bridge tests pass without importing dashboard code from QQBot-specific topic constants.

## Task 4: API Remote Adapters For Jenkins And Kubernetes

- [ ] Create `environment-dashboard-config.service.ts` that reads optional dashboard integration env vars. It returns explicit missing-key lists for each integration instead of throwing.

- [ ] Create `jenkins-readonly.adapter.ts`:
  - uses Jenkins Remote Access API endpoint from env
  - reads latest build/job metadata through GET
  - maps configured-but-failing response to `down` or `degraded`
  - maps missing URL/token/job to `unwired`
  - never triggers builds

- [ ] Create `kubernetes-readonly.adapter.ts`:
  - uses Kubernetes API server, namespace, label selector, deployment name, and bearer token from env
  - reads Deployment and Pod metadata through GET
  - maps generation mismatch or not-ready pods to `degraded`
  - maps API unreachable to `isolated`
  - maps missing config to `unwired`
  - never sends PATCH/POST/DELETE

- [ ] Add adapter tests:
  - missing config produces `unwired` evidence with exact missing keys
  - success response produces `live`
  - HTTP failure produces non-green status

- [ ] Run:
  ```powershell
  cd D:\MyFiles\KT\Node\kt-template-online-api
  pnpm exec jest --runTestsByPath test/modules/admin/environment-dashboard/jenkins-readonly.adapter.spec.ts test/modules/admin/environment-dashboard/kubernetes-readonly.adapter.spec.ts --runInBand
  ```
  Expected output: tests pass with mocked HTTP client.

## Task 5: API Remote Adapters For Tencent Cloud, Caddy, WireGuard, And Mihomo

- [ ] Create `tencent-cloud-readonly.adapter.ts`:
  - uses `tencentcloud-sdk-nodejs`
  - reads CVM instance status and Cloud Monitor summaries only when credentials and instance IDs are configured
  - maps missing credentials to `unwired`
  - maps SDK errors to `isolated` or `unknown` with error evidence
  - stores no secret in evidence or logs

- [ ] Create `caddy-readonly.adapter.ts`:
  - reads configured public URL with HEAD/GET
  - optionally reads Caddy Admin API config only when admin URL is configured
  - maps missing admin API to an `unwired` signal and public URL success to `live`
  - never reloads or writes Caddy config

- [ ] Create `wireguard-readonly.adapter.ts`:
  - reads only configured health endpoints or public route checks for Tencent Cloud and r4se WireGuard
  - if no safe endpoint is configured, returns `unwired` with evidence explaining the absent read source
  - does not SSH into hosts in the dashboard request path

- [ ] Create `mihomo-readonly.adapter.ts`:
  - reads Mihomo/OpenClash REST API `GET /version`, `GET /configs`, and `GET /proxies` when URL and secret are configured
  - maps missing URL/secret to `unwired`
  - never changes selector, proxy, rule, or config

- [ ] Add tests for each adapter using mocked clients:
  ```powershell
  cd D:\MyFiles\KT\Node\kt-template-online-api
  pnpm exec jest --runTestsByPath test/modules/admin/environment-dashboard/tencent-cloud-readonly.adapter.spec.ts test/modules/admin/environment-dashboard/caddy-readonly.adapter.spec.ts test/modules/admin/environment-dashboard/wireguard-readonly.adapter.spec.ts test/modules/admin/environment-dashboard/mihomo-readonly.adapter.spec.ts --runInBand
  ```
  Expected output: tests pass; Tencent SDK is mocked.

## Task 6: API Internal Signal Collectors

- [ ] Create `local-dev-signal.collector.ts` for local-dev site:
  - API process/runtime health from `RuntimeHealthService.getRuntimeHealth()`
  - local Admin proxy/config as configured source
  - local dependency gaps shown as `unknown` or `unwired`

- [ ] Create `nas-prod-signal.collector.ts` for NAS production site:
  - Runtime health from `RuntimeHealthService`
  - QQBot summary from `QqbotDashboardService.summary()`
  - NapCat runtime/login visibility through exported NapCat runtime port or explicitly exported service
  - plugin platform/task visibility through `QqbotPluginPlatformService` and exported task service
  - MinIO connection through existing `MinioClientService.checkConnection`
  - WordPress integration through `WordpressService.tryLoginWithConfiguredAdmin()`
  - Jenkins/K8s through adapters from Task 4
  - Loki/MySQL/Redis as configured or derived signals when no direct safe adapter exists

- [ ] Update module exports only where the collector needs existing services:
  - `src/modules/qqbot/core/qqbot-core.module.ts`: export `QqbotDashboardService`
  - `src/modules/qqbot/plugin-platform/qqbot-plugin-platform.module.ts`: export `QqbotPluginTaskService` if task status counts are required
  - Prefer existing exported NapCat runtime port before exporting concrete NapCat services

- [ ] Add `nas-prod-signal.collector.spec.ts` with mocked dependencies proving:
  - QQBot offline does not mark API down
  - one disabled plugin task appears as degraded service evidence
  - MinIO failure is contained to MinIO service
  - missing Jenkins/K8s config remains `unwired`

- [ ] Run:
  ```powershell
  cd D:\MyFiles\KT\Node\kt-template-online-api
  pnpm exec jest --runTestsByPath test/modules/admin/environment-dashboard/nas-prod-signal.collector.spec.ts --runInBand
  ```
  Expected output: tests pass.

## Task 7: API Dashboard Aggregator, Cache, And Self-Check

- [ ] Create `environment-dashboard-cache.service.ts`:
  - caches successful aggregate response for `ENV_DASHBOARD_CACHE_TTL_MS`
  - marks cached signals with `sourceKind: 'cached'`
  - does not cache thrown exceptions as green results

- [ ] Create `environment-dashboard.service.ts`:
  - assembles four sites: `local-dev`, `nas-prod`, `tencent-cloud`, `r4se`
  - aggregates summary counters
  - merges safe recent events from `environment-event.materializer.ts`
  - builds topology edges:
    - local-dev -> API/Admin local services
    - nas-prod -> Jenkins/K8s/API/Admin/MySQL/Redis/Loki/MinIO/WordPress/QQBot/NapCat/Plugin Platform/Plugin Tasks
    - tencent-cloud -> WireGuard/Caddy
    - r4se -> WireGuard/OpenClash
  - attaches action catalog
  - returns deterministic IDs for UI selection

- [ ] Create `environment-dashboard-self-check.service.ts`:
  - runs the same collectors with `forceRefresh: true`
  - returns `EnvironmentDashboardResponse`
  - records event entries for failed adapters through `EnvironmentEventBus`
  - performs no write operation

- [ ] Add service tests:
  ```powershell
  cd D:\MyFiles\KT\Node\kt-template-online-api
  pnpm exec jest --runTestsByPath test/modules/admin/environment-dashboard/environment-dashboard.service.spec.ts test/modules/admin/environment-dashboard/environment-dashboard-self-check.service.spec.ts --runInBand
  ```
  Expected output: tests pass and generated topology includes all four sites.

## Task 8: API Controller, Module Wiring, Env Docs, And Local HTTP Smoke

- [ ] Create `presentation/dto/environment-dashboard.dto.ts` with Swagger DTO classes. Keep DTO shape aligned to the domain response.

- [ ] Create `presentation/environment-dashboard.controller.ts`:
  - `GET /system/environment/dashboard`
  - `POST /system/environment/self-check`
  - guards: `JwtAuthGuard`
  - response wrapper: existing `vbenSuccess`
  - JSDoc on controller methods states Admin route origin and no side effects beyond read-only probes/cache refresh

- [ ] Update `admin-platform-config.module.ts` imports/providers/controllers. Include only required modules.

- [ ] Update `.env.example`, `README.md`, and `API.md` with optional env variables and read-only semantics:
  ```env
  ENV_DASHBOARD_CACHE_TTL_MS=15000
  ENV_DASHBOARD_SIGNAL_TIMEOUT_MS=5000
  ENV_DASHBOARD_EVENT_BUS=local
  ENV_DASHBOARD_MQTT_URL=
  ENV_DASHBOARD_MQTT_CLIENT_ID=kt-template-online-api-environment
  ENV_DASHBOARD_MQTT_USERNAME=
  ENV_DASHBOARD_MQTT_PASSWORD=
  ENV_DASHBOARD_MQTT_TOPIC_PREFIX=kt/env
  ENV_DASHBOARD_JENKINS_URL=
  ENV_DASHBOARD_JENKINS_JOB=KT-Template/KT-Template-API/main
  ENV_DASHBOARD_JENKINS_USERNAME=
  ENV_DASHBOARD_JENKINS_TOKEN=
  ENV_DASHBOARD_K8S_API_SERVER=
  ENV_DASHBOARD_K8S_NAMESPACE=kt-prod
  ENV_DASHBOARD_K8S_DEPLOYMENT=kt-template-online-api
  ENV_DASHBOARD_K8S_LABEL_SELECTOR=app=kt-template-online-api
  ENV_DASHBOARD_K8S_BEARER_TOKEN=
  ENV_DASHBOARD_TENCENT_CLOUD_ENABLED=false
  ENV_DASHBOARD_TENCENT_SECRET_ID=
  ENV_DASHBOARD_TENCENT_SECRET_KEY=
  ENV_DASHBOARD_TENCENT_REGION=
  ENV_DASHBOARD_TENCENT_INSTANCE_ID=
  ENV_DASHBOARD_CADDY_ADMIN_URL=
  ENV_DASHBOARD_CADDY_PUBLIC_URL=
  ENV_DASHBOARD_R4SE_MIHOMO_URL=
  ENV_DASHBOARD_R4SE_MIHOMO_SECRET=
  ENV_DASHBOARD_TENCENT_WIREGUARD_HEALTH_URL=
  ENV_DASHBOARD_R4SE_WIREGUARD_HEALTH_URL=
  ```

- [ ] Run API targeted tests:
  ```powershell
  cd D:\MyFiles\KT\Node\kt-template-online-api
  pnpm exec jest --runTestsByPath test/modules/admin/environment-dashboard/environment-dashboard.controller.spec.ts --runInBand
  ```
  Expected output: controller spec passes.

- [ ] Run API typecheck:
  ```powershell
  cd D:\MyFiles\KT\Node\kt-template-online-api
  pnpm run typecheck
  ```
  Expected output: no TypeScript errors.

- [ ] Start or reuse local API service, then make real local requests:
  ```powershell
  curl.exe -H "Authorization: Bearer <local-admin-token>" http://127.0.0.1:<api-port>/system/environment/dashboard
  curl.exe -X POST -H "Authorization: Bearer <local-admin-token>" http://127.0.0.1:<api-port>/system/environment/self-check
  ```
  Expected output: both return `code: 0` or existing success wrapper equivalent, four site records, and at least one `unwired` evidence item when remote env vars are absent.

## Task 9: Admin API Wrapper And RED Tests

- [ ] Create `apps/web-antdv-next/src/api/system/environment.ts` with exported interfaces matching the API response and functions:
  - `getEnvironmentDashboard()`
  - `runEnvironmentSelfCheck()`

- [ ] Add `apps/web-antdv-next/src/api/system/environment.spec.ts`:
  ```ts
  import { requestClient } from '#/api/request';
  import {
    getEnvironmentDashboard,
    runEnvironmentSelfCheck,
  } from './environment';

  vi.mock('#/api/request', () => ({
    requestClient: {
      get: vi.fn(),
      post: vi.fn(),
    },
  }));

  describe('environment dashboard api', () => {
    it('loads the aggregate dashboard', async () => {
      await getEnvironmentDashboard();
      expect(requestClient.get).toHaveBeenCalledWith('/system/environment/dashboard');
    });

    it('runs readonly self check', async () => {
      await runEnvironmentSelfCheck();
      expect(requestClient.post).toHaveBeenCalledWith('/system/environment/self-check');
    });
  });
  ```

- [ ] Run RED, implement, rerun:
  ```powershell
  cd D:\MyFiles\KT\Vue\kt-template-admin
  pnpm exec vitest run apps/web-antdv-next/src/api/system/environment.spec.ts
  ```
  Expected output after implementation: tests pass.

## Task 10: Admin Component Shell And Visual States

- [ ] Replace the old sample content in `apps/web-antdv-next/src/views/dashboard/analytics/index.vue` with a single route root element. Do not keep old Vben analysis sample cards/charts.

- [ ] Create `types.ts` for view-only types. Keep it aligned with API wrapper types by importing from the API wrapper where practical.

- [ ] Create `EnvironmentStatusBar.vue`:
  - global status, generated/refreshed time, signal counters
  - refresh and self-check buttons using antdv-next buttons/icons
  - loading and error state

- [ ] Create `EnvironmentSiteRail.vue`:
  - site cards/list items for local-dev, nas-prod, tencent-cloud, r4se
  - status badge per site
  - evidence count and unwired count

- [ ] Create `EnvironmentTopology.vue`:
  - responsive service topology using semantic HTML/CSS grid, not canvas-only rendering
  - service nodes show status, source kind, and selected state
  - links/edges represented accessibly and remain readable on 1366px desktop

- [ ] Create `EnvironmentEvidencePanel.vue`:
  - selected site/service/signal details
  - evidence list grouped by source
  - action list with disabled high-risk actions visibly disabled and reason text
  - no write endpoint calls

- [ ] Create `EnvironmentEventStream.vue`:
  - latest events sorted newest first
  - status/source kind tags
  - compact display with stable row height

- [ ] Styling constraints:
  - use `antdv-next` components already present in the app
  - avoid marketing hero, gradient blobs, decorative cards inside cards
  - ensure mobile layout stacks as top status -> site rail -> topology -> evidence -> events
  - text must not overlap at 390px, 768px, 1366px, and 1920px widths

## Task 11: Admin Page Integration, Locales, And Tests

- [ ] Wire `index.vue`:
  - load dashboard on mount
  - refresh with `getEnvironmentDashboard`
  - self-check with `runEnvironmentSelfCheck`
  - preserve selected site/service when IDs still exist after refresh
  - select first degraded/down/blocked service by default, else first site
  - display explicit empty/error state when API fails

- [ ] Update locale title from analytics sample to environment dashboard:
  - `apps/web-antdv-next/src/locales/langs/zh-CN/page.json`: `环境总览`
  - `apps/web-antdv-next/src/locales/langs/en-US/page.json`: `Environment`

- [ ] Add page spec `environment-dashboard.spec.tsx`:
  - mocked API returns all four sites
  - disabled write actions render disabled
  - unwired Jenkins/K8s evidence renders as evidence, not healthy state
  - MQTT-origin recent event renders only after API returns it; page does not instantiate an MQTT client
  - self-check button calls the POST wrapper

- [ ] Run:
  ```powershell
  cd D:\MyFiles\KT\Vue\kt-template-admin
  pnpm exec vitest run apps/web-antdv-next/src/views/dashboard/analytics/environment-dashboard.spec.tsx
  ```
  Expected output: tests pass.

- [ ] Run Admin typecheck:
  ```powershell
  cd D:\MyFiles\KT\Vue\kt-template-admin
  pnpm -F @vben/web-antdv-next run typecheck
  ```
  Expected output: no TypeScript errors.

## Task 12: Local Page Smoke And Interface Smoke

- [ ] Start or reuse local API and Admin dev servers. Record ports and process IDs under `.kt-workspace/test-artifacts/environment-dashboard/`.

- [ ] In the in-app browser or Playwright, open `/dashboard/analytics` and verify:
  - top global status bar is visible
  - left site rail contains local-dev, nas-prod, tencent-cloud, r4se
  - topology contains Jenkins, K8s, QQBot/NapCat, Plugin Tasks, Tencent Caddy/WireGuard, r4se OpenClash/WireGuard
  - right panel shows evidence for selected item
  - bottom event stream appears
  - event stream can display an API-provided MQTT-origin event without exposing broker configuration in frontend state
  - Jenkins/K8s missing config appears as `unwired` or `unknown`, never green
  - disabled write actions cannot be clicked

- [ ] Capture screenshots:
  - desktop 1366x768
  - wide desktop 1920x1080
  - mobile 390x844
  Store under `.kt-workspace/test-artifacts/environment-dashboard/`.

- [ ] Make one real local HTTP call from Admin session to both endpoints through the browser network panel or request logs. Evidence must include endpoint, HTTP status, and presence of four site IDs.

- [ ] Stop Node/Vite processes started by this task if they were not already running before the task.

## Task 13: KT Loops, Review, Commit, And Push Gate

- [ ] Run documentation sync check for changed files:
  ```powershell
  cd D:\MyFiles\KT
  pnpm --dir mcp/ktWorkflow run change-doc-sync -- --project Node/kt-template-online-api --changed "src/modules/admin/platform-config/environment-dashboard,.env.example,README.md,API.md"
  pnpm --dir mcp/ktWorkflow run change-doc-sync -- --project Vue/kt-template-admin --changed "apps/web-antdv-next/src/views/dashboard/analytics,apps/web-antdv-next/src/api/system/environment.ts"
  ```
  Expected output: either required docs are updated or the script records that no additional docs are required.

- [ ] Run cleanup dry-run and execute only stale `.kt-workspace` cleanup if reported:
  ```powershell
  cd D:\MyFiles\KT
  pnpm --dir mcp/ktWorkflow run cleanup-history -- --dry-run
  ```
  Expected output: if `deleted=[]`, no execute run is needed; if stale files are listed, run with `--execute` and rerun dry-run.

- [ ] Run global review for API and Admin:
  ```powershell
  cd D:\MyFiles\KT
  pnpm --dir mcp/ktWorkflow run global-review -- --project Node/kt-template-online-api
  pnpm --dir mcp/ktWorkflow run global-review -- --project Vue/kt-template-admin
  ```
  Expected output: no Important findings remain. Any finding that is a false positive must be documented with evidence.

- [ ] Update `D:\MyFiles\KT\TASKS.md` with concise scope, changed files, validation evidence, and remaining online env wiring gaps.

- [ ] Commit API repo:
  ```powershell
  cd D:\MyFiles\KT\Node\kt-template-online-api
  git status --short
  git add package.json pnpm-lock.yaml .env.example README.md API.md src/modules/admin/platform-config src/modules/qqbot/core/qqbot-core.module.ts src/modules/qqbot/plugin-platform/qqbot-plugin-platform.module.ts test/modules/admin/environment-dashboard docs/superpowers/plans/2026-06-18-admin-environment-dashboard-implementation-plan.md
  git commit -m "feat: 新增环境总览总控面板接口"
  ```
  Expected output: one API commit. Do not stage secrets.

- [ ] Commit Admin repo:
  ```powershell
  cd D:\MyFiles\KT\Vue\kt-template-admin
  git status --short
  git add apps/web-antdv-next/src/api/system/environment.ts apps/web-antdv-next/src/api/system/environment.spec.ts apps/web-antdv-next/src/views/dashboard/analytics apps/web-antdv-next/src/locales/langs/zh-CN/page.json apps/web-antdv-next/src/locales/langs/en-US/page.json
  git commit -m "feat: 重构分析页为环境总览总控面板"
  ```
  Expected output: one Admin commit.

- [ ] Commit KT root if `TASKS.md` changed:
  ```powershell
  cd D:\MyFiles\KT
  git status --short
  git add TASKS.md
  git commit -m "docs: 同步环境总览面板任务状态"
  ```
  Expected output: one root coordination commit.

- [ ] Push only after the user explicitly asks for push or deployment:
  ```powershell
  git push origin codex/admin-environment-dashboard
  ```
  Expected output: remote branch pushed. If push triggers deployment, Jenkins/K8s observation and online self-test are required before claiming online completion.

## Online Wiring Checklist After Implementation

When the user asks to deploy or test online, wire environment variables in the online secret/config system without committing values:

- Jenkins read-only URL/job/user/token.
- K8s API server/namespace/deployment/selector/bearer token with read-only RBAC.
- Tencent Cloud official SDK credentials scoped to CVM/Cloud Monitor read-only APIs.
- Tencent Cloud Caddy public URL and optional Admin API URL if safely reachable.
- r4se Mihomo/OpenClash read-only API URL and secret.
- WireGuard health endpoints for Tencent Cloud and r4se, or explicit unwired status if no safe read endpoint exists.

Online completion evidence must include:

- `GET /system/environment/dashboard` returns four sites.
- `POST /system/environment/self-check` returns fresh evidence.
- MQTT event bus is either `local` with explicit configured evidence, or `mqtt` with broker connection status shown as evidence.
- A synthetic non-secret MQTT signal event invalidates dashboard cache and appears in recent events; an expired retained signal does not create a green status.
- Jenkins/K8s nodes show live evidence when configured, or explicit missing-key evidence when not configured.
- Tencent Cloud and r4se nodes do not show green health without a live/configured source.
- Admin page displays the same state without console errors.
