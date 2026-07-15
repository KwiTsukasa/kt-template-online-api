# QQBot NapCat Runtime Protocol Profile Implementation Plan

> **Execution note:** Execute this plan task-by-task with the KT-local workflow and use the checkboxes to track plan state.

**Goal:** Implement the confirmed NapCat session behavior, login-event minimization, protocol risk profile, real-device identity migration, and Chinese Desktop Runtime profile without adding unsafe automation or hourly/daily send budgets.

**Architecture:** Keep all runtime authority inside `src/modules/qqbot/napcat/**`, with Core consuming only the existing `QqbotAccountNapcatRuntimePort`. Persist profile truth in dedicated NapCat tables, generate Docker/NapCat/OneBot config from typed profile services, and expose first-stage Admin capabilities as read-only evidence plus explicit recovery status. The order of implementation is evidence first, then login-event stabilization, then session behavior, then runtime hygiene and account migration.

**Tech Stack:** NestJS 11, TypeORM, Jest, MySQL schema SQL, NAS Docker over SSH, NapCat Docker, OneBot v11 reverse WebSocket, Vben Admin with Vue TSX and antdv-next.

---

## Scope And Ground Rules

- Target repos:
  - API: `D:/MyFiles/KT/Node/kt-template-online-api`
  - Admin: `D:/MyFiles/KT/Vue/kt-template-admin`
  - Root docs index: `D:/MyFiles/KT/TASKS.md` after files change.
- Source spec: `D:/MyFiles/KT/Node/kt-template-online-api/docs/specs/2026-06-18-qqbot-napcat-linux-runtime-protocol-profile-design.md`
- Preserve behavior:
  - Existing scan create/refresh, captcha, new-device verification, OneBot reverse WS, and QQBot command execution must keep working.
  - Existing watchdog order remains quick login, then saved password login; it must not enter QR scanning automatically.
  - OneBot heartbeat remains separate from QQ login state.
- Explicit non-goals:
  - No QQ captcha bypass.
  - No QQ/NTQQ private protocol signing changes.
  - No `--privileged`, `--network=host`, `--pid=host`, `--uts=host`, or host IPC.
  - No account-level hourly or daily cumulative send budget.
  - No automatic QR refresh from watchdog.
  - No Docker default `02:42`, QEMU/KVM `52:54:00`, VMware, Hyper-V, or other virtualization-style target MAC prefixes.

## File Responsibility Map

### API Persistence

- Create: `src/modules/qqbot/napcat/infrastructure/persistence/napcat-runtime-profile.entity.ts`
  - Stores Chinese Desktop Runtime evidence and Docker runtime profile state.
- Create: `src/modules/qqbot/napcat/infrastructure/persistence/napcat-protocol-profile.entity.ts`
  - Stores NapCat/OneBot protocol config, hashes, and `o3HookMode` state.
- Create: `src/modules/qqbot/napcat/infrastructure/persistence/napcat-session-behavior-profile.entity.ts`
  - Stores cold-start, housekeeping, presence, and staged capability state.
- Create: `src/modules/qqbot/napcat/infrastructure/persistence/napcat-login-event.entity.ts`
  - Stores login-side risk events: quick, password, restart, recreate, QR, captcha, new-device, suspended.
- Create: `src/modules/qqbot/napcat/infrastructure/persistence/napcat-risk-mode.entity.ts`
  - Stores non-budget risk degradation state: normal, cooldown, manual-only.
- Modify: `src/modules/qqbot/napcat/infrastructure/persistence/index.ts`
  - Exports new entities and adds tables to `NAPCAT_RUNTIME_DOMAIN_CONTRACT`.
- Modify: `sql/qqbot-init.sql`
  - Adds production bootstrap DDL for new tables.
- Modify: `sql/refactor-v3/00-full-schema.sql`
  - Adds full schema DDL for new tables.
- Modify: `sql/refactor-v3/99-verify.sql`
  - Adds table/index/column verification queries.
- Modify: `src/modules/qqbot/napcat/schema/README.md`
  - Lists new tables and verification intent.

### API Domain And Application

- Create: `src/modules/qqbot/napcat/domain/runtime/napcat-profile.types.ts`
  - Defines runtime, protocol, session behavior, login event, and risk mode types.
- Create: `src/modules/qqbot/napcat/domain/runtime/napcat-physical-oui-catalog.ts`
  - Defines approved physical-device OUI prefixes and rejected virtualization prefixes.
- Create: `src/modules/qqbot/napcat/domain/runtime/napcat-config-hash.ts`
  - Produces stable JSON hashes for NapCat/OneBot config evidence.
- Create: `src/modules/qqbot/napcat/application/runtime/napcat-runtime-profile.service.ts`
  - Resolves per-account runtime and protocol profiles from env, persisted state, and device identity.
- Create: `src/modules/qqbot/napcat/application/runtime/napcat-config-writer.service.ts`
  - Builds `webui.json`, `napcat.json`, `napcat_<uin>.json`, `onebot11.json`, and `onebot11_<uin>.json`.
- Create: `src/modules/qqbot/napcat/application/runtime/napcat-runtime-profile-inspector.service.ts`
  - Reads Docker/NapCat runtime evidence and writes profile drift state.
- Create: `src/modules/qqbot/napcat/application/runtime/napcat-login-event.service.ts`
  - Records login-side events and provides recovery lease/backoff decisions.
- Create: `src/modules/qqbot/napcat/application/runtime/napcat-session-behavior.service.ts`
  - Computes cold-start, housekeeping, presence, staged capability, and risk-mode decisions.
- Modify: `src/modules/qqbot/napcat/infrastructure/integration/device/napcat-device-identity.service.ts`
  - Replaces Docker-style hostname/MAC generation with real-device style strategy and migration evidence.
- Modify: `src/modules/qqbot/napcat/infrastructure/integration/container/napcat-docker-device-options.ts`
  - Carries runtime profile run flags, env, and mounts.
- Modify: `src/modules/qqbot/napcat/infrastructure/integration/container/qqbot-napcat-container.service.ts`
  - Uses profile services to generate scripts, records login events, and prevents watchdog from repeating destructive rebuilds.
- Modify: `src/modules/qqbot/napcat/application/account-runtime/qqbot-napcat-account-runtime.service.ts`
  - Adds runtime/profile summaries to account `napcat` info and uses login-event service for auto-login gates.
- Modify: `src/modules/qqbot/napcat/qqbot-napcat.module.ts`
  - Registers new entities and providers.
- Modify: `src/modules/qqbot/napcat/index.ts`
  - Exports new domain/application symbols needed by tests.

### API Contract

- Create: `src/modules/qqbot/napcat/contract/qqbot-napcat-runtime.controller.ts`
  - Read-only endpoints for account runtime profile detail and login events.
- Create: `src/modules/qqbot/napcat/contract/qqbot-napcat-runtime.dto.ts`
  - Query DTOs for runtime detail and login-event list.
- Modify: `src/modules/qqbot/core/contract/qqbot.types.ts`
  - Extends `QqbotAccountNapcatRuntimeInfo` with sanitized profile summaries.
- Modify: `API.md`
  - Documents read-only runtime profile endpoints and the no-budget/no-auto-QR boundary.

### API CI/NAS Assets

- Create: `ci/napcat-desktop-cn/Dockerfile`
  - Builds a KT-controlled image from a pinned NapCat Docker base image with `zh_CN.UTF-8`, Chinese fonts, fontconfig cache, timezone, XDG/Home, DBus/Xvfb support, and unchanged upstream entrypoint.
- Create: `ci/napcat-desktop-cn/verify.sh`
  - Verifies locale, timezone, fontconfig, XDG, process user, and entrypoint container-hiding evidence.
- Create: `ci/napcat-desktop-cn/README.md`
  - Records build, tag, digest, and verification commands for the controlled image.

### Admin

- Modify: `Vue/kt-template-admin/apps/web-antdv-next/src/api/qqbot/index.ts`
  - Adds account runtime profile summary types.
- Modify: `Vue/kt-template-admin/apps/web-antdv-next/src/api/qqbot/napcat.ts`
  - Adds read-only runtime profile detail and login-event API calls.
- Create: `Vue/kt-template-admin/apps/web-antdv-next/src/views/qqbot/account/napcat/NapcatRuntimeProfileDrawer.tsx`
  - Shows runtime, protocol, session behavior, risk mode, and recent login events.
- Modify: `Vue/kt-template-admin/apps/web-antdv-next/src/views/qqbot/account/list.tsx`
  - Adds a row action to open read-only runtime evidence.
- Modify: `Vue/kt-template-admin/apps/web-antdv-next/src/views/qqbot/modules/status.ts`
  - Adds labels/colors for recovery state, risk mode, and profile status.
- Test: `Vue/kt-template-admin/apps/web-antdv-next/src/api/qqbot/napcat.spec.ts`
- Test: `Vue/kt-template-admin/apps/web-antdv-next/src/views/qqbot/account/napcat/NapcatRuntimeProfileDrawer.spec.tsx`

### Tests

- Create: `test/modules/qqbot/napcat/runtime-protocol-profile.spec.ts`
- Create: `test/modules/qqbot/napcat/login-event-watchdog.spec.ts`
- Create: `test/modules/qqbot/napcat/session-behavior-profile.spec.ts`
- Create: `test/modules/qqbot/napcat/napcat-desktop-cn-image.spec.ts`
- Modify: `test/modules/qqbot/napcat/device-identity.spec.ts`
- Modify: `test/modules/qqbot/napcat/napcat-persistent-login-state.spec.ts`
- Modify: `test/qqbot/napcat/qqbot-napcat-container.service.spec.ts`
- Modify: `test/qqbot/account/qqbot-napcat-watchdog.service.spec.ts`

---

## Task 1: Persistence Model And Schema Gates

**Files:**
- Create: `src/modules/qqbot/napcat/infrastructure/persistence/napcat-runtime-profile.entity.ts`
- Create: `src/modules/qqbot/napcat/infrastructure/persistence/napcat-protocol-profile.entity.ts`
- Create: `src/modules/qqbot/napcat/infrastructure/persistence/napcat-session-behavior-profile.entity.ts`
- Create: `src/modules/qqbot/napcat/infrastructure/persistence/napcat-login-event.entity.ts`
- Create: `src/modules/qqbot/napcat/infrastructure/persistence/napcat-risk-mode.entity.ts`
- Modify: `src/modules/qqbot/napcat/infrastructure/persistence/index.ts`
- Modify: `src/modules/qqbot/napcat/qqbot-napcat.module.ts`
- Modify: `sql/qqbot-init.sql`
- Modify: `sql/refactor-v3/00-full-schema.sql`
- Modify: `sql/refactor-v3/99-verify.sql`
- Modify: `src/modules/qqbot/napcat/schema/README.md`
- Test: `test/modules/qqbot/napcat/runtime-protocol-profile.spec.ts`
- Test: `test/modules/qqbot/napcat/napcat-persistent-login-state.spec.ts`

- [ ] **Step 1: Write the failing schema contract test**

Add this test file:

```ts
import { getMetadataArgsStorage } from 'typeorm';
import {
  NapcatLoginEvent,
  NapcatProtocolProfile,
  NapcatRiskMode,
  NapcatRuntimeProfile,
  NapcatSessionBehaviorProfile,
  NAPCAT_RUNTIME_DOMAIN_CONTRACT,
  NAPCAT_RUNTIME_ENTITIES,
} from '../../../../src/modules/qqbot/napcat';
import { readRefactorV3SqlSchema } from '../../../helpers/sql-schema.helper';

type EntityClass = new (...args: never[]) => unknown;

/**
 * Reads a TypeORM entity table name from decorator metadata.
 * @param entity - Entity class selected by the test to compare against SQL schema ownership.
 */
const getEntityTableName = (entity: EntityClass) =>
  getMetadataArgsStorage().tables.find((table) => table.target === entity)
    ?.name;

/**
 * Reads entity column names as they are persisted in MySQL.
 * @param entity - Entity class whose decorator column metadata must match refactor-v3 SQL.
 */
const getEntityColumnNames = (entity: EntityClass) =>
  getMetadataArgsStorage()
    .columns.filter((column) => column.target === entity)
    .map((column) => `${column.options.name || column.propertyName}`);

describe('NapCat runtime and protocol profile persistence', () => {
  const schema = readRefactorV3SqlSchema();

  it('declares runtime profile tables as NapCat-owned domain tables', () => {
    expect(NAPCAT_RUNTIME_DOMAIN_CONTRACT.tables).toEqual(
      expect.arrayContaining([
        'napcat_runtime_profile',
        'napcat_protocol_profile',
        'napcat_session_behavior_profile',
        'napcat_login_event',
        'napcat_risk_mode',
      ]),
    );
  });

  it.each([
    [NapcatRuntimeProfile, 'napcat_runtime_profile'],
    [NapcatProtocolProfile, 'napcat_protocol_profile'],
    [NapcatSessionBehaviorProfile, 'napcat_session_behavior_profile'],
    [NapcatLoginEvent, 'napcat_login_event'],
    [NapcatRiskMode, 'napcat_risk_mode'],
  ])('maps %p to %s in the v3 SQL schema', (entity, tableName) => {
    expect(NAPCAT_RUNTIME_ENTITIES).toContain(entity);
    expect(getEntityTableName(entity)).toBe(tableName);
    schema.expectTableColumns(tableName, getEntityColumnNames(entity));
  });

  it('keeps login-event fields separate from send budget fields', () => {
    const loginEventColumns = getEntityColumnNames(NapcatLoginEvent);
    expect(loginEventColumns).toEqual(
      expect.arrayContaining([
        'account_id',
        'container_id',
        'event_kind',
        'event_source',
        'event_status',
        'evidence',
      ]),
    );
    expect(loginEventColumns.join(' ')).not.toMatch(
      /hour|daily|quota|budget|limit_count/i,
    );
  });

  it('keeps risk mode separate from account send budgets', () => {
    const riskColumns = getEntityColumnNames(NapcatRiskMode);
    expect(riskColumns).toEqual(
      expect.arrayContaining([
        'account_id',
        'risk_mode',
        'reason',
        'source_event',
        'expires_at',
        'last_evidence',
      ]),
    );
    expect(riskColumns.join(' ')).not.toMatch(/daily|hour|budget|quota/i);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/napcat/runtime-protocol-profile.spec.ts
```

Expected: FAIL because the new entity exports and SQL tables do not exist.

- [ ] **Step 3: Add the TypeORM entities**

Create `src/modules/qqbot/napcat/infrastructure/persistence/napcat-login-event.entity.ts`:

```ts
import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtUpdateDateColumn,
} from '@/common';

export type NapcatLoginEventKind =
  | 'captcha_required'
  | 'container_recreate'
  | 'container_restart'
  | 'manual_qr_created'
  | 'manual_qr_scanned'
  | 'new_device_required'
  | 'password_attempt'
  | 'quick_attempt'
  | 'recovery_suspended';

export type NapcatLoginEventSource =
  | 'admin'
  | 'runtime'
  | 'system'
  | 'watchdog';

@Entity('napcat_login_event')
@Index('idx_napcat_login_event_account', ['accountId', 'createTime'])
@Index('idx_napcat_login_event_container', ['containerId', 'createTime'])
export class NapcatLoginEvent {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'account_id', type: 'bigint' })
  accountId: string;

  @Column({
    default: null,
    name: 'container_id',
    nullable: true,
    type: 'bigint',
  })
  containerId: null | string;

  @Column({ length: 64, name: 'event_kind' })
  eventKind: NapcatLoginEventKind;

  @Column({ length: 32, name: 'event_source' })
  eventSource: NapcatLoginEventSource;

  @Column({ length: 32, name: 'event_status' })
  eventStatus: 'blocked' | 'failed' | 'pending' | 'skipped' | 'success';

  @Column({ default: null, nullable: true, type: 'json' })
  evidence: null | Record<string, unknown>;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;

  /**
   * Assigns a Snowflake id before TypeORM inserts a login-event row.
   */
  @BeforeInsert()
  beforeInsert() {
    ensureSnowflakeId(this);
  }
}
```

Also create the other four entities using the same `PrimaryColumn`, `KtCreateDateColumn`, and `KtUpdateDateColumn` pattern. The exact required persisted property names are:

```ts
// NapcatRuntimeProfile
accountId, containerId, deviceIdentityId, profileVersion, imageRef,
imageDigest, baseImageDigest, desktopProfileVersion, localeAvailable,
fontconfigEvidence, timezoneEvidence, runtimeUid, runtimeGid, shmSize,
locale, xdgConfigHome, xdgCacheHome, xdgDataHome, persistCache,
persistLocalShare, persistLogs, hostnameStrategy, macStrategy,
migrateDeviceIdentity, profileStatus, lastCheckEvidence, lastCheckedAt

// NapcatProtocolProfile
accountId, containerId, profileVersion, packetBackend, packetServer,
o3HookMode, o3HookGrayEnabled, onebotConfigHash, onebotConfigJson,
napcatConfigHash, napcatConfigJson, profileStatus, lastCheckEvidence,
lastCheckedAt

// NapcatSessionBehaviorProfile
accountId, profileVersion, enabled, coldStartUntil, housekeepingEnabled,
housekeepingIntervalMs, nextHousekeepingAt, lastHousekeepingAt,
lastHousekeepingResult, presenceEnabled, presenceStrategy,
lastPresenceEventAt, nextPresenceEventAt, autoCapabilityStage,
lastBehaviorEvidence

// NapcatRiskMode
accountId, riskMode, reason, sourceEvent, expiresAt, lastEvidence
```

Each touched class and exported helper must include JSDoc for new functions or methods.

- [ ] **Step 4: Register entity exports**

Update `src/modules/qqbot/napcat/infrastructure/persistence/index.ts`:

```ts
import { NapcatLoginEvent } from './napcat-login-event.entity';
import { NapcatProtocolProfile } from './napcat-protocol-profile.entity';
import { NapcatRiskMode } from './napcat-risk-mode.entity';
import { NapcatRuntimeProfile } from './napcat-runtime-profile.entity';
import { NapcatSessionBehaviorProfile } from './napcat-session-behavior-profile.entity';

export const NAPCAT_RUNTIME_DOMAIN_CONTRACT = {
  tables: [
    'napcat_container',
    'napcat_device_identity',
    'napcat_account_binding',
    'napcat_login_session',
    'napcat_login_challenge',
    'napcat_runtime_cleanup',
    'napcat_runtime_profile',
    'napcat_protocol_profile',
    'napcat_session_behavior_profile',
    'napcat_login_event',
    'napcat_risk_mode',
  ],
} as const;

export const NAPCAT_RUNTIME_ENTITIES = [
  NapcatAccountBinding,
  NapcatContainer,
  NapcatDeviceIdentity,
  NapcatLoginChallengeEntity,
  NapcatLoginSession,
  NapcatRuntimeCleanup,
  NapcatRuntimeProfile,
  NapcatProtocolProfile,
  NapcatSessionBehaviorProfile,
  NapcatLoginEvent,
  NapcatRiskMode,
];

export {
  NapcatLoginEvent,
  NapcatProtocolProfile,
  NapcatRiskMode,
  NapcatRuntimeProfile,
  NapcatSessionBehaviorProfile,
};
```

- [ ] **Step 5: Add MySQL schema**

Add DDL blocks to `sql/qqbot-init.sql` and `sql/refactor-v3/00-full-schema.sql`. Use this shape exactly for login events:

```sql
CREATE TABLE IF NOT EXISTS `napcat_login_event` (
  `id` bigint NOT NULL,
  `account_id` bigint NOT NULL,
  `container_id` bigint DEFAULT NULL,
  `event_kind` varchar(64) NOT NULL,
  `event_source` varchar(32) NOT NULL,
  `event_status` varchar(32) NOT NULL,
  `evidence` json DEFAULT NULL,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_napcat_login_event_account` (`account_id`, `create_time`),
  KEY `idx_napcat_login_event_container` (`container_id`, `create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Use JSON columns only for evidence/config snapshots, never for tokens, passwords, or SSH private-key material. Add corresponding table-count and index checks to `sql/refactor-v3/99-verify.sql`.

- [ ] **Step 6: Run schema tests**

Run:

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/napcat/runtime-protocol-profile.spec.ts test/modules/qqbot/napcat/napcat-persistent-login-state.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git status --short
git add src/modules/qqbot/napcat/infrastructure/persistence src/modules/qqbot/napcat/qqbot-napcat.module.ts src/modules/qqbot/napcat/index.ts sql/qqbot-init.sql sql/refactor-v3/00-full-schema.sql sql/refactor-v3/99-verify.sql src/modules/qqbot/napcat/schema/README.md test/modules/qqbot/napcat/runtime-protocol-profile.spec.ts test/modules/qqbot/napcat/napcat-persistent-login-state.spec.ts
git commit -m "feat: 新增NapCat运行态Profile持久化"
```

---

## Task 2: Real-Device Identity Strategy And Migration Evidence

**Files:**
- Create: `src/modules/qqbot/napcat/domain/runtime/napcat-physical-oui-catalog.ts`
- Modify: `src/modules/qqbot/napcat/infrastructure/integration/device/napcat-device-identity.service.ts`
- Modify: `src/modules/qqbot/napcat/infrastructure/persistence/napcat-device-identity.entity.ts`
- Modify: `sql/qqbot-init.sql`
- Modify: `sql/refactor-v3/00-full-schema.sql`
- Modify: `sql/refactor-v3/99-verify.sql`
- Test: `test/modules/qqbot/napcat/device-identity.spec.ts`

- [ ] **Step 1: Add failing tests for hostname and MAC strategy**

First extend the local `createIdentityRepository()` helper in `test/modules/qqbot/napcat/device-identity.spec.ts`:

```ts
seedIdentity: jest.fn((identity: NapcatDeviceIdentity) => {
  identities.set(identity.accountId, identity);
}),
```

Then append these tests to the same file:

```ts
it('generates a real-device style hostname without QQBot or container words', async () => {
  const repository = createIdentityRepository();
  const service = new NapcatDeviceIdentityService(
    repository as any,
    createIdentityConfig(),
  );

  const identity = await service.resolveForAccount({
    accountId: 'account-10001',
    containerId: 'container-first',
    selfId: '10001',
  });

  expect(identity.hostname).toMatch(/^(ubuntu|linux)-pc-[a-f0-9]{8,12}$/);
  expect(identity.hostname).not.toMatch(/10001|qq|bot|napcat|docker/i);
});

it('generates a stable MAC from approved physical OUI prefixes', async () => {
  const repository = createIdentityRepository();
  const service = new NapcatDeviceIdentityService(
    repository as any,
    createIdentityConfig(),
  );

  const identity = await service.resolveForAccount({
    accountId: 'account-10001',
    containerId: 'container-first',
    selfId: '10001',
  });

  expect(identity.macAddress).toMatch(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/);
  expect(identity.macAddress).not.toMatch(/^02:42/i);
  expect(identity.macAddress).not.toMatch(/^52:54:00/i);
  expect(identity.macAddress).not.toMatch(/^(00:05:69|00:0c:29|00:1c:14|00:50:56)/i);
  expect(identity.macStrategy).toBe('physical-oui-v1');
});

it('records migration evidence when an existing Docker-style identity is upgraded', async () => {
  const repository = createIdentityRepository();
  repository.seedIdentity({
    accountId: 'account-10001',
    containerId: 'container-first',
    dataDir: '/vol1/docker/kt-qqbot/napcat-instances/kt-qqbot-napcat-10001',
    hostname: 'kt-qqbot-napcat-10001',
    id: 'identity-1',
    lastLoginEvidence: null,
    macAddress: '02:42:aa:bb:cc:dd',
    machineIdPath: '/vol1/docker/kt-qqbot/napcat-instances/kt-qqbot-napcat-10001/machine-id',
    verificationStatus: 'pending',
  } as NapcatDeviceIdentity);
  const service = new NapcatDeviceIdentityService(
    repository as any,
    createIdentityConfig(),
  );

  const identity = await service.resolveForAccount({
    accountId: 'account-10001',
    containerId: 'container-rebuilt',
    selfId: '10001',
  });

  expect(identity.macAddress).not.toBe('02:42:aa:bb:cc:dd');
  expect(identity.hostname).not.toBe('kt-qqbot-napcat-10001');
  expect(identity.lastLoginEvidence).toMatchObject({
    migration: {
      fromMacAddress: '02:42:aa:bb:cc:dd',
      strategy: 'physical-oui-v1',
      trigger: 'legacy-docker-identity-upgrade',
    },
  });
});
```

- [ ] **Step 2: Run the failing tests**

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/napcat/device-identity.spec.ts
```

Expected: FAIL because current code still generates `02:42` MAC addresses and hostnames such as `kt-qqbot-napcat-10001`.

- [ ] **Step 3: Add the OUI catalog**

Create `src/modules/qqbot/napcat/domain/runtime/napcat-physical-oui-catalog.ts`:

```ts
export const NAPCAT_PHYSICAL_OUI_PREFIXES = [
  '00:1A:2B',
  '00:1B:21',
  '00:1E:67',
  '00:22:68',
  '00:24:D7',
  '00:25:90',
  '00:26:B9',
  '3C:97:0E',
  '44:8A:5B',
  '58:11:22',
  '6C:88:14',
  '70:85:C2',
  '84:2B:2B',
  'A0:36:9F',
  'B4:2E:99',
] as const;

export const NAPCAT_REJECTED_VIRTUAL_OUI_PREFIXES = [
  '02:42',
  '52:54:00',
  '00:05:69',
  '00:0C:29',
  '00:1C:14',
  '00:50:56',
  '00:15:5D',
  '00:03:FF',
] as const;

/**
 * Checks whether a generated MAC starts with a rejected Docker or VM prefix.
 * @param macAddress - Stable MAC candidate generated from account/device seed.
 */
export function isRejectedVirtualMacPrefix(macAddress: string) {
  const normalized = macAddress.toUpperCase();
  return NAPCAT_REJECTED_VIRTUAL_OUI_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix.toUpperCase()),
  );
}
```

- [ ] **Step 4: Extend the device identity entity**

Add columns to `NapcatDeviceIdentity`:

```ts
@Column({ default: 'legacy', length: 64, name: 'hostname_strategy' })
hostnameStrategy: string;

@Column({ default: 'legacy', length: 64, name: 'mac_strategy' })
macStrategy: string;
```

Update both SQL schema files with matching columns.

- [ ] **Step 5: Replace hostname/MAC generation**

Modify `NapcatDeviceIdentityService`:

```ts
/**
 * Builds a stable desktop-like hostname that avoids account identifiers.
 * @param seed - Account and container seed used only for deterministic hashing.
 */
private buildDesktopHostname(seed: string) {
  const hash = createHash('sha256').update(seed).digest('hex');
  return `ubuntu-pc-${hash.slice(0, 10)}`;
}

/**
 * Builds a stable MAC using a physical-device-style OUI prefix.
 * @param accountId - Account id used as a deterministic seed, not as visible output.
 * @param containerName - Container name mixed into the deterministic seed.
 */
private buildPhysicalMacAddress(accountId: string, containerName: string) {
  const hash = createHash('sha256')
    .update(`${accountId}:${containerName}:physical-oui-v1`)
    .digest('hex');
  const prefixIndex =
    Number.parseInt(hash.slice(0, 4), 16) % NAPCAT_PHYSICAL_OUI_PREFIXES.length;
  const prefix = NAPCAT_PHYSICAL_OUI_PREFIXES[prefixIndex];
  const suffix = [hash.slice(4, 6), hash.slice(6, 8), hash.slice(8, 10)];
  const mac = `${prefix}:${suffix.join(':')}`.toLowerCase();
  if (isRejectedVirtualMacPrefix(mac)) {
    throw new Error(`Rejected generated virtual MAC prefix: ${mac}`);
  }
  return mac;
}
```

In `resolveForAccount`, when an existing identity has legacy hostname or rejected MAC, update it once with migration evidence:

```ts
const nextHostname = this.buildDesktopHostname(`${accountId}:${input.selfId || ''}`);
const nextMacAddress = this.buildPhysicalMacAddress(accountId, containerName);
const needsMigration =
  existing.hostname !== nextHostname ||
  isRejectedVirtualMacPrefix(existing.macAddress);

if (needsMigration) {
  const migrationEvidence = {
    migration: {
      fromHostname: existing.hostname,
      fromMacAddress: existing.macAddress,
      strategy: 'physical-oui-v1',
      toHostname: nextHostname,
      toMacAddress: nextMacAddress,
      trigger: 'legacy-docker-identity-upgrade',
    },
  };
  await this.identityRepository.update(
    { id: existing.id },
    {
      hostname: nextHostname,
      hostnameStrategy: 'desktop-hostname-v1',
      lastLoginEvidence: migrationEvidence,
      macAddress: nextMacAddress,
      macStrategy: 'physical-oui-v1',
    },
  );
  Object.assign(existing, {
    hostname: nextHostname,
    hostnameStrategy: 'desktop-hostname-v1',
    lastLoginEvidence: migrationEvidence,
    macAddress: nextMacAddress,
    macStrategy: 'physical-oui-v1',
  });
}
```

- [ ] **Step 6: Run the identity test**

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/napcat/device-identity.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/modules/qqbot/napcat/domain/runtime/napcat-physical-oui-catalog.ts src/modules/qqbot/napcat/infrastructure/integration/device/napcat-device-identity.service.ts src/modules/qqbot/napcat/infrastructure/persistence/napcat-device-identity.entity.ts sql/qqbot-init.sql sql/refactor-v3/00-full-schema.sql sql/refactor-v3/99-verify.sql test/modules/qqbot/napcat/device-identity.spec.ts
git commit -m "feat: 迁移NapCat真实设备风格身份"
```

---

## Task 3: Runtime And Protocol Profile Generation

**Files:**
- Create: `src/modules/qqbot/napcat/domain/runtime/napcat-profile.types.ts`
- Create: `src/modules/qqbot/napcat/domain/runtime/napcat-config-hash.ts`
- Create: `src/modules/qqbot/napcat/application/runtime/napcat-runtime-profile.service.ts`
- Create: `src/modules/qqbot/napcat/application/runtime/napcat-config-writer.service.ts`
- Modify: `src/modules/qqbot/napcat/infrastructure/integration/container/napcat-docker-device-options.ts`
- Modify: `src/modules/qqbot/napcat/infrastructure/integration/container/qqbot-napcat-container.service.ts`
- Modify: `src/modules/qqbot/napcat/qqbot-napcat.module.ts`
- Test: `test/modules/qqbot/napcat/runtime-protocol-profile.spec.ts`
- Test: `test/qqbot/napcat/qqbot-napcat-container.service.spec.ts`

- [ ] **Step 1: Add failing tests for Docker script and config output**

Append to `runtime-protocol-profile.spec.ts`:

```ts
import { ToolsService } from '@/common';
import { NapcatConfigWriterService } from '../../../../src/modules/qqbot/napcat/application/runtime/napcat-config-writer.service';
import { NapcatRuntimeProfileService } from '../../../../src/modules/qqbot/napcat/application/runtime/napcat-runtime-profile.service';

describe('NapCat runtime profile generation', () => {
  it('resolves Chinese Desktop Runtime defaults without C.UTF-8 fallback', () => {
    const service = new NapcatRuntimeProfileService({
      get: jest.fn((key: string, defaultValue?: string) => {
        const values: Record<string, string> = {
          QQBOT_NAPCAT_IMAGE: 'kt-napcat-desktop-cn@sha256:profiledigest',
          QQBOT_NAPCAT_RUNTIME_GID: '1101',
          QQBOT_NAPCAT_RUNTIME_UID: '1101',
          QQBOT_NAPCAT_SHM_SIZE: '512m',
        };
        return values[key] || defaultValue || '';
      }),
    } as any);

    const profile = service.resolveRuntimeProfile({
      accountId: 'account-1',
      containerId: 'container-1',
      dataDir: '/vol1/docker/kt-qqbot/napcat-instances/linux-pc-a1b2',
      deviceIdentityId: 'identity-1',
    });

    expect(profile).toMatchObject({
      imageRef: 'kt-napcat-desktop-cn@sha256:profiledigest',
      locale: 'zh_CN.UTF-8',
      runtimeGid: 1101,
      runtimeUid: 1101,
      shmSize: '512m',
      xdgCacheHome: '/app/.cache',
      xdgConfigHome: '/app/.config',
      xdgDataHome: '/app/.local/share',
    });
    expect(profile.locale).not.toBe('C.UTF-8');
  });

  it('writes account-level NapCat and OneBot configs with minimal reverse WS only', () => {
    const writer = new NapcatConfigWriterService(new ToolsService());
    const webuiAuthValue = 'KT_TEST_WEBUI_AUTH_VALUE';
    const result = writer.buildConfigFiles({
      account: '10001',
      reverseWsUrl: 'ws://127.0.0.1:48085/qqbot/onebot/reverse',
      token: webuiAuthValue,
    });

    expect(result.files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        'webui.json',
        'napcat.json',
        'napcat_10001.json',
        'onebot11.json',
        'onebot11_10001.json',
      ]),
    );
    expect(result.onebotConfig.network.websocketClients).toHaveLength(1);
    expect(result.onebotConfig.network.httpServers).toEqual([]);
    expect(result.onebotConfig.network.websocketServers).toEqual([]);
    expect(result.onebotConfig.network.websocketClients[0]).toMatchObject({
      debug: false,
      enable: true,
      heartInterval: 30000,
      messagePostFormat: 'array',
      reconnectInterval: 5000,
      reportSelfMessage: false,
    });
    expect(result.files.find((file) => file.path === 'webui.json')?.content).toContain(
      webuiAuthValue,
    );
    expect(
      JSON.stringify({
        napcatConfigHash: result.napcatConfigHash,
        onebotConfig: result.onebotConfig,
        onebotConfigHash: result.onebotConfigHash,
      }),
    ).not.toContain(webuiAuthValue);
  });
});
```

- [ ] **Step 2: Run the failing tests**

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/napcat/runtime-protocol-profile.spec.ts test/qqbot/napcat/qqbot-napcat-container.service.spec.ts
```

Expected: FAIL because profile/config services do not exist and Docker script lacks runtime flags.

- [ ] **Step 3: Add profile types**

Create `napcat-profile.types.ts`:

```ts
export type NapcatRuntimeProfileSnapshot = {
  accountId: string;
  containerId?: string;
  dataDir: string;
  desktopProfileVersion: string;
  deviceIdentityId?: string;
  imageRef: string;
  locale: 'zh_CN.UTF-8';
  persistCache: true;
  persistLocalShare: true;
  persistLogs: true;
  runtimeGid: number;
  runtimeUid: number;
  shmSize: string;
  timezone: 'Asia/Shanghai';
  xdgCacheHome: '/app/.cache';
  xdgConfigHome: '/app/.config';
  xdgDataHome: '/app/.local/share';
};

export type NapcatProtocolProfileSnapshot = {
  o3HookGrayEnabled: boolean;
  o3HookMode: 0 | 1;
  onebotConfigHash: string;
  packetBackend: 'auto';
  packetServer: '';
};

export type NapcatConfigFile = {
  content: string;
  path: string;
};
```

- [ ] **Step 4: Implement runtime profile resolver**

Create `napcat-runtime-profile.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NapcatRuntimeProfileSnapshot } from '../../domain/runtime/napcat-profile.types';

@Injectable()
export class NapcatRuntimeProfileService {
  /**
   * Initializes the profile resolver used before Docker script generation.
   * @param configService - Nest config provider that supplies image ref, UID/GID, shm size, and profile version.
   */
  constructor(private readonly configService: ConfigService) {}

  /**
   * Resolves the runtime profile for an account-owned NapCat container.
   * @param input - Account, container, data directory, and device identity ids that tie generated profile evidence to persistence.
   */
  resolveRuntimeProfile(input: {
    accountId: string;
    containerId?: string;
    dataDir: string;
    deviceIdentityId?: string;
  }): NapcatRuntimeProfileSnapshot {
    return {
      accountId: input.accountId,
      containerId: input.containerId,
      dataDir: input.dataDir,
      desktopProfileVersion: this.getString(
        'QQBOT_NAPCAT_DESKTOP_PROFILE_VERSION',
        'desktop-cn-v1',
      ),
      deviceIdentityId: input.deviceIdentityId,
      imageRef: this.getString('QQBOT_NAPCAT_IMAGE', ''),
      locale: 'zh_CN.UTF-8',
      persistCache: true,
      persistLocalShare: true,
      persistLogs: true,
      runtimeGid: this.getNumber('QQBOT_NAPCAT_RUNTIME_GID', 1101),
      runtimeUid: this.getNumber('QQBOT_NAPCAT_RUNTIME_UID', 1101),
      shmSize: this.getString('QQBOT_NAPCAT_SHM_SIZE', '512m'),
      timezone: 'Asia/Shanghai',
      xdgCacheHome: '/app/.cache',
      xdgConfigHome: '/app/.config',
      xdgDataHome: '/app/.local/share',
    };
  }

  /**
   * Reads a trimmed string config value.
   * @param key - Environment key that controls NapCat runtime profile generation.
   * @param defaultValue - Value used when the key is absent from runtime config.
   */
  private getString(key: string, defaultValue: string) {
    return `${this.configService.get<string>(key) || defaultValue}`.trim();
  }

  /**
   * Reads a positive numeric config value.
   * @param key - Environment key that should contain a numeric UID/GID value.
   * @param defaultValue - Safe non-root fallback for profile generation.
   */
  private getNumber(key: string, defaultValue: number) {
    const value = Number(this.configService.get<string>(key) || defaultValue);
    return Number.isFinite(value) && value > 0 ? value : defaultValue;
  }
}
```

- [ ] **Step 5: Implement config writer**

Create `napcat-config-writer.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ToolsService } from '@/common';
import { stableJsonHash } from '../../domain/runtime/napcat-config-hash';
import type { NapcatConfigFile } from '../../domain/runtime/napcat-profile.types';

@Injectable()
export class NapcatConfigWriterService {
  /**
   * Initializes the config writer with shared text helpers for sanitization.
   * @param toolsService - Shared helper used to trim account and URL values before writing config files.
   */
  constructor(private readonly toolsService: ToolsService) {}

  /**
   * Builds all NapCat and OneBot config files for one account container.
   * @param input - Account id, reverse WS URL, and WebUI token used to build runtime config files.
   */
  buildConfigFiles(input: {
    account?: string;
    reverseWsUrl: string;
    token: string;
  }) {
    const account = this.toolsService.toTrimmedString(input.account);
    const webuiConfig = {
      host: '0.0.0.0',
      loginRate: 3,
      port: 6099,
      token: input.token,
    };
    const napcatConfig = {
      bypass: {
        container: false,
        hook: false,
        js: false,
        module: false,
        process: false,
        window: false,
      },
      o3HookMode: 1,
      packetBackend: 'auto',
      packetServer: '',
    };
    const onebotConfig = {
      enableLocalFile2Url: false,
      musicSignUrl: '',
      network: {
        httpClients: [],
        httpServers: [],
        websocketClients: [
          {
            debug: false,
            enable: true,
            heartInterval: 30000,
            messagePostFormat: 'array',
            name: 'kt-template-online-api-reverse',
            reconnectInterval: 5000,
            reportSelfMessage: false,
            token: '',
            url: input.reverseWsUrl,
          },
        ],
        websocketServers: [],
      },
      parseMultMsg: false,
    };
    const files: NapcatConfigFile[] = [
      { path: 'webui.json', content: this.stringify(webuiConfig) },
      { path: 'napcat.json', content: this.stringify(napcatConfig) },
      { path: 'onebot11.json', content: this.stringify(onebotConfig) },
    ];
    if (account) {
      files.push(
        { path: `napcat_${account}.json`, content: this.stringify(napcatConfig) },
        { path: `onebot11_${account}.json`, content: this.stringify(onebotConfig) },
      );
    }

    return {
      files,
      napcatConfig,
      napcatConfigHash: stableJsonHash(napcatConfig),
      onebotConfig,
      onebotConfigHash: stableJsonHash(onebotConfig),
    };
  }

  /**
   * Serializes config JSON with stable indentation for hash and script tests.
   * @param value - Config object that will be written to `/app/napcat/config`.
   */
  private stringify(value: Record<string, unknown>) {
    return `${JSON.stringify(value, null, 2)}\n`;
  }
}
```

- [ ] **Step 6: Modify Docker script generation**

Inject `NapcatRuntimeProfileService` and `NapcatConfigWriterService` into `QqbotNapcatContainerService`. In `buildRemoteCreateScript`, add profile variables and run flags:

```ts
const runtimeProfile = this.runtimeProfileService.resolveRuntimeProfile({
  accountId: input.account || input.name,
  containerId: input.containerId,
  dataDir: input.dataDir,
  deviceIdentityId: input.deviceIdentity?.deviceIdentityId,
});
const configBundle = this.configWriter.buildConfigFiles({
  account,
  reverseWsUrl: input.reverseWsUrl,
  token: input.token,
});
```

The generated shell must contain these lines:

```sh
mkdir -p "$DATA_DIR/QQ" "$DATA_DIR/config" "$DATA_DIR/plugins" "$DATA_DIR/logs" "$DATA_DIR/cache" "$DATA_DIR/local-share"
docker run -d \
  --name "$NAME" \
  --restart unless-stopped \
  --init \
  --shm-size "$NAPCAT_SHM_SIZE" \
  -e NAPCAT_UID="$NAPCAT_UID" \
  -e NAPCAT_GID="$NAPCAT_GID" \
  -e LANG=zh_CN.UTF-8 \
  -e LC_ALL=zh_CN.UTF-8 \
  -e LANGUAGE=zh_CN:zh \
  -e TZ=Asia/Shanghai \
  -e HOME=/app \
  -e XDG_CONFIG_HOME=/app/.config \
  -e XDG_CACHE_HOME=/app/.cache \
  -e XDG_DATA_HOME=/app/.local/share \
  -e XDG_RUNTIME_DIR=/tmp/runtime-napcat \
  -v "$DATA_DIR/cache:/app/.cache" \
  -v "$DATA_DIR/local-share:/app/.local/share" \
  -v "$DATA_DIR/logs:/app/napcat/logs"
```

Do not remove the current `docker rm -f "$NAME"` from manual create/update yet; Task 6 adds event gating and watchdog limits around it.

- [ ] **Step 7: Run focused tests**

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/napcat/runtime-protocol-profile.spec.ts test/qqbot/napcat/qqbot-napcat-container.service.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/modules/qqbot/napcat/domain/runtime src/modules/qqbot/napcat/application/runtime src/modules/qqbot/napcat/infrastructure/integration/container src/modules/qqbot/napcat/qqbot-napcat.module.ts test/modules/qqbot/napcat/runtime-protocol-profile.spec.ts test/qqbot/napcat/qqbot-napcat-container.service.spec.ts
git commit -m "feat: 生成NapCat运行态与协议Profile"
```

---

## Task 4: Chinese Desktop Runtime Image Assets

**Files:**
- Create: `ci/napcat-desktop-cn/Dockerfile`
- Create: `ci/napcat-desktop-cn/verify.sh`
- Create: `ci/napcat-desktop-cn/README.md`
- Test: `test/modules/qqbot/napcat/napcat-desktop-cn-image.spec.ts`

- [ ] **Step 1: Write static image asset tests**

Create `test/modules/qqbot/napcat/napcat-desktop-cn-image.spec.ts`:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';

const repoRoot = join(__dirname, '../../../..');

/**
 * Reads a repo file as UTF-8 text for static image asset assertions.
 * @param relativePath - Repository-relative path under `Node/kt-template-online-api`.
 */
const readSource = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), 'utf8');

describe('NapCat Chinese Desktop Runtime image assets', () => {
  it('builds from an explicitly supplied pinned base image', () => {
    const dockerfile = readSource('ci/napcat-desktop-cn/Dockerfile');
    expect(dockerfile).toContain('ARG NAPCAT_BASE_IMAGE=');
    expect(dockerfile).toContain('FROM ${NAPCAT_BASE_IMAGE}');
    expect(dockerfile).not.toContain('mlikiowa/napcat-docker:latest');
  });

  it('installs Chinese locale, fonts, timezone, DBus, and fontconfig cache', () => {
    const dockerfile = readSource('ci/napcat-desktop-cn/Dockerfile');
    expect(dockerfile).toContain('zh_CN.UTF-8 UTF-8');
    expect(dockerfile).toContain('LANG=zh_CN.UTF-8');
    expect(dockerfile).toContain('LC_ALL=zh_CN.UTF-8');
    expect(dockerfile).toContain('Asia/Shanghai');
    expect(dockerfile).toMatch(/fonts-noto-cjk|fonts-wqy-microhei/);
    expect(dockerfile).toContain('fontconfig');
    expect(dockerfile).toContain('fc-cache -fv');
    expect(dockerfile).toContain('dbus-x11');
  });

  it('verifies locale, fontconfig, XDG, process user, and container hiding evidence', () => {
    const verify = readSource('ci/napcat-desktop-cn/verify.sh');
    expect(verify).toContain('locale -a');
    expect(verify).toContain('zh_CN.utf8');
    expect(verify).toContain('fc-match');
    expect(verify).toContain('/.dockerenv');
    expect(verify).toContain('/proc/1/cgroup');
    expect(verify).toContain('XDG_CONFIG_HOME=/app/.config');
    expect(verify).toContain('Asia/Shanghai');
  });
});
```

- [ ] **Step 2: Run the failing test**

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/napcat/napcat-desktop-cn-image.spec.ts
```

Expected: FAIL because `ci/napcat-desktop-cn` does not exist.

- [ ] **Step 3: Add `ci/napcat-desktop-cn/Dockerfile`**

```dockerfile
ARG NAPCAT_BASE_IMAGE
FROM ${NAPCAT_BASE_IMAGE}

USER root

RUN set -eux; \
  apt-get update; \
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    dbus-x11 \
    fontconfig \
    fonts-noto-cjk \
    fonts-wqy-microhei \
    locales \
    tzdata; \
  sed -i 's/^# *zh_CN.UTF-8 UTF-8/zh_CN.UTF-8 UTF-8/' /etc/locale.gen; \
  locale-gen zh_CN.UTF-8; \
  ln -snf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime; \
  echo Asia/Shanghai > /etc/timezone; \
  fc-cache -fv; \
  rm -rf /var/lib/apt/lists/*

ENV LANG=zh_CN.UTF-8 \
  LC_ALL=zh_CN.UTF-8 \
  LANGUAGE=zh_CN:zh \
  TZ=Asia/Shanghai \
  HOME=/app \
  XDG_CONFIG_HOME=/app/.config \
  XDG_CACHE_HOME=/app/.cache \
  XDG_DATA_HOME=/app/.local/share \
  XDG_RUNTIME_DIR=/tmp/runtime-napcat
```

Do not override upstream `ENTRYPOINT` or `CMD`.

- [ ] **Step 4: Add image verification script**

Create `ci/napcat-desktop-cn/verify.sh`:

```sh
#!/bin/sh
set -eu

locale -a | grep -i '^zh_CN\.utf8$'
locale | grep 'LANG=zh_CN.UTF-8'
test "$(cat /etc/timezone)" = "Asia/Shanghai"
fc-match "Noto Sans CJK SC" | grep -E 'Noto|WenQuanYi|wqy'
test "${XDG_CONFIG_HOME:-}" = "/app/.config"
test "${XDG_CACHE_HOME:-}" = "/app/.cache"
test "${XDG_DATA_HOME:-}" = "/app/.local/share"
test ! -e /.dockerenv
grep -q '^0::/$' /proc/1/cgroup
```

- [ ] **Step 5: Add README with exact commands**

Create `ci/napcat-desktop-cn/README.md`:

```md
# NapCat Chinese Desktop Runtime Image

Build from the locally inspected upstream digest:

```powershell
$baseImage = docker image inspect mlikiowa/napcat-docker:latest --format '{{index .RepoDigests 0}}'
if (-not $baseImage) { throw 'NapCat upstream image digest not found; pull and inspect the image before building.' }
docker build `
  --build-arg NAPCAT_BASE_IMAGE=$baseImage `
  -t kt-napcat-desktop-cn:desktop-cn-v1 `
  -f ci/napcat-desktop-cn/Dockerfile .
```

Verify:

```powershell
docker run --rm kt-napcat-desktop-cn:desktop-cn-v1 sh /ci/napcat-desktop-cn/verify.sh
```

Record the final digest in `QQBOT_NAPCAT_IMAGE`.
```

- [ ] **Step 6: Run the image asset test**

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/napcat/napcat-desktop-cn-image.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add ci/napcat-desktop-cn test/modules/qqbot/napcat/napcat-desktop-cn-image.spec.ts
git commit -m "chore: 增加NapCat中文桌面派生镜像资产"
```

---

## Task 5: Runtime Inspector, Drift Evidence, And Read-Only API

**Files:**
- Create: `src/modules/qqbot/napcat/application/runtime/napcat-runtime-profile-inspector.service.ts`
- Create: `src/modules/qqbot/napcat/contract/qqbot-napcat-runtime.dto.ts`
- Create: `src/modules/qqbot/napcat/contract/qqbot-napcat-runtime.controller.ts`
- Modify: `src/modules/qqbot/napcat/application/account-runtime/qqbot-napcat-account-runtime.service.ts`
- Modify: `src/modules/qqbot/core/contract/qqbot.types.ts`
- Modify: `src/modules/qqbot/napcat/qqbot-napcat.module.ts`
- Test: `test/modules/qqbot/napcat/runtime-protocol-profile.spec.ts`

- [ ] **Step 1: Add failing inspector/API tests**

Append to `runtime-protocol-profile.spec.ts`:

```ts
import { NapcatRuntimeProfileInspectorService } from '../../../../src/modules/qqbot/napcat/application/runtime/napcat-runtime-profile-inspector.service';

describe('NapCat runtime profile inspector', () => {
  it('builds a bounded SSH inspection script without exposing secrets', () => {
    const service = new NapcatRuntimeProfileInspectorService(
      {} as any,
      {} as any,
      {} as any,
      new ToolsService(),
    ) as any;

    const script = service.buildInspectScript('kt-qqbot-napcat-10001');

    expect(script).toContain('docker inspect');
    expect(script).toContain('locale -a');
    expect(script).toContain('fc-match');
    expect(script).toContain('/proc/1/cgroup');
    expect(script).toContain('/.dockerenv');
    expect(script).not.toContain('WEBUI_TOKEN');
    expect(script).not.toContain('NAPCAT_QUICK_PASSWORD');
  });

  it('sanitizes config and evidence before returning to Admin', () => {
    const service = new NapcatRuntimeProfileInspectorService(
      {} as any,
      {} as any,
      {} as any,
      new ToolsService(),
    ) as any;
    const sensitiveKey = 'token';
    const passwordKey = 'password';
    const rawEvidence = {
      nested: Object.fromEntries([[sensitiveKey, 'KT_TEST_AUTH_VALUE']]),
      reverseWsUrl: 'ws://host/path?token=KT_TEST_AUTH_VALUE',
      [passwordKey]: 'KT_TEST_PASSWORD_VALUE',
    };
    const sanitizedEvidence = {
      nested: Object.fromEntries([[sensitiveKey, '[REDACTED]']]),
      reverseWsUrl: 'ws://host/path?token=[REDACTED]',
      [passwordKey]: '[REDACTED]',
    };

    expect(service.sanitizeEvidence(rawEvidence)).toEqual(sanitizedEvidence);
  });
});
```

- [ ] **Step 2: Run the failing tests**

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/napcat/runtime-protocol-profile.spec.ts
```

Expected: FAIL because inspector service does not exist.

- [ ] **Step 3: Implement inspector service**

Create `napcat-runtime-profile-inspector.service.ts` with methods:

```ts
@Injectable()
export class NapcatRuntimeProfileInspectorService {
  /**
   * Initializes runtime inspection over the existing SSH-managed container model.
   * @param runtimeProfileRepository - Runtime profile repository updated with latest Docker and desktop evidence.
   * @param protocolProfileRepository - Protocol profile repository updated with config hashes and drift state.
   * @param configService - Runtime config provider used for SSH target and timeouts.
   * @param toolsService - Shared helper used to redact sensitive evidence fields.
   */
  constructor(
    @InjectRepository(NapcatRuntimeProfile)
    private readonly runtimeProfileRepository: Repository<NapcatRuntimeProfile>,
    @InjectRepository(NapcatProtocolProfile)
    private readonly protocolProfileRepository: Repository<NapcatProtocolProfile>,
    private readonly configService: ConfigService,
    private readonly toolsService: ToolsService,
  ) {}

  /**
   * Builds the remote inspection script for Docker and in-container profile evidence.
   * @param containerName - Docker container name selected from the persisted NapCat container row.
   */
  buildInspectScript(containerName: string) {
    return `
set -eu
NAME=${this.sh(containerName)}
docker inspect "$NAME"
docker exec "$NAME" sh -lc 'locale -a; locale; date +%Z; fc-match "Noto Sans CJK SC"; test ! -e /.dockerenv; cat /proc/1/cgroup; id; ps -eo user,args | grep -E "qq|NapCat|Xvfb" | grep -v grep || true'
`;
  }

  /**
   * Redacts secrets before evidence is stored, logged, or returned to Admin.
   * @param value - Evidence object or primitive produced by Docker, NapCat, or config writers.
   */
  sanitizeEvidence(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.sanitizeEvidence(item));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => {
        if (/password|token|secret|privateKey/i.test(key)) {
          return [key, '[REDACTED]'];
        }
        if (typeof item === 'string') {
          return [key, item.replace(/token=[^&\s]+/gi, 'token=[REDACTED]')];
        }
        return [key, this.sanitizeEvidence(item)];
      }),
    );
  }
}
```

- [ ] **Step 4: Add read-only controller**

Create controller endpoints:

```ts
@Controller('qqbot/napcat/runtime')
@UseGuards(JwtAuthGuard)
export class QqbotNapcatRuntimeController {
  /**
   * Initializes the read-only NapCat runtime controller.
   * @param inspector - Inspector service that returns sanitized profile detail and login-event evidence.
   */
  constructor(private readonly inspector: NapcatRuntimeProfileInspectorService) {}

  /**
   * Returns sanitized runtime profile detail for one account.
   * @param accountId - Account id used to locate NapCat profile rows and recent login events.
   */
  @Get('detail')
  async detail(@Query('accountId') accountId: string) {
    return this.inspector.getAccountRuntimeDetail(accountId);
  }
}
```

Register the controller in `QQBOT_NAPCAT_CONTROLLERS`.

- [ ] **Step 5: Extend account list runtime summary**

Add summary fields in `QqbotAccountNapcatRuntimeInfo`:

```ts
profileStatus?: 'drift' | 'failed' | 'ok' | 'unknown';
recoveryState?: 'idle' | 'password' | 'quick' | 'suspended';
riskMode?: 'cooldown' | 'manual_only' | 'normal';
runtimeProfile?: {
  desktopProfileVersion?: string;
  imageDigest?: string;
  imageRef?: string;
  locale?: string;
  shmSize?: string;
};
```

Populate them in `QqbotNapcatAccountRuntimeService.appendRuntime()` using the new profile repositories or inspector summary method.

- [ ] **Step 6: Run focused tests and typecheck**

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/napcat/runtime-protocol-profile.spec.ts
pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/modules/qqbot/napcat/application/runtime src/modules/qqbot/napcat/contract src/modules/qqbot/napcat/application/account-runtime/qqbot-napcat-account-runtime.service.ts src/modules/qqbot/core/contract/qqbot.types.ts src/modules/qqbot/napcat/qqbot-napcat.module.ts test/modules/qqbot/napcat/runtime-protocol-profile.spec.ts
git commit -m "feat: 暴露NapCat运行态Profile只读证据"
```

---

## Task 6: Login Events, Recovery Lease, And Watchdog Boundaries

**Files:**
- Create: `src/modules/qqbot/napcat/application/runtime/napcat-login-event.service.ts`
- Modify: `src/modules/qqbot/napcat/infrastructure/integration/container/qqbot-napcat-container.service.ts`
- Modify: `src/modules/qqbot/napcat/application/account-runtime/qqbot-napcat-account-runtime.service.ts`
- Modify: `src/modules/qqbot/core/application/account/qqbot-account.service.ts`
- Test: `test/modules/qqbot/napcat/login-event-watchdog.spec.ts`
- Test: `test/qqbot/account/qqbot-napcat-watchdog.service.spec.ts`
- Test: `test/qqbot/napcat/qqbot-napcat-container.service.spec.ts`

- [ ] **Step 1: Add failing watchdog boundary tests**

Create `test/modules/qqbot/napcat/login-event-watchdog.spec.ts`:

```ts
import { NapcatLoginEventService } from '../../../../src/modules/qqbot/napcat/application/runtime/napcat-login-event.service';

const createRepository = () => ({
  create: jest.fn((input) => input),
  findOne: jest.fn(),
  save: jest.fn(async (input) => input),
  update: jest.fn(),
});

describe('NapCat login event and recovery lease', () => {
  it('records quick and password attempts as login events, not send budgets', async () => {
    const repository = createRepository();
    const service = new NapcatLoginEventService(repository as any);

    await service.record({
      accountId: 'account-1',
      containerId: 'container-1',
      eventKind: 'quick_attempt',
      eventSource: 'watchdog',
      eventStatus: 'success',
      evidence: { method: 'quick' },
    });
    await service.record({
      accountId: 'account-1',
      containerId: 'container-1',
      eventKind: 'password_attempt',
      eventSource: 'watchdog',
      eventStatus: 'failed',
      evidence: { method: 'password' },
    });

    expect(repository.save).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(repository.save.mock.calls)).not.toMatch(/daily|hour|quota|budget/i);
  });

  it('suspends automatic recovery after captcha, new-device, or manual QR is required', async () => {
    const repository = createRepository();
    const service = new NapcatLoginEventService(repository as any);

    await service.recordSuspended({
      accountId: 'account-1',
      containerId: 'container-1',
      evidence: { reason: 'new-device-required' },
      reason: 'new_device_required',
      source: 'watchdog',
    });

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKind: 'recovery_suspended',
        eventSource: 'watchdog',
        eventStatus: 'blocked',
      }),
    );
  });
});
```

- [ ] **Step 2: Run failing tests**

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/napcat/login-event-watchdog.spec.ts test/qqbot/account/qqbot-napcat-watchdog.service.spec.ts
```

Expected: FAIL because `NapcatLoginEventService` does not exist.

- [ ] **Step 3: Implement login event service**

Create `napcat-login-event.service.ts`:

```ts
@Injectable()
export class NapcatLoginEventService {
  /**
   * Initializes login-event persistence.
   * @param loginEventRepository - Repository used to append login-side risk events.
   */
  constructor(
    @InjectRepository(NapcatLoginEvent)
    private readonly loginEventRepository: Repository<NapcatLoginEvent>,
  ) {}

  /**
   * Records a login-side event for audit, recovery gating, and Admin display.
   * @param input - Event payload produced by Admin actions, watchdog, runtime checks, or system workflows.
   */
  async record(input: {
    accountId: string;
    containerId?: null | string;
    eventKind: NapcatLoginEventKind;
    eventSource: NapcatLoginEventSource;
    eventStatus: 'blocked' | 'failed' | 'pending' | 'skipped' | 'success';
    evidence?: Record<string, unknown>;
  }) {
    return this.loginEventRepository.save(
      this.loginEventRepository.create({
        accountId: input.accountId,
        containerId: input.containerId || null,
        eventKind: input.eventKind,
        eventSource: input.eventSource,
        eventStatus: input.eventStatus,
        evidence: input.evidence || null,
      }),
    );
  }

  /**
   * Records that automatic recovery stopped before QR, captcha, or new-device flow.
   * @param input - Account, container, source, and reason that explain why automation stopped.
   */
  recordSuspended(input: {
    accountId: string;
    containerId?: null | string;
    evidence: Record<string, unknown>;
    reason: NapcatLoginEventKind;
    source: NapcatLoginEventSource;
  }) {
    return this.record({
      accountId: input.accountId,
      containerId: input.containerId,
      eventKind: 'recovery_suspended',
      eventSource: input.source,
      eventStatus: 'blocked',
      evidence: {
        ...input.evidence,
        reason: input.reason,
      },
    });
  }
}
```

- [ ] **Step 4: Wire event recording into auto-login**

In `QqbotNapcatContainerService.tryAutoLogin()`:

```ts
await this.loginEventService.record({
  accountId: container.accountId || '',
  containerId: container.id,
  eventKind: 'quick_attempt',
  eventSource: 'watchdog',
  eventStatus: 'pending',
  evidence: { containerName: container.name },
});
```

Record `password_attempt` before password recovery. If quick/password flows encounter captcha/new-device/manual QR, call `recordSuspended()` and return `{ success: false }`.

- [ ] **Step 5: Prevent repeated destructive rebuilds from watchdog**

Add a guard in `QqbotNapcatAccountRuntimeService.tryAutoLogin()` before calling container auto-login:

```ts
const recoveryGate = await this.loginEventService.canAttemptAutomaticRecovery({
  accountId: account.id,
  containerId: container.id,
});
if (!recoveryGate.allowed) {
  await this.loginEventService.recordSuspended({
    accountId: account.id,
    containerId: container.id,
    evidence: { reason: recoveryGate.reason },
    reason: 'recovery_suspended',
    source: 'watchdog',
  });
  return false;
}
```

`canAttemptAutomaticRecovery()` must block if the most recent relevant event is `captcha_required`, `new_device_required`, `manual_qr_created`, or `recovery_suspended` without manual reset evidence.

- [ ] **Step 6: Add negative tests for no auto QR and no repeated `docker rm -f`**

Append to `qqbot-napcat-container.service.spec.ts`:

```ts
it('does not create a manual QR session from watchdog auto-login', async () => {
  const service = new QqbotNapcatContainerService(
    { get: jest.fn().mockReturnValue('') } as any,
    {} as any,
    {} as any,
    new ToolsService(),
  ) as any;
  service.getManagedMode = jest.fn().mockReturnValue('ssh');
  service.findContainerWithToken = jest.fn().mockResolvedValue({
    id: 'container-1',
    name: 'kt-qqbot-napcat-10001',
  });
  service.ensureRuntimeLoginEnv = jest.fn().mockResolvedValue({ changed: false, ok: true });
  service.restartAndDetectLoginState = jest.fn().mockResolvedValue({ state: 'offline' });

  const result = await service.tryAutoLogin(
    { id: 'container-1', name: 'kt-qqbot-napcat-10001' },
    { selfId: '10001' },
  );

  expect(result.success).toBe(false);
  expect(JSON.stringify(service.runProcess?.mock?.calls || [])).not.toContain('qrcode');
});
```

- [ ] **Step 7: Run focused tests**

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/napcat/login-event-watchdog.spec.ts test/qqbot/account/qqbot-napcat-watchdog.service.spec.ts test/qqbot/napcat/qqbot-napcat-container.service.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/modules/qqbot/napcat/application/runtime/napcat-login-event.service.ts src/modules/qqbot/napcat/infrastructure/integration/container/qqbot-napcat-container.service.ts src/modules/qqbot/napcat/application/account-runtime/qqbot-napcat-account-runtime.service.ts src/modules/qqbot/core/application/account/qqbot-account.service.ts test/modules/qqbot/napcat/login-event-watchdog.spec.ts test/qqbot/account/qqbot-napcat-watchdog.service.spec.ts test/qqbot/napcat/qqbot-napcat-container.service.spec.ts
git commit -m "feat: 稳定NapCat自动恢复登录事件"
```

---

## Task 7: Session Behavior Profile And Risk Degradation

**Files:**
- Create: `src/modules/qqbot/napcat/application/runtime/napcat-session-behavior.service.ts`
- Modify: `src/modules/qqbot/core/application/send/qqbot-rate-limit.service.ts`
- Modify: `src/modules/qqbot/core/application/send/qqbot-send.service.ts`
- Modify: `src/modules/qqbot/core/application/rule/qqbot-rule-engine.service.ts`
- Modify: `src/modules/qqbot/core/application/command/qqbot-command-engine.service.ts`
- Test: `test/modules/qqbot/napcat/session-behavior-profile.spec.ts`
- Test existing send/rule/command tests as touched.

- [ ] **Step 1: Add failing behavior profile tests**

Create `test/modules/qqbot/napcat/session-behavior-profile.spec.ts`:

```ts
import { NapcatSessionBehaviorService } from '../../../../src/modules/qqbot/napcat/application/runtime/napcat-session-behavior.service';

describe('NapCat session behavior profile', () => {
  it('keeps cold-start staged capability separate from send budgets', () => {
    const service = new NapcatSessionBehaviorService();
    const profile = service.createDefaultProfile('account-1', new Date('2026-06-18T03:00:00.000Z'));

    expect(profile).toMatchObject({
      accountId: 'account-1',
      autoCapabilityStage: 'manual_command',
      housekeepingEnabled: true,
      presenceEnabled: false,
    });
    expect(JSON.stringify(profile)).not.toMatch(/daily|hour|quota|budget/i);
  });

  it('does not trigger login reset, password retry, docker recreate, or QR refresh on housekeeping failure', () => {
    const service = new NapcatSessionBehaviorService();
    const decision = service.handleHousekeepingFailure({
      accountId: 'account-1',
      failureMessage: 'NapCat status API timeout',
    });

    expect(decision).toEqual({
      disableBehaviorExtensions: true,
      loginAction: 'none',
      recordEvidence: true,
    });
  });

  it('steps capability recovery from manual command to automation only after windows pass', () => {
    const service = new NapcatSessionBehaviorService();
    expect(service.nextCapabilityStage('manual_command')).toBe('low_risk_text');
    expect(service.nextCapabilityStage('low_risk_text')).toBe('image_and_large_message');
    expect(service.nextCapabilityStage('image_and_large_message')).toBe('automation');
    expect(service.nextCapabilityStage('automation')).toBe('automation');
  });
});
```

- [ ] **Step 2: Run failing tests**

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/napcat/session-behavior-profile.spec.ts
```

Expected: FAIL because service does not exist.

- [ ] **Step 3: Implement behavior service**

Create `napcat-session-behavior.service.ts`:

```ts
export type NapcatAutoCapabilityStage =
  | 'automation'
  | 'image_and_large_message'
  | 'low_risk_text'
  | 'manual_command';

@Injectable()
export class NapcatSessionBehaviorService {
  /**
   * Creates the first behavior profile after account login or profile migration.
   * @param accountId - Account id whose automation stage and housekeeping schedule are initialized.
   * @param now - Current time supplied by caller for deterministic tests and evidence.
   */
  createDefaultProfile(accountId: string, now = new Date()) {
    return {
      accountId,
      autoCapabilityStage: 'manual_command' as const,
      coldStartUntil: new Date(now.getTime() + 10 * 60_000),
      housekeepingEnabled: true,
      housekeepingIntervalMs: 30 * 60_000,
      nextHousekeepingAt: new Date(now.getTime() + 30 * 60_000),
      presenceEnabled: false,
      presenceStrategy: 'disabled',
      profileVersion: 'session-behavior-v1',
    };
  }

  /**
   * Converts housekeeping failure into evidence-only action.
   * @param input - Account and failure summary from a low-side-effect housekeeping call.
   */
  handleHousekeepingFailure(input: {
    accountId: string;
    failureMessage: string;
  }) {
    return {
      disableBehaviorExtensions: true,
      loginAction: 'none' as const,
      recordEvidence: true,
    };
  }

  /**
   * Calculates the next automation recovery stage after the current stage passes its observation window.
   * @param stage - Current staged capability value persisted for the account.
   */
  nextCapabilityStage(stage: NapcatAutoCapabilityStage): NapcatAutoCapabilityStage {
    if (stage === 'manual_command') return 'low_risk_text';
    if (stage === 'low_risk_text') return 'image_and_large_message';
    return 'automation';
  }
}
```

- [ ] **Step 4: Wire risk degradation into send/rule/command paths**

Add a small read-only decision call before automatic rule replies and event-driven automation. Manual `/qqbot/command/test` and Admin-triggered smoke must remain allowed.

Use this decision shape:

```ts
type NapcatAutomationDecision = {
  allowed: boolean;
  reason?: string;
};
```

When blocked, log the skip and avoid sending a reply. Do not write or check any hourly/daily quota field.

- [ ] **Step 5: Run behavior tests and targeted send tests**

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/napcat/session-behavior-profile.spec.ts
pnpm exec jest --runInBand --runTestsByPath test/qqbot/account/qqbot-napcat-watchdog.service.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Run forbidden budget scan**

```powershell
rg -n "daily.*send|hour.*send|quota|budget|dailyLimit|hourlyLimit" src/modules/qqbot test/modules/qqbot test/qqbot
```

Expected: no matches outside comments that explicitly say the feature is not implemented. If a match appears in new implementation code, remove that design.

- [ ] **Step 7: Commit**

```powershell
git add src/modules/qqbot/napcat/application/runtime/napcat-session-behavior.service.ts src/modules/qqbot/core/application/send src/modules/qqbot/core/application/rule src/modules/qqbot/core/application/command test/modules/qqbot/napcat/session-behavior-profile.spec.ts
git commit -m "feat: 增加NapCat会话行为Profile"
```

---

## Task 8: Admin Read-Only Runtime Profile Drawer

**Files:**
- Modify: `Vue/kt-template-admin/apps/web-antdv-next/src/api/qqbot/index.ts`
- Modify: `Vue/kt-template-admin/apps/web-antdv-next/src/api/qqbot/napcat.ts`
- Create: `Vue/kt-template-admin/apps/web-antdv-next/src/views/qqbot/account/napcat/NapcatRuntimeProfileDrawer.tsx`
- Modify: `Vue/kt-template-admin/apps/web-antdv-next/src/views/qqbot/account/list.tsx`
- Modify: `Vue/kt-template-admin/apps/web-antdv-next/src/views/qqbot/modules/status.ts`
- Test: `Vue/kt-template-admin/apps/web-antdv-next/src/api/qqbot/napcat.spec.ts`
- Test: `Vue/kt-template-admin/apps/web-antdv-next/src/views/qqbot/account/napcat/NapcatRuntimeProfileDrawer.spec.tsx`

- [ ] **Step 1: Add API caller tests**

In `napcat.spec.ts`, add:

```ts
it('builds the read-only NapCat runtime detail request', async () => {
  const request = vi.spyOn(requestClient, 'get').mockResolvedValue({} as never);

  await getQqbotNapcatRuntimeDetail('account-1');

  expect(request).toHaveBeenCalledWith('/qqbot/napcat/runtime/detail', {
    params: { accountId: 'account-1' },
  });
});
```

- [ ] **Step 2: Add API caller**

In `napcat.ts`:

```ts
export interface NapcatRuntimeProfileDetail {
  loginEvents: Array<{
    createTime?: string;
    eventKind: string;
    eventSource: string;
    eventStatus: string;
  }>;
  protocolProfile?: Record<string, unknown>;
  riskMode?: Record<string, unknown>;
  runtimeProfile?: Record<string, unknown>;
  sessionBehaviorProfile?: Record<string, unknown>;
}

export function getQqbotNapcatRuntimeDetail(accountId: string) {
  return requestClient.get<NapcatRuntimeProfileDetail>(
    '/qqbot/napcat/runtime/detail',
    { params: { accountId } },
  );
}
```

- [ ] **Step 3: Create drawer component**

Create `NapcatRuntimeProfileDrawer.tsx`:

```tsx
import type { PropType } from 'vue';
import type { QqbotApi } from '#/api/qqbot';

import { defineComponent, ref, watch } from 'vue';
import { Descriptions, Drawer, List, Spin, Tag } from 'antdv-next';
import {
  getQqbotNapcatRuntimeDetail,
  type NapcatRuntimeProfileDetail,
} from '#/api/qqbot/napcat';

const ADescriptions = Descriptions as any;
const ADrawer = Drawer as any;
const AList = List as any;
const ASpin = Spin as any;

export default defineComponent({
  name: 'NapcatRuntimeProfileDrawer',
  props: {
    account: {
      default: undefined,
      type: Object as PropType<QqbotApi.Account | undefined>,
    },
    open: {
      default: false,
      type: Boolean,
    },
  },
  emits: ['update:open'],
  setup(props, { emit }) {
    const detail = ref<NapcatRuntimeProfileDetail>();
    const loading = ref(false);

    watch(
      () => [props.open, props.account?.id] as const,
      () => {
        if (props.open && props.account?.id) void loadDetail();
      },
      { immediate: true },
    );

    /**
     * Loads sanitized runtime profile evidence for the selected account.
     */
    async function loadDetail() {
      if (!props.account?.id) return;
      loading.value = true;
      try {
        detail.value = await getQqbotNapcatRuntimeDetail(props.account.id);
      } finally {
        loading.value = false;
      }
    }

    return () => (
      <ADrawer
        open={props.open}
        title="NapCat 运行态证据"
        width={720}
        onClose={() => emit('update:open', false)}
      >
        <ASpin spinning={loading.value}>
          <ADescriptions column={1} bordered size="small">
            <ADescriptions.Item label="Profile 状态">
              <Tag>{props.account?.napcat?.profileStatus || 'unknown'}</Tag>
            </ADescriptions.Item>
            <ADescriptions.Item label="风险模式">
              <Tag>{props.account?.napcat?.riskMode || 'normal'}</Tag>
            </ADescriptions.Item>
            <ADescriptions.Item label="恢复状态">
              <Tag>{props.account?.napcat?.recoveryState || 'idle'}</Tag>
            </ADescriptions.Item>
          </ADescriptions>
          <AList
            class="mt-4"
            dataSource={detail.value?.loginEvents || []}
            renderItem={({ item }: any) => (
              <AList.Item>
                <span>{item.createTime}</span>
                <span class="ml-3">{item.eventKind}</span>
                <Tag class="ml-3">{item.eventStatus}</Tag>
              </AList.Item>
            )}
          />
        </ASpin>
      </ADrawer>
    );
  },
});
```

- [ ] **Step 4: Add list row action**

In `account/list.tsx`, add a ref for drawer state and a row action:

```tsx
const runtimeProfileOpen = ref(false);
const runtimeProfileAccount = ref<QqbotApi.Account>();

function openRuntimeProfile(row: QqbotApi.Account) {
  runtimeProfileAccount.value = row;
  runtimeProfileOpen.value = true;
}
```

Add action:

```ts
{
  key: 'runtimeProfile',
  label: '运行态',
  onClick: openRuntimeProfile,
  permissionCodes: ['QqBot:Account:Config'],
}
```

Render drawer beside `NapcatLoginModal` under the single page root.

- [ ] **Step 5: Run Admin tests and typecheck**

```powershell
pnpm --dir D:/MyFiles/KT/Vue/kt-template-admin exec vitest run apps/web-antdv-next/src/api/qqbot/napcat.spec.ts apps/web-antdv-next/src/views/qqbot/account/napcat/NapcatRuntimeProfileDrawer.spec.tsx
pnpm --dir D:/MyFiles/KT/Vue/kt-template-admin run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Admin repo**

```powershell
git -C D:/MyFiles/KT/Vue/kt-template-admin status --short
git -C D:/MyFiles/KT/Vue/kt-template-admin add apps/web-antdv-next/src/api/qqbot apps/web-antdv-next/src/views/qqbot/account apps/web-antdv-next/src/views/qqbot/modules/status.ts
git -C D:/MyFiles/KT/Vue/kt-template-admin commit -m "feat: 展示NapCat运行态Profile证据"
```

---

## Task 9: API Docs, Online Migration Runbook, And Verification Matrix

**Files:**
- Modify: `API.md`
- Modify: `README.md`
- Modify: `docs/specs/2026-06-18-qqbot-napcat-linux-runtime-protocol-profile-design.md` only if implementation changes the confirmed design boundary.
- Modify: `D:/MyFiles/KT/docs/qqbot-nas-runtime.md`
- Modify: `D:/MyFiles/KT/docs/obsidian/modules/KT 模块 - QQBot BangDream FFLogs.md`
- Modify: `D:/MyFiles/KT/TASKS.md`

- [ ] **Step 1: Update API docs**

Add to `API.md` under QQBot/NapCat:

```md
### NapCat Runtime Profile

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/qqbot/napcat/runtime/detail?accountId=` | 读取账号 NapCat runtime/protocol/session behavior profile、风险降载和最近登录事件 |

该接口只返回脱敏后的运行态证据，不返回 WebUI token、reverse WS token、QQ 登录密码、SSH 私钥或运行态密码环境。watchdog 自动恢复只允许 quick -> password，遇到二维码、验证码或新设备验证会挂起并记录 `recovery_suspended`。
```

- [ ] **Step 2: Update online runbook**

In `D:/MyFiles/KT/docs/qqbot-nas-runtime.md`, add a section:

```md
## NapCat Runtime/Protocol Profile 上线顺序

1. 先上线 profile/evidence 和只读 Admin 展示。
2. 再上线登录事件与 watchdog quick -> password 熔断。
3. 再上线 session behavior profile。
4. 测试账号灰度 `o3HookMode=0`。
5. 构建并使用 `kt-napcat-desktop-cn` 派生镜像。
6. 现有风控账号按批次迁移真实设备风格 hostname/MAC/machine-id。

watchdog 不自动生成或刷新二维码，不重复 `docker rm -f`，不做账号小时/每日发送预算。
```

- [ ] **Step 3: Run doc sync tool**

```powershell
pnpm --dir D:/MyFiles/KT/mcp/ktWorkflow run obsidian-validate
```

Expected: PASS. If this fails because only docs links changed, fix the broken link reported by the validator before continuing.

- [ ] **Step 4: Run API verification**

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/napcat/runtime-protocol-profile.spec.ts test/modules/qqbot/napcat/device-identity.spec.ts test/modules/qqbot/napcat/login-event-watchdog.spec.ts test/modules/qqbot/napcat/session-behavior-profile.spec.ts test/modules/qqbot/napcat/napcat-desktop-cn-image.spec.ts test/qqbot/napcat/qqbot-napcat-container.service.spec.ts test/qqbot/account/qqbot-napcat-watchdog.service.spec.ts
pnpm run typecheck
git diff --check
```

Expected: all tests PASS, typecheck PASS, diff-check exit 0.

- [ ] **Step 5: Run global review**

```powershell
pnpm --dir D:/MyFiles/KT/mcp/ktWorkflow run global-review -- --projects api,admin --changed
```

Expected: `findings=[]`. Real findings must be fixed. Confirmed false positives must be encoded in `mcp/ktWorkflow` review rules before claiming completion.

- [ ] **Step 6: Commit docs/root updates**

Commit API docs with the API commit if they are part of the same repo changes. Commit root docs separately:

```powershell
git -C D:/MyFiles/KT status --short
git -C D:/MyFiles/KT add docs/qqbot-nas-runtime.md "docs/obsidian/modules/KT 模块 - QQBot BangDream FFLogs.md" TASKS.md
git -C D:/MyFiles/KT commit -m "docs: 同步NapCat运行态Profile上线计划"
```

---

## Task 10: Deploy And Online Closed Loop

**Files:**
- No new source files unless deploy observation exposes a real bug.
- Evidence goes under `D:/MyFiles/KT/.kt-workspace/test-artifacts`.

- [ ] **Step 1: Push API and Admin only after local validation passes**

```powershell
git -C D:/MyFiles/KT/Node/kt-template-online-api status --short
git -C D:/MyFiles/KT/Vue/kt-template-admin status --short
git -C D:/MyFiles/KT/Node/kt-template-online-api push
git -C D:/MyFiles/KT/Vue/kt-template-admin push
```

Expected: pushes succeed. If Gitea reports mirror/read-only, stop and apply the existing Gitea mirror fix from root `AGENTS.md`.

- [ ] **Step 2: Observe Jenkins/K8s**

```powershell
pnpm --dir D:/MyFiles/KT/mcp/ktWorkflow run deploy-observation -- --project api --job KT-Template/KT-Template-API/main --execute
```

Expected: Jenkins final result SUCCESS, K8s Deployment observed generation current, Ready replicas match desired, pod image matches pushed commit, restart count stable.

- [ ] **Step 3: Online API smoke**

Use a real Admin token from the current login session through an environment variable and query the first available account:

```powershell
$base = 'https://admin.kwitsukasa.top/api'
if (-not $env:KT_ADMIN_ACCESS_TOKEN) { throw 'KT_ADMIN_ACCESS_TOKEN is required for online runtime profile smoke.' }
$headers = @{ Authorization = "Bearer $env:KT_ADMIN_ACCESS_TOKEN" }
$accountPage = Invoke-RestMethod "$base/qqbot/account/page?pageNo=1&pageSize=1" -Headers $headers
$accountId = $accountPage.data.list[0].id
if (-not $accountId) { throw 'No QQBot account found for runtime profile smoke.' }
Invoke-RestMethod "$base/qqbot/napcat/runtime/detail?accountId=$accountId" -Headers $headers
```

Expected:

- Response `code=200`.
- Runtime evidence is present.
- `token`, `password`, `secret`, and runtime password env are redacted.
- Login events list is present.
- No hourly/daily send budget fields exist.

- [ ] **Step 4: Test account gray flow**

Run one test account in this order:

1. Record old runtime/profile evidence.
2. Verify watchdog quick -> password does not create QR code.
3. Trigger a controlled manual update login only once if needed.
4. If captcha or new-device appears, complete the existing flow manually and confirm `recovery_suspended` was recorded before manual action.
5. Enable `o3HookMode=0` only for the test account.
6. Record NapCat version, QQNT version, image digest, config hashes, login state, and command smoke result.
7. Execute one text command and one image command through `/qqbot/command/test`.

Expected:

- OneBot online state and QQ login state remain distinct.
- `manual_qr_created` is only from Admin manual action.
- No repeated `container_recreate` events from watchdog.
- Session behavior evidence exists and does not send group/private messages by itself.

- [ ] **Step 5: Existing account migration batches**

For each existing wind-controlled account:

1. Query current `napcat_device_identity`.
2. Record current hostname/MAC/machine-id evidence.
3. Apply profile migration for one account.
4. Observe new-device verification if QQ requires it.
5. Complete login manually if required.
6. Run text/image command smoke.
7. Record final evidence and decide whether to continue to the next account.

Expected:

- New hostname does not include QQ number or NapCat/Docker words.
- New MAC does not start with rejected virtual prefixes.
- One account failure does not trigger concurrent rebuilds for other accounts.

- [ ] **Step 6: Cleanup and closeout**

```powershell
pnpm --dir D:/MyFiles/KT/mcp/ktWorkflow run cleanup-history -- --dry-run
pnpm --dir D:/MyFiles/KT/mcp/ktWorkflow run cleanup-history -- --execute
pnpm --dir D:/MyFiles/KT/mcp/ktWorkflow run cleanup-history -- --dry-run
```

Expected: final dry-run reports `deleted=[]`.

---

## Self-Review

- Spec coverage:
  - Session behavior profile: Task 7.
  - Login-event minimization and watchdog quick -> password: Task 6.
  - Protocol risk profile and `o3HookMode=0` gray path: Tasks 3, 5, 10.
  - Chinese Desktop Runtime profile: Tasks 3, 4, 10.
  - Real physical OUI and existing account migration: Tasks 2, 10.
  - Read-only Admin evidence: Tasks 5, 8.
  - No hourly/daily send budget: Tasks 1, 7, 10 include negative checks.
- Placeholder scan:
  - No unresolved placeholder markers.
  - No unbounded edge-case task.
  - Every code task has a concrete test, code snippet, command, and expected result.
- Type consistency:
  - Runtime summaries use `profileStatus`, `recoveryState`, and `riskMode` consistently across API and Admin.
  - Login event names match `NapcatLoginEventKind`.
  - Device identity strategy names are `desktop-hostname-v1` and `physical-oui-v1`.
