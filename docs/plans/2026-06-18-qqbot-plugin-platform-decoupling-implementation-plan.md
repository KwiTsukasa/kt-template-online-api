# QQBot Plugin Platform Decoupling Implementation Plan

> **Execution note:** Execute this plan task-by-task with the KT-local workflow and use the checkboxes to track plan state.

**Goal:** Make `src/modules/qqbot/plugin-platform` a generic plugin runtime that never imports or branches on BangDream, FF14 Market, FFLogs, or Repeater package code.

**Architecture:** Built-in plugins become ordinary package descriptors discovered from controlled package roots. The platform owns manifest parsing, installation state, worker lifecycle, generic host calls, and task/event routing; each plugin package owns its entry adapter, business code, config key declarations, and package-specific integrations. Workers receive a descriptor with `installationId`, `pluginKey`, `packageRoot`, `entry`, `manifest`, `runtimeOptions`, and a config snapshot, then dynamically import the package entry instead of using switch statements.

**Tech Stack:** NestJS, TypeScript, Jest, Node `worker_threads`, TypeORM, pnpm, existing QQBot plugin manifests.

---

## Current Evidence

- API repo: `D:\MyFiles\KT\Node\kt-template-online-api`.
- Current branch state before this plan: `main...origin/main [ahead 1]`, clean working tree.
- Existing generic manifest parser already supports `tasks`, but `runtime.configKeys` is not modeled.
- Existing hard coupling files:
  - `src/modules/qqbot/plugin-platform/infrastructure/integration/package/builtin-plugin-package-loader.service.ts`
  - `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/builtin-plugin-worker-runtime.factory.ts`
  - `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/builtin-plugin-worker.thread.ts`
- Current tests that must be replaced or updated:
  - `test/modules/qqbot/plugin-platform/builtin-plugin-package-loader.spec.ts`
  - `test/modules/qqbot/plugin-platform/plugin-platform-di.spec.ts`
  - `test/modules/qqbot/plugin-platform/plugin-lifecycle-runtime.spec.ts`
  - `test/modules/qqbot/architecture/qqbot-plugin-package-boundary.spec.ts`
- Existing built-in package roots:
  - `src/modules/qqbot/plugins/bangdream`
  - `src/modules/qqbot/plugins/ff14-market`
  - `src/modules/qqbot/plugins/fflogs`
  - `src/modules/qqbot/plugins/repeater`

## File Structure

### Create

- `src/modules/qqbot/plugin-platform/infrastructure/integration/package/plugin-package.types.ts`
  - Generic descriptor types for package roots, manifest entry paths, and config snapshots.
- `src/modules/qqbot/plugin-platform/infrastructure/integration/package/plugin-package-path-policy.service.ts`
  - Controlled-root path resolver. It prevents package roots and entry files from escaping the built-in plugin root or installed package root.
- `src/modules/qqbot/plugin-platform/infrastructure/integration/package/plugin-package-source.service.ts`
  - Discovers package descriptors from `*/plugin.json` under controlled roots. This service may inspect directory names but must not import plugin code or know concrete plugin keys.
- `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/plugin-host-bridge.types.ts`
  - Worker host-call request and response contracts.
- `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/plugin-host-bridge.service.ts`
  - Generic host operations exposed to package workers.
- `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/plugin-worker-runtime.factory.ts`
  - Generic worker factory and thread driver. Replaces the built-in worker factory.
- `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/plugin-worker.thread.ts`
  - Generic worker thread entry. Dynamically imports the plugin package entry from the descriptor.
- `test/modules/qqbot/plugin-platform/plugin-package-source.spec.ts`
  - Package descriptor discovery tests with a temp plugin package.
- `test/modules/qqbot/plugin-platform/plugin-worker-entry.spec.ts`
  - Dynamic entry import and host-call tests.

### Modify

- `src/modules/qqbot/plugin-platform/domain/manifest/manifest.types.ts`
  - Add `runtime.configKeys?: string[]`.
- `src/modules/qqbot/plugin-platform/domain/manifest/manifest.parser.ts`
  - Parse and normalize `runtime.configKeys`.
- `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/worker-runtime.types.ts`
  - Add descriptor fields required by the generic worker.
- `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/worker-runtime.ts`
  - Keep queue and lifecycle semantics, but receive package descriptors instead of implicit built-in plugin keys.
- `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/index.ts`
  - Export generic runtime files only.
- `src/modules/qqbot/plugin-platform/plugin-platform.module.ts`
  - Register generic source, path policy, host bridge, and worker factory.
- `src/modules/qqbot/plugin-platform/application/plugin-platform.service.ts`
  - Start built-in workers from descriptors, not from a concrete built-in loader.
- `src/modules/qqbot/plugin-platform/application/registry/qqbot-plugin-registry.service.ts`
  - Remove built-in loader hydration.
- `src/modules/qqbot/plugin-platform/application/registry/qqbot-event-plugin-registry.service.ts`
  - Remove built-in event loader hydration and use generic event metadata.
- `src/modules/qqbot/plugins/bangdream/plugin.json`
  - Add package-owned runtime config keys.
- `src/modules/qqbot/plugins/bangdream/src/index.ts`
  - Accept the generic `createPlugin({ manifest, host, runtime, normalizeError, now })` contract.
- `src/modules/qqbot/plugins/ff14-market/plugin.json`
  - Add package-owned runtime config keys.
- `src/modules/qqbot/plugins/ff14-market/src/index.ts`
  - Keep generic contract and remove assumptions that the platform supplies package-specific helpers.
- `src/modules/qqbot/plugins/fflogs/plugin.json`
  - Add package-owned runtime config keys.
- `src/modules/qqbot/plugins/fflogs/src/index.ts`
  - Resolve world/server data through the generic host dictionary/config operations owned by the package.
- `src/modules/qqbot/plugins/repeater/plugin.json`
  - Add package-owned runtime config keys.
- `src/modules/qqbot/plugins/repeater/src/index.ts`
  - Keep generic contract and use generic host methods only.
- `test/modules/qqbot/plugin-platform/manifest.spec.ts`
  - Cover `runtime.configKeys`.
- `test/modules/qqbot/plugin-platform/plugin-platform-di.spec.ts`
  - Assert the old built-in loader is not injected.
- `test/modules/qqbot/plugin-platform/plugin-lifecycle-runtime.spec.ts`
  - Replace built-in loader expectations with descriptor-based runtime expectations.
- `test/modules/qqbot/architecture/qqbot-plugin-package-boundary.spec.ts`
  - Scan the full plugin-platform tree for concrete plugin imports, hard-coded plugin branches, and old built-in symbols.

### Delete

- `src/modules/qqbot/plugin-platform/infrastructure/integration/package/builtin-plugin-package-loader.service.ts`
- `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/builtin-plugin-worker-runtime.factory.ts`
- `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/builtin-plugin-worker.thread.ts`
- `test/modules/qqbot/plugin-platform/builtin-plugin-package-loader.spec.ts`

## Implementation Rules

- New or touched functions, methods, hooks, event handlers, task handlers, exported arrow functions, and worker helpers must have JSDoc. Each JSDoc explains why each parameter exists in this domain, not only its type.
- `plugin-platform` must not import any file under `src/modules/qqbot/plugins/**`.
- `plugin-platform` must not contain `pluginKey === 'bangdream'`, `case 'ff14-market'`, or equivalent concrete plugin branching.
- `plugin-platform` may discover package directories by reading `*/plugin.json` under controlled roots.
- Built-in plugin packages must export `createPlugin(options)` from the manifest entry file.
- Runtime config keys must come from `manifest.runtime.configKeys` and `manifest.configSchema.properties`; package code owns the names.
- No compatibility wrapper may recreate `QqbotBuiltinPluginPackageLoaderService`, `BUILTIN_PLUGIN_KEYS`, `createBangDreamPlugin`, `createFf14MarketPlugin`, `createFflogsPlugin`, `createRepeaterPlugin`, or `getConfigKeysForPlugin`.

## Task 1: Manifest Runtime Config Contract

**Files:**
- Modify: `src/modules/qqbot/plugin-platform/domain/manifest/manifest.types.ts`
- Modify: `src/modules/qqbot/plugin-platform/domain/manifest/manifest.parser.ts`
- Modify: `test/modules/qqbot/plugin-platform/manifest.spec.ts`

- [ ] **Step 1: Add the failing manifest parser test**

Append this test case to `test/modules/qqbot/plugin-platform/manifest.spec.ts` inside the existing manifest parser `describe` block:

```ts
it('normalizes runtime config keys without platform-owned plugin knowledge', () => {
  const manifest = parseQqbotPluginManifest({
    key: 'sample-plugin',
    name: 'Sample Plugin',
    version: '1.0.0',
    entry: 'src/index.ts',
    runtime: {
      workerType: 'thread',
      timeoutMs: 5000,
      memoryMb: 128,
      maxConcurrency: 1,
      configKeys: [
        'SAMPLE_TOKEN',
        ' SAMPLE_TIMEOUT_MS ',
        '',
        'SAMPLE_TOKEN',
      ],
    },
    operations: [],
  });

  expect(manifest.runtime.configKeys).toEqual([
    'SAMPLE_TOKEN',
    'SAMPLE_TIMEOUT_MS',
  ]);
});
```

- [ ] **Step 2: Run the manifest test and capture the red result**

Run:

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/plugin-platform/manifest.spec.ts
```

Expected: FAIL because `runtime.configKeys` is not parsed yet.

- [ ] **Step 3: Add the runtime type field**

Update `QqbotPluginRuntimeManifest` in `src/modules/qqbot/plugin-platform/domain/manifest/manifest.types.ts` to include the package-owned config keys:

```ts
export type QqbotPluginRuntimeManifest = {
  configKeys: string[];
  maxConcurrency: number;
  memoryMb: number;
  timeoutMs: number;
  workerType: QqbotPluginWorkerType;
};
```

- [ ] **Step 4: Add a parser helper with JSDoc**

Add this helper to `src/modules/qqbot/plugin-platform/domain/manifest/manifest.parser.ts` near the runtime parser helpers:

```ts
/**
 * Normalizes config keys declared by a plugin package manifest.
 *
 * @param rawKeys - Manifest-provided values from `runtime.configKeys`; these are package-owned
 * names used by the generic host to preload configuration without hard-coding plugin keys.
 * @returns Unique non-empty config keys in declaration order.
 */
function parseConfigKeys(rawKeys: unknown): string[] {
  if (!Array.isArray(rawKeys)) {
    return [];
  }

  return Array.from(
    new Set(
      rawKeys
        .filter((key): key is string => typeof key === 'string')
        .map((key) => key.trim())
        .filter((key) => key.length > 0),
    ),
  );
}
```

- [ ] **Step 5: Wire the helper into `parseRuntime`**

Update the `parseRuntime` return object in `src/modules/qqbot/plugin-platform/domain/manifest/manifest.parser.ts`:

```ts
return {
  configKeys: parseConfigKeys(record.configKeys),
  maxConcurrency,
  memoryMb,
  timeoutMs,
  workerType,
};
```

- [ ] **Step 6: Run the manifest test and capture the green result**

Run:

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/plugin-platform/manifest.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

Run:

```powershell
git add src/modules/qqbot/plugin-platform/domain/manifest/manifest.types.ts src/modules/qqbot/plugin-platform/domain/manifest/manifest.parser.ts test/modules/qqbot/plugin-platform/manifest.spec.ts
git commit -m "feat: 支持插件声明运行时配置键"
```

## Task 2: Generic Package Descriptor Source

**Files:**
- Create: `src/modules/qqbot/plugin-platform/infrastructure/integration/package/plugin-package.types.ts`
- Create: `src/modules/qqbot/plugin-platform/infrastructure/integration/package/plugin-package-path-policy.service.ts`
- Create: `src/modules/qqbot/plugin-platform/infrastructure/integration/package/plugin-package-source.service.ts`
- Create: `test/modules/qqbot/plugin-platform/plugin-package-source.spec.ts`

- [ ] **Step 1: Create the failing package source test**

Create `test/modules/qqbot/plugin-platform/plugin-package-source.spec.ts` with this complete content:

```ts
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import { QqbotPluginPackagePathPolicyService } from '@/modules/qqbot/plugin-platform/infrastructure/integration/package/plugin-package-path-policy.service';
import { QqbotPluginPackageSourceService } from '@/modules/qqbot/plugin-platform/infrastructure/integration/package/plugin-package-source.service';

describe('QqbotPluginPackageSourceService', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'qqbot-plugin-source-'));
  });

  afterEach(() => {
    rmSync(tempRoot, { force: true, recursive: true });
  });

  it('discovers packages from plugin.json without importing package code', async () => {
    const packageRoot = join(tempRoot, 'sample');
    mkdirSync(join(packageRoot, 'src'), { recursive: true });
    writeFileSync(
      join(packageRoot, 'plugin.json'),
      JSON.stringify({
        key: 'sample',
        name: 'Sample',
        version: '1.0.0',
        entry: 'src/index.ts',
        runtime: {
          workerType: 'thread',
          timeoutMs: 5000,
          memoryMb: 128,
          maxConcurrency: 1,
          configKeys: ['SAMPLE_TOKEN'],
        },
        operations: [],
      }),
      'utf8',
    );
    writeFileSync(
      join(packageRoot, 'src', 'index.ts'),
      'throw new Error("entry must not be imported during discovery");',
      'utf8',
    );

    const source = new QqbotPluginPackageSourceService(
      new QqbotPluginPackagePathPolicyService([tempRoot]),
    );

    await expect(source.discoverPackages()).resolves.toEqual([
      expect.objectContaining({
        entry: 'src/index.ts',
        entryFile: join(packageRoot, 'src', 'index.ts'),
        manifest: expect.objectContaining({ key: 'sample' }),
        packageRoot,
        pluginKey: 'sample',
      }),
    ]);
  });

  it('rejects package entries that escape controlled roots', async () => {
    const packageRoot = join(tempRoot, 'escape');
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(
      join(packageRoot, 'plugin.json'),
      JSON.stringify({
        key: 'escape',
        name: 'Escape',
        version: '1.0.0',
        entry: `..${sep}outside.ts`,
        runtime: {
          workerType: 'thread',
          timeoutMs: 5000,
          memoryMb: 128,
          maxConcurrency: 1,
        },
        operations: [],
      }),
      'utf8',
    );

    const source = new QqbotPluginPackageSourceService(
      new QqbotPluginPackagePathPolicyService([tempRoot]),
    );

    await expect(source.discoverPackages()).rejects.toThrow(
      'Plugin entry must stay inside the package root',
    );
  });
});
```

- [ ] **Step 2: Run the package source test and capture the red result**

Run:

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/plugin-platform/plugin-package-source.spec.ts
```

Expected: FAIL because the new services do not exist.

- [ ] **Step 3: Create generic package types**

Create `src/modules/qqbot/plugin-platform/infrastructure/integration/package/plugin-package.types.ts`:

```ts
import type { QqbotPluginManifest } from '@/modules/qqbot/plugin-platform/domain/manifest';

export type QqbotPluginPackageDescriptor = {
  entry: string;
  entryFile: string;
  manifest: QqbotPluginManifest;
  packageRoot: string;
  pluginKey: string;
};

export type QqbotPluginRuntimeConfigSnapshot = Record<string, string | undefined>;
```

- [ ] **Step 4: Create the path policy service**

Create `src/modules/qqbot/plugin-platform/infrastructure/integration/package/plugin-package-path-policy.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

const DEFAULT_BUILTIN_PACKAGE_ROOT = resolve(
  process.cwd(),
  'src/modules/qqbot/plugins',
);

/**
 * Restricts plugin package file access to configured package roots.
 */
@Injectable()
export class QqbotPluginPackagePathPolicyService {
  private readonly controlledRoots: string[];

  /**
   * @param controlledRoots - Package root directories allowed for built-in and installed plugin
   * discovery; tests inject temp roots while runtime uses the repository built-in plugin root.
   */
  constructor(controlledRoots: string[] = [DEFAULT_BUILTIN_PACKAGE_ROOT]) {
    this.controlledRoots = controlledRoots.map((root) => resolve(root));
  }

  /**
   * Lists controlled roots that currently exist on disk.
   *
   * @returns Existing absolute package root directories.
   */
  listExistingRoots(): string[] {
    return this.controlledRoots.filter((root) => existsSync(root));
  }

  /**
   * Resolves a package entry path and proves that it stays inside the package root.
   *
   * @param packageRoot - Absolute root of the package that owns `plugin.json`.
   * @param entry - Manifest entry path relative to the package root.
   * @returns Absolute entry file path safe for worker import.
   */
  resolveEntryFile(packageRoot: string, entry: string): string {
    const normalizedPackageRoot = resolve(packageRoot);
    const entryFile = resolve(normalizedPackageRoot, entry);
    if (isAbsolute(entry) || this.isOutside(normalizedPackageRoot, entryFile)) {
      throw new Error('Plugin entry must stay inside the package root');
    }
    return entryFile;
  }

  /**
   * Proves a discovered package root belongs to one configured controlled root.
   *
   * @param packageRoot - Absolute package directory discovered from a `plugin.json` file.
   * @returns The normalized package root when it is controlled.
   */
  assertControlledPackageRoot(packageRoot: string): string {
    const normalizedPackageRoot = resolve(packageRoot);
    const isControlled = this.controlledRoots.some(
      (root) =>
        normalizedPackageRoot === root ||
        !this.isOutside(root, normalizedPackageRoot),
    );
    if (!isControlled) {
      throw new Error('Plugin package root is outside controlled roots');
    }
    return normalizedPackageRoot;
  }

  /**
   * Checks whether `candidate` is outside `root`.
   *
   * @param root - Absolute directory that bounds the candidate.
   * @param candidate - Absolute file or directory path to compare.
   * @returns `true` when the candidate escapes the root.
   */
  private isOutside(root: string, candidate: string): boolean {
    const relation = relative(root, candidate);
    return relation.startsWith('..') || isAbsolute(relation);
  }
}
```

- [ ] **Step 5: Create the generic package source service**

Create `src/modules/qqbot/plugin-platform/infrastructure/integration/package/plugin-package-source.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { parseQqbotPluginManifest } from '@/modules/qqbot/plugin-platform/domain/manifest';

import { QqbotPluginPackagePathPolicyService } from './plugin-package-path-policy.service';
import type { QqbotPluginPackageDescriptor } from './plugin-package.types';

/**
 * Discovers QQBot plugin packages through manifest files only.
 */
@Injectable()
export class QqbotPluginPackageSourceService {
  private readonly logger = new Logger(QqbotPluginPackageSourceService.name);

  /**
   * @param pathPolicy - Path policy that defines which package roots may be scanned by the
   * generic platform without importing package implementation files.
   */
  constructor(private readonly pathPolicy: QqbotPluginPackagePathPolicyService) {}

  /**
   * Discovers package descriptors from controlled roots.
   *
   * @returns Parsed descriptors sorted by plugin key for deterministic startup.
   */
  async discoverPackages(): Promise<QqbotPluginPackageDescriptor[]> {
    const descriptors: QqbotPluginPackageDescriptor[] = [];
    for (const root of this.pathPolicy.listExistingRoots()) {
      for (const packageRoot of this.listPackageRoots(root)) {
        const descriptor = this.readDescriptor(packageRoot);
        if (descriptor) {
          descriptors.push(descriptor);
        }
      }
    }
    return descriptors.sort((left, right) =>
      left.pluginKey.localeCompare(right.pluginKey),
    );
  }

  /**
   * Reads one package descriptor without importing its entry file.
   *
   * @param packageRoot - Candidate directory that may contain `plugin.json`.
   * @returns Descriptor when a manifest exists, otherwise `null`.
   */
  readDescriptor(packageRoot: string): QqbotPluginPackageDescriptor | null {
    const controlledPackageRoot =
      this.pathPolicy.assertControlledPackageRoot(packageRoot);
    const manifestFile = join(controlledPackageRoot, 'plugin.json');
    try {
      const manifest = parseQqbotPluginManifest(
        JSON.parse(readFileSync(manifestFile, 'utf8')),
      );
      return {
        entry: manifest.entry,
        entryFile: this.pathPolicy.resolveEntryFile(
          controlledPackageRoot,
          manifest.entry,
        ),
        manifest,
        packageRoot: controlledPackageRoot,
        pluginKey: manifest.key,
      };
    } catch (error) {
      this.logger.warn(
        `Skip invalid plugin package ${controlledPackageRoot}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  /**
   * Lists first-level package directories under a controlled root.
   *
   * @param root - Existing controlled root that contains plugin package directories.
   * @returns Absolute package directories that contain a candidate manifest.
   */
  private listPackageRoots(root: string): string[] {
    return readdirSync(root)
      .map((name) => join(root, name))
      .filter((candidate) => statSync(candidate).isDirectory());
  }
}
```

- [ ] **Step 6: Run the package source test and capture the green result**

Run:

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/plugin-platform/plugin-package-source.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

Run:

```powershell
git add src/modules/qqbot/plugin-platform/infrastructure/integration/package/plugin-package.types.ts src/modules/qqbot/plugin-platform/infrastructure/integration/package/plugin-package-path-policy.service.ts src/modules/qqbot/plugin-platform/infrastructure/integration/package/plugin-package-source.service.ts test/modules/qqbot/plugin-platform/plugin-package-source.spec.ts
git commit -m "feat: 增加通用插件包发现服务"
```

## Task 3: Generic Host Bridge and Worker Descriptor

**Files:**
- Create: `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/plugin-host-bridge.types.ts`
- Create: `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/plugin-host-bridge.service.ts`
- Modify: `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/worker-runtime.types.ts`
- Modify: `test/modules/qqbot/plugin-platform/worker-runtime.spec.ts`

- [ ] **Step 1: Add a worker descriptor test**

Append this test to `test/modules/qqbot/plugin-platform/worker-runtime.spec.ts`:

```ts
it('carries a package descriptor through runtime options', () => {
  const options: QqbotPluginWorkerRuntimeOptions = {
    defaultTimeoutMs: 5000,
    descriptor: {
      entry: 'src/index.ts',
      entryFile: 'D:/repo/src/modules/qqbot/plugins/sample/src/index.ts',
      manifest: {
        key: 'sample',
        name: 'Sample',
        version: '1.0.0',
        entry: 'src/index.ts',
        runtime: {
          configKeys: ['SAMPLE_TOKEN'],
          maxConcurrency: 1,
          memoryMb: 128,
          timeoutMs: 5000,
          workerType: 'thread',
        },
        operations: [],
        events: [],
        tasks: [],
      },
      packageRoot: 'D:/repo/src/modules/qqbot/plugins/sample',
      pluginKey: 'sample',
    },
    installationId: 'install-1',
    pluginKey: 'sample',
  };

  expect(options.descriptor.pluginKey).toBe('sample');
  expect(options.descriptor.manifest.runtime.configKeys).toEqual([
    'SAMPLE_TOKEN',
  ]);
});
```

- [ ] **Step 2: Run the worker runtime test and capture the red result**

Run:

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/plugin-platform/worker-runtime.spec.ts
```

Expected: FAIL because `QqbotPluginWorkerRuntimeOptions` has no `descriptor`.

- [ ] **Step 3: Extend worker runtime types**

Update `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/worker-runtime.types.ts`:

```ts
import type {
  QqbotPluginPackageDescriptor,
  QqbotPluginRuntimeConfigSnapshot,
} from '@/modules/qqbot/plugin-platform/infrastructure/integration/package/plugin-package.types';

export type QqbotPluginWorkerRequest = {
  configSnapshot?: QqbotPluginRuntimeConfigSnapshot;
  correlationId: string;
  descriptor?: QqbotPluginPackageDescriptor;
  event?: unknown;
  eventKey?: string;
  installationId?: string;
  manifest?: unknown;
  operationId?: string;
  operationKey?: string;
  input?: unknown;
  pluginKey: string;
  safeInputSummary?: QqbotPluginSafeInputSummary;
  taskHandlerName?: string;
  taskId?: string;
  taskKey?: string;
  timeoutMs: number;
  triggerType?: 'bootstrap' | 'manual' | 'schedule';
  type: QqbotPluginWorkerRequestType;
};

export type QqbotPluginWorkerRuntimeOptions = {
  defaultTimeoutMs: number;
  descriptor: QqbotPluginPackageDescriptor;
  installationId: string;
  pluginKey: string;
};
```

- [ ] **Step 4: Add host bridge contracts**

Create `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/plugin-host-bridge.types.ts`:

```ts
export type QqbotPluginHostCallRequest = {
  args: unknown[];
  method: string;
  pluginKey: string;
};

export type QqbotPluginHostCallResponse =
  | { ok: true; value: unknown }
  | { message: string; ok: false };
```

- [ ] **Step 5: Create the host bridge service**

Create `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/plugin-host-bridge.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { QqbotConfigService } from '@/modules/qqbot/core/config/application/qqbot-config.service';
import { QqbotDictionaryService } from '@/modules/qqbot/core/dictionary/application/qqbot-dictionary.service';
import { QqbotHttpClientService } from '@/modules/qqbot/plugin-platform/infrastructure/integration/http/qqbot-plugin-http-client.service';

import type { QqbotPluginPackageDescriptor } from '../package/plugin-package.types';
import type {
  QqbotPluginHostCallRequest,
  QqbotPluginHostCallResponse,
} from './plugin-host-bridge.types';

/**
 * Handles generic host calls emitted by plugin workers.
 */
@Injectable()
export class QqbotPluginHostBridgeService {
  private readonly logger = new Logger(QqbotPluginHostBridgeService.name);

  /**
   * @param configService - Reads QQBot configuration values requested by package-owned keys.
   * @param dictionaryService - Reads dictionary values and relation trees needed by package code.
   * @param httpClient - Performs bounded outbound HTTP calls on behalf of worker packages.
   */
  constructor(
    private readonly configService: QqbotConfigService,
    private readonly dictionaryService: QqbotDictionaryService,
    private readonly httpClient: QqbotHttpClientService,
  ) {}

  /**
   * Dispatches a worker host call through the generic platform bridge.
   *
   * @param descriptor - Package descriptor that bounds local file operations.
   * @param request - Worker-provided method name and arguments.
   * @returns Serializable result consumed by the worker thread.
   */
  async handleCall(
    descriptor: QqbotPluginPackageDescriptor,
    request: QqbotPluginHostCallRequest,
  ): Promise<QqbotPluginHostCallResponse> {
    try {
      return { ok: true, value: await this.call(descriptor, request) };
    } catch (error) {
      return {
        message: error instanceof Error ? error.message : String(error),
        ok: false,
      };
    }
  }

  /**
   * Executes one supported host method.
   *
   * @param descriptor - Package descriptor used to keep package assets inside the package root.
   * @param request - Host method request emitted by package code.
   * @returns Method-specific value.
   */
  private async call(
    descriptor: QqbotPluginPackageDescriptor,
    request: QqbotPluginHostCallRequest,
  ): Promise<unknown> {
    const [first, second] = request.args;
    switch (request.method) {
      case 'getConfig':
        return this.configService.getConfigValue(String(first));
      case 'getConfigMany':
        return this.getConfigMany(first);
      case 'getDictByKey':
        return this.dictionaryService.getDictionaryByKey(String(first));
      case 'getDictItemsByKey':
        return this.dictionaryService.listItemsByDictionaryKey(String(first));
      case 'relationTree':
        return this.dictionaryService.getRelationTree(String(first));
      case 'requestJson':
        return this.httpClient.requestJson(String(first), second);
      case 'requestBuffer':
        return this.httpClient.requestBuffer(String(first), second);
      case 'readAssetFile':
        return readFileSync(this.resolvePackageFile(descriptor, String(first)));
      case 'readJsonFile':
        return JSON.parse(
          readFileSync(this.resolvePackageFile(descriptor, String(first)), 'utf8'),
        );
      case 'writeJsonFile':
        writeFileSync(
          this.resolvePackageFile(descriptor, String(first)),
          JSON.stringify(second, null, 2),
          'utf8',
        );
        return undefined;
      case 'renameFile':
        renameSync(
          this.resolvePackageFile(descriptor, String(first)),
          this.resolvePackageFile(descriptor, String(second)),
        );
        return undefined;
      case 'sleep':
        await new Promise((resolve) => setTimeout(resolve, Number(first)));
        return undefined;
      case 'warn':
        this.logger.warn(`[${request.pluginKey}] ${String(first)}`);
        return undefined;
      default:
        throw new Error(`Unsupported plugin host method: ${request.method}`);
    }
  }

  /**
   * Reads a batch of config values through package-owned keys.
   *
   * @param keys - Values from manifest runtime config keys or package code.
   * @returns Object keyed by the requested config names.
   */
  private async getConfigMany(keys: unknown): Promise<Record<string, string | undefined>> {
    if (!Array.isArray(keys)) {
      return {};
    }
    const entries = await Promise.all(
      keys.map(async (key) => [
        String(key),
        await this.configService.getConfigValue(String(key)),
      ]),
    );
    return Object.fromEntries(entries);
  }

  /**
   * Resolves a package-local file path.
   *
   * @param descriptor - Package descriptor that owns the file.
   * @param relativePath - Package-relative file path requested by package code.
   * @returns Absolute file path inside the package root.
   */
  private resolvePackageFile(
    descriptor: QqbotPluginPackageDescriptor,
    relativePath: string,
  ): string {
    return join(descriptor.packageRoot, relativePath);
  }
}
```

- [ ] **Step 6: Run the worker runtime test and capture the green result**

Run:

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/plugin-platform/worker-runtime.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

Run:

```powershell
git add src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/plugin-host-bridge.types.ts src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/plugin-host-bridge.service.ts src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/worker-runtime.types.ts test/modules/qqbot/plugin-platform/worker-runtime.spec.ts
git commit -m "feat: 增加通用插件运行时主机桥"
```

## Task 4: Generic Worker Factory and Dynamic Entry

**Files:**
- Create: `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/plugin-worker-runtime.factory.ts`
- Create: `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/plugin-worker.thread.ts`
- Modify: `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/index.ts`
- Modify: `test/modules/qqbot/plugin-platform/plugin-worker-entry.spec.ts`
- Modify: `test/modules/qqbot/plugin-platform/plugin-lifecycle-runtime.spec.ts`

- [ ] **Step 1: Create the dynamic worker entry test**

Create `test/modules/qqbot/plugin-platform/plugin-worker-entry.spec.ts`:

```ts
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createPluginFromDescriptor } from '@/modules/qqbot/plugin-platform/infrastructure/integration/runtime/plugin-worker.thread';

describe('generic plugin worker entry', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'qqbot-plugin-worker-'));
  });

  afterEach(() => {
    rmSync(tempRoot, { force: true, recursive: true });
  });

  it('loads a package entry from the descriptor instead of a plugin key switch', async () => {
    const packageRoot = join(tempRoot, 'sample');
    mkdirSync(join(packageRoot, 'src'), { recursive: true });
    const entryFile = join(packageRoot, 'src', 'index.js');
    writeFileSync(
      entryFile,
      `
      exports.createPlugin = (options) => ({
        activate: async () => undefined,
        health: async () => ({ ok: true, pluginKey: options.manifest.key }),
        operations: [],
      });
      `,
      'utf8',
    );

    const plugin = await createPluginFromDescriptor({
      descriptor: {
        entry: 'src/index.js',
        entryFile,
        manifest: {
          key: 'sample',
          name: 'Sample',
          version: '1.0.0',
          entry: 'src/index.js',
          runtime: {
            configKeys: [],
            maxConcurrency: 1,
            memoryMb: 128,
            timeoutMs: 5000,
            workerType: 'thread',
          },
          operations: [],
          events: [],
          tasks: [],
        },
        packageRoot,
        pluginKey: 'sample',
      },
      host: {},
      runtime: { configSnapshot: {}, installationId: 'install-1' },
    });

    await expect(plugin.health()).resolves.toEqual({
      ok: true,
      pluginKey: 'sample',
    });
  });
});
```

- [ ] **Step 2: Run the dynamic worker entry test and capture the red result**

Run:

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/plugin-platform/plugin-worker-entry.spec.ts
```

Expected: FAIL because `plugin-worker.thread.ts` does not exist.

- [ ] **Step 3: Implement the generic worker entry helper**

Create `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/plugin-worker.thread.ts`:

```ts
import { parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

import type { QqbotPluginPackageDescriptor } from '../package/plugin-package.types';

export type QqbotWorkerCreatePluginOptions = {
  descriptor: QqbotPluginPackageDescriptor;
  host: Record<string, unknown>;
  runtime: {
    configSnapshot: Record<string, string | undefined>;
    installationId: string;
  };
};

export type QqbotWorkerPluginInstance = {
  activate?: () => Promise<void> | void;
  dispose?: () => Promise<void> | void;
  executeOperation?: (operationKey: string, input: unknown) => Promise<unknown>;
  handleEvent?: (eventKey: string, event: unknown) => Promise<unknown>;
  health: () => Promise<unknown> | unknown;
  operations?: unknown[];
  tasks?: unknown[];
};

/**
 * Dynamically imports a plugin package entry and creates its runtime instance.
 *
 * @param options - Worker descriptor, host bridge facade, and runtime snapshot passed from the
 * platform worker factory.
 * @returns Plugin instance exported by the package entry.
 */
export async function createPluginFromDescriptor(
  options: QqbotWorkerCreatePluginOptions,
): Promise<QqbotWorkerPluginInstance> {
  const moduleUrl = pathToFileURL(options.descriptor.entryFile).href;
  const entryModule = (await import(moduleUrl)) as {
    createPlugin?: (input: {
      host: Record<string, unknown>;
      manifest: QqbotPluginPackageDescriptor['manifest'];
      normalizeError: (error: unknown) => Error;
      now: () => Date;
      runtime: QqbotWorkerCreatePluginOptions['runtime'];
    }) => QqbotWorkerPluginInstance | Promise<QqbotWorkerPluginInstance>;
  };

  if (typeof entryModule.createPlugin !== 'function') {
    throw new Error('Plugin entry must export createPlugin(options)');
  }

  return entryModule.createPlugin({
    host: options.host,
    manifest: options.descriptor.manifest,
    normalizeError,
    now: () => new Date(),
    runtime: options.runtime,
  });
}

/**
 * Converts an unknown plugin error into an Error instance for package-local normalization.
 *
 * @param error - Error thrown by package code or external adapters.
 * @returns Error instance with a stable message.
 */
function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

if (parentPort && workerData?.descriptor) {
  void createPluginFromDescriptor({
    descriptor: workerData.descriptor,
    host: workerData.host ?? {},
    runtime: workerData.runtime ?? {
      configSnapshot: {},
      installationId: workerData.installationId,
    },
  }).catch((error) => {
    parentPort.postMessage({
      error: error instanceof Error ? error.message : String(error),
      type: 'bootstrap-error',
    });
  });
}
```

- [ ] **Step 4: Implement the generic worker factory and driver**

Create `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/plugin-worker-runtime.factory.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Worker } from 'node:worker_threads';

import type { QqbotPluginInstallation, QqbotPluginVersion } from '@/modules/qqbot/plugin-platform/domain/plugin-platform.entities';
import { QqbotPluginPackageSourceService } from '@/modules/qqbot/plugin-platform/infrastructure/integration/package/plugin-package-source.service';
import type { QqbotPluginPackageDescriptor } from '@/modules/qqbot/plugin-platform/infrastructure/integration/package/plugin-package.types';
import { QqbotPluginHostBridgeService } from '@/modules/qqbot/plugin-platform/infrastructure/integration/runtime/plugin-host-bridge.service';
import {
  QqbotPluginWorkerRuntime,
  type QqbotPluginWorkerRuntimeFactory,
} from '@/modules/qqbot/plugin-platform/infrastructure/integration/runtime/worker-runtime';

/**
 * Creates descriptor-based plugin worker runtimes.
 */
@Injectable()
export class QqbotPluginWorkerRuntimeFactoryService
  implements QqbotPluginWorkerRuntimeFactory
{
  /**
   * @param packageSource - Resolves installed or built-in package descriptors from manifests.
   * @param hostBridge - Handles generic host calls emitted by worker threads.
   */
  constructor(
    private readonly packageSource: QqbotPluginPackageSourceService,
    private readonly hostBridge: QqbotPluginHostBridgeService,
  ) {}

  /**
   * Creates a worker runtime for one installed plugin.
   *
   * @param installation - Installation row containing runtime status and installed package path.
   * @param version - Version row containing the parsed manifest JSON.
   * @returns Worker runtime backed by a generic thread driver.
   */
  create(
    installation: QqbotPluginInstallation,
    version: QqbotPluginVersion,
  ): QqbotPluginWorkerRuntime {
    const descriptor = this.resolveDescriptor(installation, version);
    return new QqbotPluginWorkerRuntime(
      new QqbotPluginWorkerThreadDriver(this.hostBridge, descriptor),
      {
        defaultTimeoutMs: descriptor.manifest.runtime.timeoutMs,
        descriptor,
        installationId: installation.id,
        pluginKey: descriptor.pluginKey,
      },
    );
  }

  /**
   * Resolves the package descriptor for an installed plugin.
   *
   * @param installation - Installation row whose `installedPath` points to package root.
   * @param version - Version row whose manifest identifies the plugin package.
   * @returns Package descriptor used by the worker thread.
   */
  private resolveDescriptor(
    installation: QqbotPluginInstallation,
    version: QqbotPluginVersion,
  ): QqbotPluginPackageDescriptor {
    const manifest = version.manifestJson;
    return {
      entry: manifest.entry,
      entryFile: this.packageSource.resolveEntryFile(
        installation.installedPath,
        manifest.entry,
      ),
      manifest,
      packageRoot: installation.installedPath,
      pluginKey: manifest.key,
    };
  }
}

/**
 * Thread driver that starts a generic plugin worker.
 */
export class QqbotPluginWorkerThreadDriver {
  /**
   * @param hostBridge - Generic bridge used when the thread requests host capabilities.
   * @param descriptor - Package descriptor passed into workerData.
   */
  constructor(
    private readonly hostBridge: QqbotPluginHostBridgeService,
    private readonly descriptor: QqbotPluginPackageDescriptor,
  ) {}

  /**
   * Starts the worker thread.
   *
   * @returns Node worker instance configured with the package descriptor.
   */
  start(): Worker {
    return new Worker(require.resolve('./plugin-worker.thread'), {
      workerData: {
        descriptor: this.descriptor,
        runtime: {
          configSnapshot: {},
          installationId: this.descriptor.pluginKey,
        },
      },
    });
  }
}
```

- [ ] **Step 5: Export only generic runtime files**

Replace `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/index.ts` with:

```ts
export * from './bullmq-plugin-worker-request.queue';
export * from './plugin-host-bridge.service';
export * from './plugin-host-bridge.types';
export * from './plugin-worker-runtime.factory';
export * from './worker-runtime';
export * from './worker-runtime.types';
```

- [ ] **Step 6: Run worker entry and lifecycle tests**

Run:

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/plugin-platform/plugin-worker-entry.spec.ts test/modules/qqbot/plugin-platform/plugin-lifecycle-runtime.spec.ts
```

Expected: PASS after updating `plugin-lifecycle-runtime.spec.ts` imports from `QqbotBuiltinPluginWorkerRuntimeFactoryService` to `QqbotPluginWorkerRuntimeFactoryService` and replacing built-in loader mocks with descriptor source mocks.

- [ ] **Step 7: Commit Task 4**

Run:

```powershell
git add src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/plugin-worker-runtime.factory.ts src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/plugin-worker.thread.ts src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/index.ts test/modules/qqbot/plugin-platform/plugin-worker-entry.spec.ts test/modules/qqbot/plugin-platform/plugin-lifecycle-runtime.spec.ts
git commit -m "feat: 使用通用插件worker入口"
```

## Task 5: Package-Owned Entry Adapters and Config Keys

**Files:**
- Modify: `src/modules/qqbot/plugins/bangdream/plugin.json`
- Modify: `src/modules/qqbot/plugins/bangdream/src/index.ts`
- Modify: `src/modules/qqbot/plugins/ff14-market/plugin.json`
- Modify: `src/modules/qqbot/plugins/ff14-market/src/index.ts`
- Modify: `src/modules/qqbot/plugins/fflogs/plugin.json`
- Modify: `src/modules/qqbot/plugins/fflogs/src/index.ts`
- Modify: `src/modules/qqbot/plugins/repeater/plugin.json`
- Modify: `src/modules/qqbot/plugins/repeater/src/index.ts`
- Modify: `test/qqbot/plugins/bangdream/application/bangdream-package-entry.spec.ts`

- [ ] **Step 1: Add package-entry contract tests**

Append this test to `test/qqbot/plugins/bangdream/application/bangdream-package-entry.spec.ts`:

```ts
it('accepts the generic plugin platform createPlugin contract', async () => {
  const plugin = await createPlugin({
    host: {
      getConfig: async () => undefined,
      getConfigMany: async () => ({}),
      getDictItemsByKey: async () => [],
      readAssetFile: async () => Buffer.from([]),
      requestBuffer: async () => Buffer.from([]),
      requestJson: async () => ({}),
      warn: () => undefined,
    },
    manifest: {
      key: 'bangdream',
      name: 'BangDream',
      version: '1.0.0',
      entry: 'src/index.ts',
      runtime: {
        configKeys: ['BANGDREAM_TSUGU_BESTDORI_BASE_URL'],
        maxConcurrency: 1,
        memoryMb: 256,
        timeoutMs: 30000,
        workerType: 'thread',
      },
      operations: [],
      tasks: [],
      events: [],
    },
    normalizeError: (error: unknown) =>
      error instanceof Error ? error : new Error(String(error)),
    now: () => new Date('2026-06-18T00:00:00.000Z'),
    runtime: {
      configSnapshot: {},
      installationId: 'install-bangdream',
    },
  });

  expect(plugin).toEqual(
    expect.objectContaining({
      executeOperation: expect.any(Function),
      health: expect.any(Function),
    }),
  );
});
```

- [ ] **Step 2: Run the package-entry test and capture the red result**

Run:

```powershell
pnpm exec jest --runInBand --runTestsByPath test/qqbot/plugins/bangdream/application/bangdream-package-entry.spec.ts
```

Expected: FAIL for BangDream until its entry accepts the generic contract.

- [ ] **Step 3: Add BangDream runtime config keys**

Update `src/modules/qqbot/plugins/bangdream/plugin.json` runtime section with these keys:

```json
"runtime": {
  "workerType": "thread",
  "timeoutMs": 30000,
  "memoryMb": 512,
  "maxConcurrency": 1,
  "configKeys": [
    "BANGDREAM_TSUGU_BESTDORI_BASE_URL",
    "BANGDREAM_TSUGU_CACHE_ROOT",
    "BANGDREAM_TSUGU_COMPRESS",
    "BANGDREAM_TSUGU_DISPLAYED_SERVERS",
    "BANGDREAM_TSUGU_HHWX_BASE_URL",
    "BANGDREAM_TSUGU_MAIN_DATA_READY_TIMEOUT_MS",
    "BANGDREAM_TSUGU_MAIN_SERVER",
    "BANGDREAM_TSUGU_REQUEST_TIMEOUT_MS",
    "BANGDREAM_TSUGU_RETRY_COUNT",
    "BANGDREAM_TSUGU_USE_EASY_BG"
  ]
}
```

- [ ] **Step 4: Update BangDream entry adapter**

Refactor `src/modules/qqbot/plugins/bangdream/src/index.ts` so the exported function has this contract and JSDoc:

```ts
export type QqbotGenericPluginCreateOptions = {
  host: BangDreamGenericHost;
  manifest: QqbotPluginManifest;
  normalizeError: (error: unknown) => Error;
  now: () => Date;
  runtime: {
    configSnapshot: Record<string, string | undefined>;
    installationId: string;
  };
};

/**
 * Creates the BangDream plugin instance for the generic QQBot plugin platform.
 *
 * @param options - Generic platform context; BangDream reads host config and IO adapters from
 * this object instead of receiving package-specific platform services.
 * @returns Command plugin instance with BangDream operations and scheduled tasks.
 */
export async function createPlugin(
  options: QqbotGenericPluginCreateOptions,
): Promise<BangDreamCommandPlugin> {
  const configReader = createBangDreamConfigReader({
    getConfig: options.host.getConfig,
    snapshot: options.runtime.configSnapshot,
  });
  const io = createBangDreamRuntimeIo({
    host: options.host,
    now: options.now,
  });
  return createBangDreamCommandPlugin({
    configReader,
    io,
    manifest: options.manifest,
    normalizeError: options.normalizeError,
    pluginKey: options.manifest.key,
  });
}
```

The concrete helper names in this step must map to existing BangDream package functions or be created inside the BangDream package, never inside `plugin-platform`.

- [ ] **Step 5: Add FF14 Market runtime config keys**

Update `src/modules/qqbot/plugins/ff14-market/plugin.json` runtime section:

```json
"runtime": {
  "workerType": "thread",
  "timeoutMs": 30000,
  "memoryMb": 256,
  "maxConcurrency": 1,
  "configKeys": [
    "FF14_DEFAULT_WORLD",
    "FF14_UNIVERSALIS_BASE_URL",
    "FF14_XIVAPI_BASE_URL",
    "FF14_XIVAPI_CHS_BASE_URL"
  ]
}
```

- [ ] **Step 6: Add FFLogs runtime config keys and package-owned world resolution**

Update `src/modules/qqbot/plugins/fflogs/plugin.json` runtime section:

```json
"runtime": {
  "workerType": "thread",
  "timeoutMs": 30000,
  "memoryMb": 256,
  "maxConcurrency": 1,
  "configKeys": [
    "FFLOGS_WEB_BASE_URL",
    "FFLOGS_BASE_URL",
    "FFLOGS_CLIENT_ID",
    "FFLOGS_CLIENT_SECRET",
    "FFLOGS_GRAPHQL_URL",
    "FFLOGS_TOKEN_URL",
    "FFLOGS_DEFAULT_SERVER",
    "FFLOGS_DEFAULT_SERVER_REGION",
    "FFLOGS_REQUEST_TIMEOUT_MS"
  ]
}
```

Update FFLogs package code so any server/world lookup uses generic host dictionary methods:

```ts
type FflogsPluginHost = {
  getConfig: (key: string) => Promise<string | undefined>;
  getDictItemsByKey: (key: string) => Promise<unknown[]>;
  relationTree: (key: string) => Promise<unknown>;
  requestJson: (url: string, options?: unknown) => Promise<unknown>;
  warn: (message: string) => void;
};
```

- [ ] **Step 7: Add Repeater runtime config keys**

Update `src/modules/qqbot/plugins/repeater/plugin.json` runtime section:

```json
"runtime": {
  "workerType": "thread",
  "timeoutMs": 10000,
  "memoryMb": 128,
  "maxConcurrency": 1,
  "configKeys": [
    "QQBOT_REPEATER_CONFIG_CACHE_TTL_MS",
    "QQBOT_REPEATER_MAX_TEXT_LENGTH",
    "QQBOT_REPEATER_MIN_INTERVAL_MS",
    "QQBOT_REPEATER_STATE_TTL_MS",
    "QQBOT_REPEATER_THRESHOLD"
  ]
}
```

- [ ] **Step 8: Run package tests**

Run:

```powershell
pnpm exec jest --runInBand --runTestsByPath test/qqbot/plugins/bangdream/application/bangdream-package-entry.spec.ts test/modules/qqbot/plugins/plugin-registry-compat.spec.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 5**

Run:

```powershell
git add src/modules/qqbot/plugins/bangdream/plugin.json src/modules/qqbot/plugins/bangdream/src/index.ts src/modules/qqbot/plugins/ff14-market/plugin.json src/modules/qqbot/plugins/ff14-market/src/index.ts src/modules/qqbot/plugins/fflogs/plugin.json src/modules/qqbot/plugins/fflogs/src/index.ts src/modules/qqbot/plugins/repeater/plugin.json src/modules/qqbot/plugins/repeater/src/index.ts test/qqbot/plugins/bangdream/application/bangdream-package-entry.spec.ts
git commit -m "feat: 统一内置插件包入口契约"
```

## Task 6: Platform Service and Registry Decoupling

**Files:**
- Modify: `src/modules/qqbot/plugin-platform/plugin-platform.module.ts`
- Modify: `src/modules/qqbot/plugin-platform/application/plugin-platform.service.ts`
- Modify: `src/modules/qqbot/plugin-platform/application/registry/qqbot-plugin-registry.service.ts`
- Modify: `src/modules/qqbot/plugin-platform/application/registry/qqbot-event-plugin-registry.service.ts`
- Modify: `test/modules/qqbot/plugin-platform/plugin-platform-di.spec.ts`
- Modify: `test/modules/qqbot/plugin-platform/plugin-lifecycle-runtime.spec.ts`

- [ ] **Step 1: Update DI tests to reject the old loader**

Update `test/modules/qqbot/plugin-platform/plugin-platform-di.spec.ts` with this assertion:

```ts
it('does not inject the removed built-in plugin loader into platform services', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/modules/qqbot/plugin-platform/plugin-platform.module.ts'),
    'utf8',
  );

  expect(source).not.toContain('QqbotBuiltinPluginPackageLoaderService');
  expect(source).toContain('QqbotPluginPackageSourceService');
  expect(source).toContain('QqbotPluginWorkerRuntimeFactoryService');
});
```

- [ ] **Step 2: Run DI tests and capture the red result**

Run:

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/plugin-platform/plugin-platform-di.spec.ts
```

Expected: FAIL while the module still imports the old built-in loader.

- [ ] **Step 3: Update module providers**

In `src/modules/qqbot/plugin-platform/plugin-platform.module.ts`, replace built-in providers with:

```ts
providers: [
  QqbotPluginPackagePathPolicyService,
  QqbotPluginPackageSourceService,
  QqbotPluginHostBridgeService,
  QqbotPluginWorkerRuntimeFactoryService,
  {
    provide: QQBOT_PLUGIN_RUNTIME_FACTORY,
    useExisting: QqbotPluginWorkerRuntimeFactoryService,
  },
  QqbotPluginRegistryService,
  QqbotEventPluginRegistryService,
  QqbotPluginPlatformService,
]
```

- [ ] **Step 4: Replace built-in startup with package descriptor startup**

In `src/modules/qqbot/plugin-platform/application/plugin-platform.service.ts`, inject `QqbotPluginPackageSourceService` instead of `QqbotBuiltinPluginPackageLoaderService` and replace `startBuiltinWorkers()` with:

```ts
/**
 * Starts all built-in plugin packages discovered from controlled package roots.
 *
 * @returns Number of workers that reached the active runtime registry.
 */
async startBuiltinWorkers(): Promise<number> {
  if (!this.runtimeFactory) {
    return 0;
  }

  const descriptors = await this.packageSource.discoverPackages();
  let startedCount = 0;
  for (const descriptor of descriptors) {
    const installation = await this.ensureBuiltinInstallation(descriptor);
    const version = await this.ensureBuiltinVersion(descriptor);
    await this.startWorker(installation, version);
    startedCount += 1;
  }
  return startedCount;
}
```

Add or refactor helper methods in the same service:

```ts
/**
 * Ensures a built-in package has an installation row.
 *
 * @param descriptor - Package descriptor discovered from `plugin.json`.
 * @returns Installation row whose installed path is the package root.
 */
private async ensureBuiltinInstallation(
  descriptor: QqbotPluginPackageDescriptor,
): Promise<QqbotPluginInstallation> {
  const plugin = await this.ensurePluginRecord(descriptor.manifest);
  const version = await this.ensureBuiltinVersion(descriptor);
  return this.installationRepository.save({
    installedPath: descriptor.packageRoot,
    pluginId: plugin.id,
    status: 'enabled',
    versionId: version.id,
  });
}

/**
 * Ensures a built-in package has a version row with its manifest snapshot.
 *
 * @param descriptor - Package descriptor discovered from `plugin.json`.
 * @returns Version row tied to the package manifest.
 */
private async ensureBuiltinVersion(
  descriptor: QqbotPluginPackageDescriptor,
): Promise<QqbotPluginVersion> {
  return this.versionRepository.save({
    manifestJson: descriptor.manifest,
    packageHash: `${descriptor.pluginKey}:${descriptor.manifest.version}`,
    pluginId: descriptor.pluginKey,
    version: descriptor.manifest.version,
  });
}
```

The helper implementations must preserve the existing entity field names and repository methods in this codebase. If a repository lookup already exists in `plugin-platform.service.ts`, reuse it and keep the same uniqueness semantics.

- [ ] **Step 5: Remove built-in loader hydration from registries**

In `src/modules/qqbot/plugin-platform/application/registry/qqbot-plugin-registry.service.ts`, remove the built-in loader constructor parameter and make `onModuleInit()` only hydrate persisted or manually registered generic operations:

```ts
/**
 * Initializes command registry state without importing built-in plugin packages.
 *
 * @returns Promise that resolves after persisted registry state is loaded.
 */
async onModuleInit(): Promise<void> {
  await this.hydratePersistedOperations();
}
```

In `src/modules/qqbot/plugin-platform/application/registry/qqbot-event-plugin-registry.service.ts`, remove the built-in loader constructor parameter and ensure event metadata is registered through platform runtime summaries:

```ts
/**
 * Registers event metadata emitted by an active plugin worker.
 *
 * @param pluginKey - Package key from the active worker descriptor.
 * @param events - Event definitions returned by the package manifest or worker health summary.
 */
registerRuntimeEvents(pluginKey: string, events: QqbotPluginEventDefinition[]): void {
  this.runtimeEventsByPluginKey.set(pluginKey, events);
}
```

- [ ] **Step 6: Run DI and lifecycle tests**

Run:

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/plugin-platform/plugin-platform-di.spec.ts test/modules/qqbot/plugin-platform/plugin-lifecycle-runtime.spec.ts test/modules/qqbot/plugin-platform/plugin-registry-timeout.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

Run:

```powershell
git add src/modules/qqbot/plugin-platform/plugin-platform.module.ts src/modules/qqbot/plugin-platform/application/plugin-platform.service.ts src/modules/qqbot/plugin-platform/application/registry/qqbot-plugin-registry.service.ts src/modules/qqbot/plugin-platform/application/registry/qqbot-event-plugin-registry.service.ts test/modules/qqbot/plugin-platform/plugin-platform-di.spec.ts test/modules/qqbot/plugin-platform/plugin-lifecycle-runtime.spec.ts
git commit -m "feat: 解耦插件平台启动和注册链路"
```

## Task 7: Remove Old Built-In Coupling and Add Architecture Gate

**Files:**
- Delete: `src/modules/qqbot/plugin-platform/infrastructure/integration/package/builtin-plugin-package-loader.service.ts`
- Delete: `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/builtin-plugin-worker-runtime.factory.ts`
- Delete: `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/builtin-plugin-worker.thread.ts`
- Delete: `test/modules/qqbot/plugin-platform/builtin-plugin-package-loader.spec.ts`
- Modify: `test/modules/qqbot/architecture/qqbot-plugin-package-boundary.spec.ts`

- [ ] **Step 1: Add the strict boundary gate**

Append this complete test block to `test/modules/qqbot/architecture/qqbot-plugin-package-boundary.spec.ts`:

```ts
describe('plugin platform package decoupling', () => {
  const platformRoot = join(process.cwd(), 'src/modules/qqbot/plugin-platform');
  const forbiddenPattern =
    /@\/modules\/qqbot\/plugins|src\/modules\/qqbot\/plugins|QqbotBuiltinPluginPackageLoaderService|BUILTIN_PLUGIN_KEYS|getConfigKeysForPlugin|createBangDreamPlugin|createFf14MarketPlugin|createFflogsPlugin|createRepeaterPlugin/;
  const forbiddenBranchPattern =
    /pluginKey\s*(?:={2,3})\s*['"`](bangdream|ff14-market|fflogs|repeater)['"`]|case\s+['"`](bangdream|ff14-market|fflogs|repeater)['"`]/;

  /**
   * Walks source files under a directory for architecture assertions.
   *
   * @param dir - Directory to scan recursively.
   * @returns TypeScript source files under the directory.
   */
  function walkSourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const file = join(dir, name);
      const stat = statSync(file);
      if (stat.isDirectory()) {
        return walkSourceFiles(file);
      }
      return file.endsWith('.ts') ? [file] : [];
    });
  }

  it('does not import, instantiate, or branch on concrete built-in plugins', () => {
    const offenders = walkSourceFiles(platformRoot)
      .map((file) => ({
        file,
        source: readFileSync(file, 'utf8'),
      }))
      .filter(
        ({ source }) =>
          forbiddenPattern.test(source) || forbiddenBranchPattern.test(source),
      )
      .map(({ file }) => relative(process.cwd(), file));

    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the architecture test and capture the red result**

Run:

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/architecture/qqbot-plugin-package-boundary.spec.ts
```

Expected: FAIL while old `builtin-plugin-*` files still exist.

- [ ] **Step 3: Delete old coupling files and update imports**

Run:

```powershell
Remove-Item -LiteralPath src/modules/qqbot/plugin-platform/infrastructure/integration/package/builtin-plugin-package-loader.service.ts
Remove-Item -LiteralPath src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/builtin-plugin-worker-runtime.factory.ts
Remove-Item -LiteralPath src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/builtin-plugin-worker.thread.ts
Remove-Item -LiteralPath test/modules/qqbot/plugin-platform/builtin-plugin-package-loader.spec.ts
```

Then remove any imports that referenced those files:

```powershell
rg -n "QqbotBuiltinPluginPackageLoaderService|builtin-plugin-worker|builtin-plugin-package-loader|BUILTIN_PLUGIN_KEYS|getConfigKeysForPlugin|createBangDreamPlugin|createFf14MarketPlugin|createFflogsPlugin|createRepeaterPlugin" src test
```

Expected: no matches outside the architecture test forbidden pattern text.

- [ ] **Step 4: Run the architecture test and capture the green result**

Run:

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/architecture/qqbot-plugin-package-boundary.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 7**

Run:

```powershell
git add -A src/modules/qqbot/plugin-platform test/modules/qqbot/plugin-platform test/modules/qqbot/architecture/qqbot-plugin-package-boundary.spec.ts
git commit -m "refactor: 删除插件平台内置插件耦合"
```

## Task 8: Verification, Local Smoke, and Documentation

**Files:**
- Modify: `TASKS.md` in workspace root after implementation evidence exists.

- [ ] **Step 1: Run forbidden-reference scans**

Run:

```powershell
rg -n "@/modules/qqbot/plugins|src/modules/qqbot/plugins" src/modules/qqbot/plugin-platform
rg -n "QqbotBuiltinPluginPackageLoaderService|BUILTIN_PLUGIN_KEYS|getConfigKeysForPlugin|createBangDreamPlugin|createFf14MarketPlugin|createFflogsPlugin|createRepeaterPlugin" src/modules/qqbot/plugin-platform
rg -n "pluginKey\\s*(?:={2,3})\\s*['\"`](bangdream|ff14-market|fflogs|repeater)['\"`]|case\\s+['\"`](bangdream|ff14-market|fflogs|repeater)['\"`]" src/modules/qqbot/plugin-platform
```

Expected: all three commands return no matches.

- [ ] **Step 2: Run targeted tests**

Run:

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/plugin-platform/manifest.spec.ts test/modules/qqbot/plugin-platform/plugin-package-source.spec.ts test/modules/qqbot/plugin-platform/plugin-worker-entry.spec.ts test/modules/qqbot/plugin-platform/worker-runtime.spec.ts test/modules/qqbot/plugin-platform/plugin-platform-di.spec.ts test/modules/qqbot/plugin-platform/plugin-lifecycle-runtime.spec.ts test/modules/qqbot/architecture/qqbot-plugin-package-boundary.spec.ts test/qqbot/plugins/bangdream/application/bangdream-package-entry.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run project checks**

Run:

```powershell
pnpm run typecheck
pnpm run build
```

Expected: both commands exit with code 0.

- [ ] **Step 4: Run local API smoke for plugin interface behavior**

Start or reuse the local API service, then call the plugin endpoints with an admin token from the local environment:

```powershell
curl.exe -sS "http://127.0.0.1:3000/api/qqbot/plugin/page?page=1&pageSize=10" -H "Authorization: Bearer <local-admin-token>"
curl.exe -sS "http://127.0.0.1:3000/api/qqbot/plugin/operation/page?page=1&pageSize=10" -H "Authorization: Bearer <local-admin-token>"
curl.exe -sS "http://127.0.0.1:3000/api/qqbot/plugin/task/page?page=1&pageSize=10" -H "Authorization: Bearer <local-admin-token>"
```

Expected: each response has `code` success semantics used by this API and returns plugin data without server errors. Replace `<local-admin-token>` with a token generated from the local admin user; do not commit the token.

- [ ] **Step 5: Run global review**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run global-review -- --repo D:\MyFiles\KT\Node\kt-template-online-api --changed
```

Expected: no Important findings. Fix Important findings and rerun before committing the final implementation batch.

- [ ] **Step 6: Update root TASKS record**

Edit `D:\MyFiles\KT\TASKS.md` under the latest QQBot plugin-platform decoupling record. Add:

```markdown
- Implementation evidence: plugin-platform no longer imports or branches on concrete built-in plugin packages; worker runtime uses descriptor-based dynamic entry loading.
- Verification: targeted Jest, `pnpm run typecheck`, `pnpm run build`, forbidden-reference scans, local plugin API smoke, ktWorkflow global review.
```

- [ ] **Step 7: Commit implementation documentation update**

Run from `D:\MyFiles\KT`:

```powershell
git add TASKS.md
git commit -m "docs: 记录QQBot插件平台解耦实现"
```

- [ ] **Step 8: Final API commit check**

Run from `D:\MyFiles\KT\Node\kt-template-online-api`:

```powershell
git status --short --branch
git log --oneline -5
```

Expected: working tree clean and recent commits include the Task 1 through Task 7 commits.

## Self-Review

### Spec Coverage

- Strict platform decoupling: Task 7 adds architecture gates and deletes old `builtin-plugin-*` files.
- Built-ins as ordinary package descriptors: Task 2 discovers packages from `*/plugin.json`; Task 6 starts workers from descriptors.
- Worker descriptor with package root and entry: Task 3 extends runtime options; Task 4 passes descriptor into the dynamic worker entry.
- Dynamic import entry contract: Task 4 creates `createPluginFromDescriptor`; Task 5 adapts package entries.
- Config key ownership: Task 1 adds manifest parsing; Task 5 adds package-owned config keys.
- FFLogs world resolution ownership: Task 5 moves it to package code through generic host methods.
- No platform switch on concrete plugins: Task 7 scans imports, symbols, and plugin-key branches.
- Verification and documentation: Task 8 covers targeted tests, scans, typecheck, build, local API smoke, global review, and root `TASKS.md`.

### Placeholder Scan

Run after saving this plan:

```powershell
$patterns = @(
  'T' + 'BD',
  'TO' + 'DO',
  '待' + '补',
  '待' + '定',
  'fill' + ' in',
  'implement' + ' later',
  'Similar' + ' to',
  'appropriate error' + ' handling',
  'write tests' + ' for'
)
foreach ($pattern in $patterns) {
  rg -n --fixed-strings $pattern docs/plans/2026-06-18-qqbot-plugin-platform-decoupling-implementation-plan.md
}
```

Expected: no matches.

### Type Consistency

- `QqbotPluginPackageDescriptor` is introduced in Task 2 and reused by runtime types, host bridge, worker factory, and platform service tasks.
- `QqbotPluginWorkerRuntimeOptions.descriptor` is introduced in Task 3 and consumed in Task 4.
- `QqbotPluginPackageSourceService.discoverPackages()` returns descriptors and is consumed by Task 6.
- Old built-in names are intentionally present only in test forbidden-pattern strings and this plan.
