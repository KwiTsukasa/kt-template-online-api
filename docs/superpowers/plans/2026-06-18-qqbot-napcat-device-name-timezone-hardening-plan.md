# QQBot NapCat Device Name And Timezone Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a visible QQ security-page device name while keeping NapCat device identity persistent, fix mixed UTC/Asia-Shanghai timestamps, and make runtime/profile evidence persist online.

**Architecture:** Use upstream NapCat evidence as the source of truth: QQNT Linux reads `os.hostname()` for `hostName`/`devName`, new-device OIDB sends `str_dev_name: os.hostname()`, and Linux GUID is based on `/etc/machine-id + machine-info MAC`. The online regression evidence shows the new container exposes `ubuntu-pc-*`, but Docker MAC was changed to a physical OUI while QQNT `machine-info` still stored the old `02:42:*` MAC, creating inconsistent device identity. Generate a short stable QQNT-safe hostname that the upstream Docker entrypoint will not rewrite, return MAC strategy to upstream-compatible stable Docker bridge `02:42:*`, write matching `machine-info`, persist profile rows after container creation, and set MySQL connection timezone explicitly.

**Tech Stack:** NestJS, TypeORM, MySQL, NapCat-Docker, Jest, PowerShell/NAS SSH smoke.

---

## File Map

- Modify `src/modules/qqbot/napcat/infrastructure/integration/device/napcat-device-identity.service.ts`
  - Generate short stable hostname `pc-<8 hex>` to avoid NapCat-Docker entrypoint reset and avoid long desktop names that regress to `未知设备`.
  - Generate stable upstream-compatible Docker bridge MAC `02:42:*`.
  - Migrate existing `desktop-hostname-v1` / `physical-oui-v1` identities back to QQNT-safe defaults with evidence.
- Modify `src/modules/qqbot/napcat/infrastructure/integration/container/napcat-docker-device-options.ts`
  - Carry `machineInfoPath` and hyphen MAC for QQNT Linux `machine-info`.
- Modify `src/modules/qqbot/napcat/infrastructure/integration/container/qqbot-napcat-container.service.ts`
  - Write `device.env`, `/etc/machine-id`, and QQNT `machine-info` consistently.
  - Create and mount a persistent `XDG_RUNTIME_DIR`.
  - Update `napcat_account_binding.device_identity_id` after create/rebuild.
  - Persist runtime/protocol profile after successful container creation.
- Modify `src/modules/qqbot/napcat/application/runtime/napcat-runtime-profile.service.ts`
  - Persist planned runtime and protocol profile rows when repositories are injected.
- Modify `src/app.module.ts`
  - Set TypeORM MySQL timezone from `DB_TIMEZONE`, default `+08:00`.
- Modify `src/runtime/config/runtime-config.types.ts` and `src/runtime/config/runtime-config.service.ts`
  - Expose DB timezone in runtime health evidence.
- Modify `ci/napcat-desktop-cn/Dockerfile`
  - Ensure the derived image keeps `zh_CN.UTF-8` available and does not get shadowed by upstream `C.UTF-8`.
- Modify `.env.example`, `README.md`, `API.md`, `sql/qqbot-init.sql`, `sql/refactor-v3/00-full-schema.sql`, `sql/refactor-v3/99-verify.sql`
  - Document/align defaults and schema verification.
- Modify tests:
  - `test/modules/qqbot/napcat/device-identity.spec.ts`
  - `test/modules/qqbot/napcat/runtime-protocol-profile.spec.ts`
  - `test/runtime/runtime-config.service.spec.ts`
  - Add `test/app/typeorm-timezone-config.spec.ts`

## Task 1: Device Identity Regression RED/GREEN

**Files:**
- Modify: `test/modules/qqbot/napcat/device-identity.spec.ts`
- Modify: `src/modules/qqbot/napcat/infrastructure/integration/device/napcat-device-identity.service.ts`
- Modify: `src/modules/qqbot/napcat/infrastructure/integration/container/napcat-docker-device-options.ts`

- [x] **Step 1: Write failing tests**

Add expectations that new identities use a QQNT-safe visible hostname and upstream-compatible MAC:

```ts
expect(identity.hostname).toMatch(/^pc-[a-f0-9]{8}$/);
expect(identity.hostname).not.toMatch(/^[a-f0-9]{12,}$/);
expect(identity.macAddress).toMatch(/^02:42:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}$/);
expect(identity.hostnameStrategy).toBe('qqnt-visible-hostname-v1');
expect(identity.macStrategy).toBe('docker-bridge-mac-v1');
```

Also update the migration test so a legacy `ubuntu-pc-*` / physical OUI identity migrates to the new strategies and records `trigger: 'qqnt-device-name-regression-repair'`.

- [x] **Step 2: Run RED**

Run:

```powershell
pnpm exec jest --runTestsByPath test/modules/qqbot/napcat/device-identity.spec.ts --runInBand
```

Expected: FAIL because current code emits `ubuntu-pc-*` and physical OUI MAC.

- [x] **Step 3: Implement identity generation**

Change the service to:

```ts
private buildQqntVisibleHostname(seed: string) {
  const hash = createHash('sha256').update(seed).digest('hex');
  return `pc-${hash.slice(0, 8)}`;
}

private buildDockerBridgeMacAddress(accountId: string, containerName: string) {
  const hash = createHash('sha256')
    .update(`${accountId}:${containerName}:docker-bridge-mac-v1`)
    .digest('hex');
  return `02:42:${hash.slice(0, 2)}:${hash.slice(2, 4)}:${hash.slice(4, 6)}:${hash.slice(6, 8)}`.toLowerCase();
}
```

Update migration predicates to migrate too-long hostnames, pure 12+ hex hostnames, `desktop-hostname-v1`, `physical-oui-v1`, rejected virtual prefixes outside `02:42`, and values containing `qq|bot|napcat|docker|container|lxc`.

- [x] **Step 4: Run GREEN**

Run:

```powershell
pnpm exec jest --runTestsByPath test/modules/qqbot/napcat/device-identity.spec.ts --runInBand
```

Expected: PASS.

## Task 2: Docker Script Machine-Info And Binding RED/GREEN

**Files:**
- Modify: `test/modules/qqbot/napcat/device-identity.spec.ts`
- Modify: `src/modules/qqbot/napcat/infrastructure/integration/container/napcat-docker-device-options.ts`
- Modify: `src/modules/qqbot/napcat/infrastructure/integration/container/qqbot-napcat-container.service.ts`

- [x] **Step 1: Write failing tests**

Assert the generated script writes QQNT machine-info with a backup, mounts persistent runtime dir, and updates binding `deviceIdentityId`:

```ts
expect(createScript).toContain('MACHINE_INFO_PATH=');
expect(createScript).toContain('MAC_HYPHEN=');
expect(createScript).toContain("printf '\\\\000\\\\000\\\\000\\\\021'");
expect(createScript).toContain("tr 'A-Za-z' 'N-ZA-Mn-za-m'");
expect(createScript).toContain('-v "$DATA_DIR/runtime:/tmp/runtime-napcat"');
expect(bindingRepository.update).toHaveBeenCalledWith(
  expect.objectContaining({ accountId: 'account-10001', containerId: 'container-created' }),
  expect.objectContaining({ deviceIdentityId: expect.any(String) }),
);
```

- [x] **Step 2: Run RED**

Run:

```powershell
pnpm exec jest --runTestsByPath test/modules/qqbot/napcat/device-identity.spec.ts --runInBand
```

Expected: FAIL because `machine-info` and binding updates are not implemented.

- [x] **Step 3: Implement script and binding update**

Add `machineInfoPath` and `macAddressHyphen` to `NapcatDockerDeviceOptions`. In `buildRemoteCreateScript`, write:

```sh
MACHINE_INFO_PATH="$DATA_DIR/QQ/nt_qq/global/nt_data/msf/machine-info"
NAPCAT_MAC_HYPHEN="$(printf '%s' "$NAPCAT_MAC_ADDRESS" | tr ':' '-')"
mkdir -p "$(dirname "$MACHINE_INFO_PATH")"
if [ -s "$MACHINE_INFO_PATH" ]; then
  CURRENT_MACHINE_INFO="$(mktemp)"
  cp "$MACHINE_INFO_PATH" "$CURRENT_MACHINE_INFO"
fi
{
  printf '\000\000\000\021'
  printf '%s' "$MAC_HYPHEN" | tr 'A-Za-z' 'N-ZA-Mn-za-m'
} > "$MACHINE_INFO_PATH"
```

After successful create/rebuild, update `napcat_account_binding.device_identity_id` for the account/container pair.

- [x] **Step 4: Run GREEN**

Run:

```powershell
pnpm exec jest --runTestsByPath test/modules/qqbot/napcat/device-identity.spec.ts --runInBand
```

Expected: PASS.

## Task 3: Runtime/Profile Persistence RED/GREEN

**Files:**
- Modify: `test/modules/qqbot/napcat/runtime-protocol-profile.spec.ts`
- Modify: `src/modules/qqbot/napcat/application/runtime/napcat-runtime-profile.service.ts`
- Modify: `src/modules/qqbot/napcat/infrastructure/integration/container/qqbot-napcat-container.service.ts`

- [x] **Step 1: Write failing tests**

Add a test that calls `recordPlannedProfiles()` and expects both repositories to save rows:

```ts
expect(runtimeProfileRepository.save).toHaveBeenCalledWith(
  expect.objectContaining({
    accountId: 'account-1',
    deviceIdentityId: 'identity-1',
    hostnameStrategy: 'qqnt-visible-hostname-v1',
    macStrategy: 'docker-bridge-mac-v1',
    profileStatus: 'pending',
  }),
);
expect(protocolProfileRepository.save).toHaveBeenCalledWith(
  expect.objectContaining({
    accountId: 'account-1',
    o3HookMode: 1,
    packetBackend: 'auto',
    profileStatus: 'pending',
  }),
);
```

- [x] **Step 2: Run RED**

Run:

```powershell
pnpm exec jest --runTestsByPath test/modules/qqbot/napcat/runtime-protocol-profile.spec.ts --runInBand
```

Expected: FAIL because the service currently does not persist generated profiles.

- [x] **Step 3: Implement persistence**

Add optional injected repositories to `NapcatRuntimeProfileService`, implement `recordPlannedProfiles(input)`, and call it after successful Docker create/rebuild with the runtime snapshot and config bundle hashes.

- [x] **Step 4: Run GREEN**

Run:

```powershell
pnpm exec jest --runTestsByPath test/modules/qqbot/napcat/runtime-protocol-profile.spec.ts --runInBand
```

Expected: PASS.

## Task 4: MySQL Timezone RED/GREEN

**Files:**
- Add: `test/app/typeorm-timezone-config.spec.ts`
- Modify: `src/app.module.ts`
- Modify: `src/runtime/config/runtime-config.types.ts`
- Modify: `src/runtime/config/runtime-config.service.ts`

- [x] **Step 1: Write failing tests**

Extract a small exported helper from `app.module.ts` or test the factory through metadata so the returned TypeORM options include:

```ts
expect(options.timezone).toBe('+08:00');
```

Also assert `RuntimeConfigService.readDatabaseProfile()` reports `timezone: '+08:00'`.

- [x] **Step 2: Run RED**

Run:

```powershell
pnpm exec jest --runTestsByPath test/app/typeorm-timezone-config.spec.ts test/runtime/runtime-config.service.spec.ts --runInBand
```

Expected: FAIL because no DB timezone is configured or exposed.

- [x] **Step 3: Implement timezone config**

Set TypeORM MySQL `timezone` to `configService.get('DB_TIMEZONE') || '+08:00'`, and expose the same field from runtime health config.

- [x] **Step 4: Run GREEN**

Run:

```powershell
pnpm exec jest --runTestsByPath test/app/typeorm-timezone-config.spec.ts test/runtime/runtime-config.service.spec.ts --runInBand
```

Expected: PASS.

## Task 5: Image, SQL, Docs, And Verification

**Files:**
- Modify: `ci/napcat-desktop-cn/Dockerfile`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `API.md`
- Modify: `sql/qqbot-init.sql`
- Modify: `sql/refactor-v3/00-full-schema.sql`
- Modify: `sql/refactor-v3/99-verify.sql`
- Modify: `TASKS.md`

- [x] **Step 1: Keep derived image actually Chinese-locale capable**

Ensure the Dockerfile installs `locales`, generates `zh_CN.UTF-8`, and sets `LC_ALL=zh_CN.UTF-8`. The verification script must fail if `locale -a` lacks `zh_CN.utf8`.

- [x] **Step 2: Align SQL defaults and docs**

Document `DB_TIMEZONE=+08:00`, `QQBOT_NAPCAT_IMAGE` derived image usage, and device identity strategy names. Update SQL verify checks for `device_identity_id`, strategy columns, and profile tables.

- [x] **Step 3: Run focused validation**

Run:

```powershell
pnpm exec jest --runTestsByPath test/modules/qqbot/napcat/device-identity.spec.ts test/modules/qqbot/napcat/runtime-protocol-profile.spec.ts test/app/typeorm-timezone-config.spec.ts test/runtime/runtime-config.service.spec.ts --runInBand
pnpm run typecheck
git diff --check
```

Expected: all pass.

- [ ] **Step 4: Online controlled repair after deploy**

After commit/push/deploy, run a scoped online repair:

1. Backup `napcat_device_identity`, `napcat_account_binding`, `napcat_runtime_profile`, `napcat_protocol_profile`, `napcat_login_session`.
2. Restart/recreate NapCat containers through the managed API path so code writes DB binding/profile rows and Docker machine-info.
3. Verify:
   - `napcat_account_binding.device_identity_id` is not null for enabled accounts.
   - profile tables have rows for enabled accounts.
   - each running container has hostname `pc-<8 hex>`, Docker MAC `02:42:*`, `/etc/machine-id`, decoded `machine-info` MAC equal to Docker MAC, `TZ=Asia/Shanghai`, writable XDG runtime dir, and `locale -a` includes `zh_CN.utf8`.
   - MySQL `NOW()` offset or API session rows no longer mix UTC and CST fields.
4. Ask user to scan one login QR if QQ requires new-device verification; then confirm QQ mobile page shows a non-unknown device name.
