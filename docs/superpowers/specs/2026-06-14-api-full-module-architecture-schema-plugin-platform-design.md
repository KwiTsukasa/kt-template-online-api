# API Full Module Architecture, Schema, and Plugin Platform Design

## Background

The API project has grown from a compact NestJS service into a multi-domain
backend for Admin, Blog, WordPress, MinIO, QQBot, NapCat, Loki-backed runtime
events, and online deployment observation. The first runtime foundation phase
added the shared `/health/runtime` endpoint, typed runtime checks, and evidence
patterns needed to observe future refactors safely.

The next phase is not another QQBot-only repair. It is an API-wide architecture
planning phase that prepares a full module refactor and a database redesign
from scratch. Existing production data is considered unimportant for this
phase, so the target design may rename tables, drop obsolete columns, split
or merge tables, and rebuild initialization SQL. Even with that freedom, the
implementation phase must keep backups, rollback commands, and smoke checks so
online deployment remains auditable.

## Scope Decision

This document covers the planning-only phase selected by the user:

1. Define the API target module architecture.
2. Redesign the database schema from scratch across all API domains.
3. Design a first-class QQBot plugin platform with worker isolation, online
   installation, hot-plug enable/disable, and CLI scaffolding.
4. Define the migration matrix and the future implementation order.

This document does not implement code, SQL, Admin UI, or runtime behavior.
After this planning phase is reviewed, the full migration implementation must
start a new Superpowers brainstorming loop before touching code.

## Goals

- Make module ownership explicit enough that every controller, use case,
  entity, repository, external integration, and test has a clear home.
- Replace the current patch-based table history with a clean target schema.
- Keep external API compatibility by default, while listing deliberate breaking
  changes before implementation.
- Turn QQBot plugins into a unified platform instead of a set of hard-coded
  Nest providers.
- Make plugin creation repeatable through a CLI scaffold.
- Allow online plugin installation, validation, enable/disable, upgrade, and
  uninstall without restarting the entire API process.
- Plan existing plugin rewrites for BangDream, FF14 Market, FFLogs, and
  Repeater under the same plugin contract.
- Preserve the runtime reliability work from Phase 1 as the foundation for
  future module and deployment verification.

## Non-Goals

- Do not write implementation code in this planning phase.
- Do not preserve the old database structure merely for migration convenience.
- Do not treat Jenkins/K8s rollout success as functional success.
- Do not move Admin frontend code in this phase. Admin changes are planned here
  and implemented after a separate brainstorming loop.
- Do not bypass QQ or Tencent security checks. NapCat captcha and new-device
  verification stay user-driven.
- Do not let installed plugin code access raw backend secrets, raw TypeORM
  repositories, or arbitrary Nest dependency injection.

## Target Architecture

The target source layout separates platform foundation, shared primitives, and
business modules:

```text
src/
  runtime/
  common/
  modules/
    admin/
    blog/
    wordpress/
    asset/
    qqbot/
```

`runtime` owns operational primitives:

- typed runtime config profiles.
- HTTP and process clients with timeouts, safe summaries, and classified
  errors.
- health probes and `/health/runtime`.
- runtime evidence records.
- cleanup semantics.

`common` owns stable shared primitives:

- Vben response and error helpers.
- exception filters and interceptors.
- date/time decorators and serialization helpers.
- Snowflake ID generation.
- low-level text and object utilities.
- logging primitives that are not domain-specific.

Business modules own user-facing behavior. Each module follows the same
internal shape:

```text
module/
  contract/
  application/
  domain/
  infrastructure/
    persistence/
    integration/
  schema/
  tests/
```

### Layer Responsibilities

`contract` contains controllers, request DTOs, response DTOs, Swagger metadata,
and compatibility adapters for existing routes.

`application` contains use cases, transaction boundaries, authorization checks,
and state orchestration. It may depend on domain services, repositories, and
integration ports. It must not hand-build external HTTP requests, Docker
scripts, or ad hoc SQL strings.

`domain` contains pure business rules, state machines, policy objects, and
value objects. Domain code should be testable without Nest, TypeORM, Docker,
HTTP, or external credentials.

`infrastructure/persistence` contains TypeORM entities, repository
implementations, query models, and schema-specific mappers.

`infrastructure/integration` contains external adapters such as WordPress HTTP,
MinIO SDK, Loki query, OneBot WebSocket, NapCat WebUI, plugin worker RPC, and
runtime process calls.

`schema` contains table design notes, initialization SQL ownership, migration
or rebuild scripts, and validation SQL for the module.

`tests` contains module-level unit, contract, repository, and integration
smoke tests. Cross-module smoke tests may stay under the root `test/` folder
when they verify a user workflow instead of a single module.

### Compatibility Rules

- Existing route paths remain stable unless the implementation plan lists a
  breaking change.
- Admin-facing responses keep the current Vben success/error wrapper unless an
  endpoint is explicitly documented as stream, file, WebSocket, or plain JSON.
- Public runtime health remains plain JSON.
- Snowflake IDs stay `BIGINT` in MySQL and string-like values at JavaScript/API
  boundaries.
- Runtime time fields use `KtDateTime extends Date` through the existing KT
  date-time decorators.
- Existing SQL filenames may be replaced by new full-build files during the
  implementation phase, but this planning phase does not modify them.

## Data Architecture Redesign

The implementation phase may rebuild the schema from scratch. Because current
data is not important, the target schema should be optimized for clean domain
ownership rather than old compatibility. The implementation phase must still
capture a backup before destructive online database work and must provide a
rollback or restore command.

### Global Schema Conventions

- Primary keys use Snowflake `BIGINT`.
- Foreign key columns use `*_id` and are indexed.
- Stable relation tables use composite unique keys.
- High-write log and event tables avoid hard database foreign keys when they
  would make retention or cleanup difficult.
- Business config tables use soft delete only when restore is valuable.
- Append-only runtime events, command logs, message logs, and plugin runtime
  events use retention instead of soft delete.
- Common timestamps are `create_time`, `update_time`, and optional
  `delete_time`.
- Status columns use explicit string enums documented in schema notes.
- JSON columns are reserved for raw external payload snapshots, plugin
  metadata, low-frequency config, or evidence details. Queryable fields must be
  first-class columns.
- Text fields with known UI or storage limits must document the truncation
  rule.
- New initialization SQL should be generated as a clean full schema, not as an
  accumulated stack of historical `ALTER TABLE` patches.

### Domain Table Plan

| Domain | Target Tables | Notes |
| --- | --- | --- |
| Admin Identity | `admin_user`, `admin_role`, `admin_permission`, `admin_menu`, `admin_department`, `admin_user_role`, `admin_role_permission`, `admin_role_menu` | Keep Admin route behavior stable while separating route menus from permission atoms. Department is hierarchical. User avatar, timezone, and home path remain user profile fields. |
| Platform Config | `platform_dict_group`, `platform_dict_item`, `platform_component_template`, `platform_setting` | Move dictionary and component-template ownership out of miscellaneous Admin services. Dict group/item replace overloaded flat dict rows. |
| Blog Content | `blog_post`, `blog_taxonomy`, `blog_term`, `blog_post_term`, `blog_theme_profile`, `blog_import_job` | Replace comma/text category and tag storage with relation tables. Theme config becomes a named profile. |
| WordPress Mirror | `wordpress_site`, `wordpress_auth_session`, `wordpress_remote_post`, `wordpress_remote_term`, `wordpress_sync_job`, `wordpress_sync_mapping` | Separate remote WordPress state from local Blog content. Mapping table connects remote IDs to local posts or terms. |
| Asset/MinIO | `asset_bucket`, `asset_object`, `asset_reference`, `asset_access_grant` | Track object ownership, source module, MIME/type metadata, and temporary access grants without scattering MinIO URLs across business tables. |
| System Event | `system_notice`, `system_event`, `system_event_dedupe`, `system_event_delivery` | Keep Loki as the log query source. Store only actionable notices, dedupe state, and notification delivery state in MySQL. |
| Runtime Evidence | `runtime_evidence_index` | Store safe index metadata for important runtime evidence files, not full logs or secrets. Large JSON evidence remains under `.kt-workspace/test-artifacts` or deployment artifact storage. |
| QQBot Core | `qqbot_account`, `qqbot_connection_session`, `qqbot_capability_binding`, `qqbot_permission_policy`, `qqbot_command`, `qqbot_command_alias`, `qqbot_rule`, `qqbot_conversation`, `qqbot_message`, `qqbot_send_task`, `qqbot_send_log`, `qqbot_dedupe_event` | Split account identity, connection state, permissions, routing, conversation state, message history, and send queue/history. |
| NapCat Runtime | `napcat_container`, `napcat_device_identity`, `napcat_account_binding`, `napcat_login_session`, `napcat_login_challenge`, `napcat_runtime_cleanup` | Device identity is a first-class table for MAC, hostname, machine-id path, data dir, and verification state. Login challenges cover captcha and new-device flows. Cleanup records block false success. |
| QQBot Plugin Platform | `qqbot_plugin`, `qqbot_plugin_version`, `qqbot_plugin_installation`, `qqbot_plugin_operation`, `qqbot_plugin_event_handler`, `qqbot_plugin_account_binding`, `qqbot_plugin_config`, `qqbot_plugin_asset`, `qqbot_plugin_runtime_event` | Installed plugin metadata, versions, operations, events, account bindings, config, assets, and runtime events belong to the platform, not to individual plugin code. |
| Plugin-Owned Data | `qqbot_plugin_data_*` or module-specific plugin tables | Plugin migrations may create namespaced tables. Names must start with the plugin key or a registered namespace to avoid collisions. |

### Destructive Rebuild Strategy

The implementation phase may use this rebuild flow:

1. Capture a timestamped online database backup.
2. Stop or gate write traffic for the API during destructive schema work.
3. Drop or rename old API tables according to the approved rebuild script.
4. Apply the new full initialization SQL.
5. Seed required Admin user, roles, menus, platform settings, dictionaries,
   core QQBot plugin metadata, and default online commands.
6. Start the API against the new schema.
7. Run local or online smoke checks for Admin login, menu loading, Blog public
   reads, MinIO check, QQBot command registry, plugin registry, NapCat account
   status, and `/health/runtime`.
8. If a critical smoke fails, restore the backup or reapply the previous schema
   bundle and redeploy the previous API image.

## QQBot Plugin Platform

QQBot plugins become a platform capability instead of hard-coded Nest service
registrations. Command plugins, event plugins, renderers, external-query
plugins, and automation plugins use one contract.

### Plugin Package Structure

```text
plugins/<pluginKey>/
  plugin.json
  src/
    index.ts
    operations/
    events/
    config/
    migrations/
    assets/
    tests/
```

`plugin.json` is the source of truth for:

- plugin key, name, description, version, author, license, and homepage.
- minimum API plugin SDK version.
- permissions requested from the host.
- operations and event handlers.
- config schema and defaults.
- asset declarations.
- migration declarations.
- runtime requirements such as timeout, memory limit, and worker type.

### Worker-Isolated Runtime

The approved runtime model is process isolation:

- API main process installs packages, validates manifests, owns the registry,
  and routes commands/events.
- Plugin code runs in a dedicated worker or child process.
- A plugin crash marks the plugin instance `degraded` or `offline` without
  crashing the API process.
- Enable, disable, upgrade, and uninstall operations start or stop workers and
  refresh the registry at runtime.
- Workers communicate with the API through a narrow RPC protocol.

The RPC protocol must support these commands:

- `load`: load manifest and compiled entry.
- `activate`: initialize runtime state.
- `deactivate`: stop accepting work.
- `executeOperation`: execute a command or query operation.
- `handleEvent`: handle message or account events.
- `health`: return plugin health.
- `dispose`: release resources before shutdown.

RPC messages carry operation IDs, correlation IDs, timeout budgets, sanitized
input, and structured output. The host owns timeout enforcement.

### Plugin SDK Boundary

Plugin code cannot access Nest dependency injection, raw TypeORM repositories,
raw backend environment variables, or arbitrary filesystem paths. It receives a
controlled SDK with explicit capabilities:

- send QQBot messages through the host send queue.
- read and write plugin config through the plugin config service.
- read and write plugin-owned storage.
- emit plugin runtime events.
- request host-provided runtime HTTP calls with configured timeout and safe
  evidence.
- load declared static assets from the plugin asset root.
- inspect the current operation or event context.

Plugins must declare permissions before installation. The host rejects packages
whose manifest requests unsupported permissions or whose code package does not
match the validated hash.

### CLI Scaffold

The repository should add a CLI for plugin authors:

```bash
pnpm qqbot-plugin create <pluginKey>
pnpm qqbot-plugin validate <path>
pnpm qqbot-plugin pack <path>
pnpm qqbot-plugin install-local <package>
```

`create` generates:

- `plugin.json`.
- `src/index.ts` with `createPlugin()`.
- one operation handler template.
- one event handler template.
- config schema and defaults.
- migration/schema template.
- contract tests.
- package metadata.
- README/API draft fragments.

`validate` checks manifest shape, operation keys, event keys, permissions,
schema files, migrations, package size, disallowed paths, and basic test
presence.

`pack` produces a versioned plugin package with a content hash.

`install-local` installs a package into the local development plugin root using
the same validation path as online installation.

### Online Installation and Hot-Plug State Machine

Plugin installation state moves through:

```text
uploaded -> validated -> installed -> enabled
enabled -> disabled
installed -> uninstalled
enabled -> upgrading -> enabled
enabled -> failed
```

Admin uploads a plugin package. The API validates manifest, package hash,
version compatibility, permissions, migrations, and declared assets. The package
is stored under a controlled runtime plugin directory, never under `src/`.

Enabling a plugin starts its worker, registers operations and event handlers,
and records the runtime status. Disabling a plugin stops the worker and removes
its active operations/events from routing without deleting data. Uninstalling a
plugin stops workers, removes registry entries, unbinds commands/events, and
then follows the selected data policy: preserve plugin data by default, delete
only when the admin explicitly chooses cleanup.

### Existing Plugin Rewrite Plan

BangDream becomes the large reference plugin. Its current business capability
split can stay inside the plugin package:

```text
bangDream/
  operations/
  song/
  card/
  character/
  event/
  gacha/
  player/
  cutoff/
  provider/
  renderer/
  theme/
  assets/
```

The existing BangDream operation registry becomes manifest-backed operation
metadata. Handler names remain implementation details inside the plugin worker.
The current image rendering smoke expectations, including event stage split
output behavior, remain acceptance tests.

FF14 Market becomes an external-query plugin using the host runtime HTTP SDK
for XIVAPI and Universalis calls.

FFLogs becomes an external-query plugin using the host runtime HTTP SDK for
GraphQL/token calls and plugin config for client credentials references.

Repeater becomes an event plugin with host-managed account binding and
plugin-owned transient state. It must not bypass the host send queue.

## Module Migration Matrix

The future implementation phase should be split into auditable batches:

| Batch | Scope | Outcome |
| --- | --- | --- |
| 0 | Migration preparation | New schema map, full initialization SQL plan, destructive rebuild script plan, backup/restore commands, validation SQL, module template, and breaking-change list. |
| 1 | Runtime/Common | Keep runtime foundation stable, add missing runtime client/evidence primitives needed by module adapters, and shrink common to stable shared primitives. |
| 2 | Admin/Auth/Platform Config | Rebuild identity, menu, permission, dictionary, component template, and system notice models. Admin login and menu loading must pass first. |
| 3 | Blog/WordPress/Asset | Rebuild Blog content relations, WordPress mirror/sync, and MinIO asset ownership. Public Blog reads and Admin Blog management must pass. |
| 4 | QQBot Core | Rebuild account, connection, permission, command, rule, conversation, message, and send queue models. Command matching and send queue tests must pass. |
| 5 | QQBot Plugin Platform | Add plugin manifest validation, database registry, CLI scaffold, worker runtime, RPC, online install, hot-plug state, and Admin/API management contracts. |
| 6 | Existing Plugin Rewrite | Rewrite BangDream, FF14 Market, FFLogs, and Repeater as isolated plugin packages. Existing command smoke behavior must remain available. |
| 7 | NapCat Runtime | Implement container device persistence, login session state machine, captcha/new-device flow, and cleanup evidence on the new QQBot/NapCat model. |
| 8 | Online Closure | Deploy, observe Jenkins/K8s, run `/health/runtime`, Admin smoke, Blog smoke, plugin install/enable smoke, QQBot command smoke, and real NapCat account login smoke. |

NapCat is intentionally after QQBot Core and Plugin Platform. It depends on the
new account model and shares runtime verification with command/event routing,
but it is not itself a plugin.

## Contract and Breaking-Change Policy

External API compatibility is the default. Any implementation task that changes
route paths, request fields, response fields, status semantics, SSE event names,
Admin API wrappers, or SQL seed identifiers must add the change to a
breaking-change table before coding.

Allowed planned breakages:

- Database table names, columns, indexes, and initialization SQL may change
  freely because the schema is redesigned from scratch.
- Admin pages may need API-wrapper updates during the implementation phase.
- Plugin management endpoints are new and can use new route shapes.

Protected behavior:

- Admin login and menu loading.
- Vben response wrapper for business APIs.
- `/health/runtime` plain JSON.
- Blog public article list/detail behavior.
- QQBot command test flow.
- QQBot account status distinction between OneBot connection, container,
  WebUI, and QQ login state.
- NapCat login safety checks, captcha handoff, new-device verification, and
  runtime password cleanup blocking semantics.

## Verification Strategy

Planning-only verification for this spec:

- spec self-review for missing markers, contradictions, and ambiguous scope.
- `git diff --check`.
- KT documentation sync check.
- KT global review on changed files.

Future implementation verification must include:

- targeted unit tests for domain policies and state machines.
- repository/schema tests for new SQL and TypeORM mappings.
- plugin contract tests generated by the CLI scaffold.
- worker runtime tests for load, activate, execute, health, deactivate, and
  crash isolation.
- local API requests for changed endpoints.
- Admin UI smoke when Admin callers change.
- database rebuild dry run against a local database before online destructive
  work.
- online backup, rebuild, restore path, Jenkins/K8s observation, and functional
  smoke after deploy.

## Acceptance Criteria for This Planning Phase

This planning phase is complete when:

1. The design document is written under `docs/superpowers/specs/`.
2. The design document is committed.
3. The user reviews the committed document.
4. The next step is a Superpowers writing-plans phase for the planning output,
   not code implementation.
5. The subsequent full migration starts a fresh Superpowers brainstorming loop
   before implementation begins.

## Handoff to the Next Phase

After user review, the writing-plans phase should produce a plan document for
the planning deliverable. That plan should describe how to turn this design into
implementation-ready work packages, schema documents, plugin platform tasks,
and validation checklists.

The subsequent full implementation must start from a new brainstorming loop
because it will involve destructive schema work, Admin/API contract decisions,
runtime plugin security boundaries, and online closure.
