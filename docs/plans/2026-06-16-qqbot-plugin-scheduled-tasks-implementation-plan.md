# QQBot Plugin Scheduled Tasks Implementation Plan

> **Execution note:** Execute this plan task-by-task with the KT-local workflow and use the checkboxes to track plan state.

**Goal:** Build a unified QQBot plugin scheduled-task platform, expose it in Admin, and land BangDream Bestdori main-data sync as the first managed plugin task.

**Architecture:** Plugin manifests declare `tasks`; plugin-platform persists task definitions, schedules enabled tasks with BullMQ Job Scheduler, executes them through the existing worker-thread boundary via `executeTask`, and stores task run records. BangDream owns its own sync task under its plugin package, while Admin gets a dedicated `/qqbot/plugin-task` page with paged task management, cron editing, manual run, and run-log drawer.

**Tech Stack:** NestJS 11, TypeORM, BullMQ 5.78.1 `Queue.upsertJobScheduler`, MySQL, Jest, Vben Admin, Vue 3 TSX, antdv-next, `@vue-js-cron/core`, Vitest.

---

## Current Evidence

- API repo: `D:\MyFiles\KT\Node\kt-template-online-api`
- Admin repo: `D:\MyFiles\KT\Vue\kt-template-admin`
- Design spec: `D:\MyFiles\KT\Node\kt-template-online-api\docs\specs\2026-06-16-qqbot-plugin-scheduled-tasks-design.md`
- Online interface stage is already closed: final smoke artifact `.kt-workspace/test-artifacts/online-full-smoke/20260616-164531/api-full-interface-smoke-20260616091328.json` reported 175 OpenAPI operations, 102 pass, 4 expectedBlocked, 69 skipped, 0 failed. QQBot concurrent `/查分数表 cn` + `/查卡 472` both passed after the queue-wait timeout fix deployed as API `14e2ec9`.
- Existing plugin-platform owns manifest parsing, worker runtime, persistence entities, controller, and operation/event capabilities under `src/modules/qqbot/plugin-platform/**`.
- Existing BangDream package root is `src/modules/qqbot/plugins/bangdream`; do not create transfer layers or `builtins/**`.
- Existing Admin QQBot app root is `apps/web-antdv-next/src/views/qqbot`.

## File Map

### API Files To Create

- `src/modules/qqbot/plugin-platform/application/task/qqbot-plugin-task.types.ts`  
  DTO/query/result types for task list, run list, enable/disable/update cron/manual run, and task run status.
- `src/modules/qqbot/plugin-platform/application/task/qqbot-plugin-task-cron.validator.ts`  
  Five-field cron validator shared by manifest parsing and Admin update endpoints.
- `src/modules/qqbot/plugin-platform/application/task/qqbot-plugin-task-manifest.synchronizer.ts`  
  Sync manifest `tasks` into `qqbot_plugin_task` rows for install, enable, upgrade, and builtin bootstrap.
- `src/modules/qqbot/plugin-platform/application/task/qqbot-plugin-task.service.ts`  
  Admin-facing task query/mutation/run-log service.
- `src/modules/qqbot/plugin-platform/application/task/qqbot-plugin-task-scheduler.service.ts`  
  BullMQ Job Scheduler bridge; registers, removes, and resyncs task schedulers.
- `src/modules/qqbot/plugin-platform/application/task/qqbot-plugin-task-worker.processor.ts`  
  BullMQ worker that creates `qqbot_plugin_task_run`, prevents overlapping runs, calls `executeTask`, and writes final state.
- `src/modules/qqbot/plugin-platform/application/task/index.ts`  
  Task-domain exports.
- `src/modules/qqbot/plugin-platform/contract/plugin-platform-task.controller.ts`  
  Admin task endpoints under `/qqbot/plugin-platform/tasks`.
- `src/modules/qqbot/plugins/bangdream/src/application/tasks/bestdori-main-data-sync.task.ts`  
  BangDream managed task implementation.
- `src/modules/qqbot/plugins/bangdream/src/application/tasks/index.ts`  
  BangDream task exports.
- `test/modules/qqbot/plugin-platform/plugin-task-manifest.spec.ts`  
  Manifest task parsing and validation contract tests.
- `test/modules/qqbot/plugin-platform/plugin-task-persistence.spec.ts`  
  Entity/schema contract tests for task tables.
- `test/modules/qqbot/plugin-platform/plugin-task-scheduler.spec.ts`  
  BullMQ scheduler bridge tests.
- `test/modules/qqbot/plugin-platform/plugin-task-api-contract.spec.ts`  
  Controller route and service contract tests.
- `test/modules/qqbot/plugins/bangdream/bestdori-main-data-sync.task.spec.ts`  
  BangDream sync task tests.

### API Files To Modify

- `src/modules/qqbot/plugin-platform/domain/manifest/manifest.types.ts`  
  Add `QqbotPluginTaskManifest` and `tasks` to `QqbotPluginManifest`.
- `src/modules/qqbot/plugin-platform/domain/manifest/manifest.parser.ts`  
  Parse and validate manifest `tasks`.
- `src/modules/qqbot/plugin-platform/infrastructure/persistence/plugin-platform.entities.ts`  
  Add `QqbotPluginTask` and `QqbotPluginTaskRun` entities.
- `src/modules/qqbot/plugin-platform/infrastructure/persistence/plugin-platform.contract.ts`  
  Add task routes and tables to the domain contract.
- `src/modules/qqbot/plugin-platform/plugin-platform.module.ts`  
  Register new controller, repositories, scheduler queue, and task services.
- `src/modules/qqbot/plugin-platform/application/plugin-platform.service.ts`  
  Include `executeTask` in runtime factory type, call task synchronizer from install/enable/upgrade/builtin bootstrap, pause task schedulers on disable/uninstall.
- `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/worker-runtime.types.ts`  
  Add `executeTask` request type and request DTO.
- `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/worker-runtime.ts`  
  Add `executeTask()` runtime method with safe input summary and timeout handling.
- `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/builtin-plugin-worker.thread.ts`  
  Dispatch `executeTask` to plugin task handlers.
- `src/modules/qqbot/plugins/bangdream/plugin.json`  
  Declare `bangdream.bestdori.sync-main-data`.
- `src/modules/qqbot/plugins/bangdream/src/index.ts`  
  Expose BangDream `tasks` array from the plugin entry.
- `src/modules/qqbot/plugins/bangdream/src/infrastructure/integration/runtime-io.ts`  
  Add atomic JSON write support where needed by the task.
- `src/modules/qqbot/plugins/bangdream/src/application/catalog/bangdream-catalog-cache.ts`  
  Export a refresh/load helper for explicit task-driven catalog refresh.
- `sql/refactor-v3/00-full-schema.sql`  
  Add `qqbot_plugin_task` and `qqbot_plugin_task_run`.
- `sql/refactor-v3/99-verify.sql`  
  Add task table verification rows.
- `sql/qqbot-init.sql`  
  Add Admin menu and permission rows for plugin scheduled tasks.
- `.env.example`, `README.md`, `API.md`, `k8s/prod/api.yaml`, `Jenkinsfile`  
  Add task scheduler env and BangDream cache root runtime notes.

### Admin Files To Create

- `apps/web-antdv-next/src/api/qqbot/plugin-task.ts`  
  Task API caller and types.
- `apps/web-antdv-next/src/api/qqbot/plugin-task.spec.ts`  
  Caller path/params tests.
- `apps/web-antdv-next/src/views/qqbot/plugin-task/list.tsx`  
  Dedicated KtTable page.
- `apps/web-antdv-next/src/views/qqbot/plugin-task/components/CronEditorAntdvNext.tsx`  
  Thin `@vue-js-cron/core` + antdv-next adapter.
- `apps/web-antdv-next/src/views/qqbot/plugin-task/components/TaskRunDrawer.tsx`  
  Run-log drawer.
- `apps/web-antdv-next/src/views/qqbot/plugin-task/components/TaskCronModal.tsx`  
  Cron edit modal.
- `apps/web-antdv-next/src/views/qqbot/plugin-task/plugin-task.spec.tsx`  
  Page interaction tests.

### Admin Files To Modify

- `apps/web-antdv-next/src/router/routes/modules/qqbot.ts`  
  Add `/qqbot/plugin-task`.
- `apps/web-antdv-next/src/api/qqbot/index.ts`  
  Export shared task page result/status types if needed.
- `apps/web-antdv-next/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`  
  Add `@vue-js-cron/core` through workspace catalog and app dependency.
- `README.md`  
  Add one-line Admin page note if the repo currently documents QQBot pages.

## Data Model

`qqbot_plugin_task`

```sql
CREATE TABLE IF NOT EXISTS qqbot_plugin_task (
  id BIGINT NOT NULL,
  plugin_id BIGINT NOT NULL,
  installation_id BIGINT NOT NULL,
  task_key VARCHAR(128) NOT NULL,
  task_name VARCHAR(128) NOT NULL,
  handler_name VARCHAR(128) NOT NULL,
  description TEXT NULL,
  default_cron VARCHAR(64) NOT NULL,
  cron_expression VARCHAR(64) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  timeout_ms INT NOT NULL,
  runtime_status VARCHAR(32) NOT NULL DEFAULT 'idle',
  last_run_id BIGINT NULL,
  last_run_at DATETIME NULL,
  last_status VARCHAR(32) NULL,
  last_error TEXT NULL,
  last_duration_ms INT NULL,
  next_run_at DATETIME NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_qqbot_plugin_task (installation_id, task_key),
  KEY idx_qqbot_plugin_task_plugin (plugin_id),
  KEY idx_qqbot_plugin_task_enabled (enabled),
  KEY idx_qqbot_plugin_task_status (runtime_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

`qqbot_plugin_task_run`

```sql
CREATE TABLE IF NOT EXISTS qqbot_plugin_task_run (
  id BIGINT NOT NULL,
  task_id BIGINT NOT NULL,
  plugin_id BIGINT NOT NULL,
  installation_id BIGINT NOT NULL,
  task_key VARCHAR(128) NOT NULL,
  trigger_type VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  job_id VARCHAR(191) NULL,
  started_at DATETIME NULL,
  finished_at DATETIME NULL,
  duration_ms INT NULL,
  safe_summary JSON NULL,
  error_message TEXT NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_qqbot_plugin_task_run_task_time (task_id, create_time),
  KEY idx_qqbot_plugin_task_run_plugin_time (plugin_id, create_time),
  KEY idx_qqbot_plugin_task_run_status_time (status, create_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

## Task 1: Manifest Task Contract And Cron Validator

**Files:**
- Modify: `src/modules/qqbot/plugin-platform/domain/manifest/manifest.types.ts`
- Modify: `src/modules/qqbot/plugin-platform/domain/manifest/manifest.parser.ts`
- Create: `src/modules/qqbot/plugin-platform/application/task/qqbot-plugin-task-cron.validator.ts`
- Create: `src/modules/qqbot/plugin-platform/application/task/qqbot-plugin-task.types.ts`
- Create: `src/modules/qqbot/plugin-platform/application/task/index.ts`
- Create: `test/modules/qqbot/plugin-platform/plugin-task-manifest.spec.ts`

- [ ] **Step 1: Write RED manifest task tests**

Add tests that prove valid tasks parse and invalid task definitions fail.

```ts
import {
  parseQqbotPluginManifest,
  QqbotPluginManifestValidationError,
} from '../../../../src/modules/qqbot/plugin-platform/domain/manifest';
import { normalizeQqbotPluginTaskCron } from '../../../../src/modules/qqbot/plugin-platform/application/task';

const createManifestWithTask = () => ({
  assets: [],
  configSchema: { type: 'object' },
  entry: 'src/index.ts',
  events: [],
  minApiSdkVersion: '1.0.0',
  name: 'BangDream',
  operations: [],
  permissions: ['runtime.http', 'plugin.storage.read', 'plugin.storage.write'],
  pluginKey: 'bangdream',
  runtime: {
    maxConcurrency: 1,
    memoryMb: 512,
    timeoutMs: 30000,
    workerType: 'node-worker',
  },
  tasks: [
    {
      defaultCron: '0 */6 * * *',
      description: '同步 BangDream 主数据',
      enabled: true,
      handlerName: 'syncBestdoriMainData',
      key: 'bangdream.bestdori.sync-main-data',
      name: '同步 Bestdori 主数据',
      permissions: ['runtime.http', 'plugin.storage.read', 'plugin.storage.write'],
      timeoutMs: 120000,
    },
  ],
  version: '2.0.0',
});

describe('QQBot plugin task manifest contract', () => {
  it('parses manifest tasks and normalizes cron whitespace', () => {
    const manifest = createManifestWithTask();
    manifest.tasks[0].defaultCron = ' 0   */6   *   *   * ';

    const parsed = parseQqbotPluginManifest(manifest);

    expect(parsed.tasks).toEqual([
      expect.objectContaining({
        defaultCron: '0 */6 * * *',
        enabled: true,
        handlerName: 'syncBestdoriMainData',
        key: 'bangdream.bestdori.sync-main-data',
        timeoutMs: 120000,
      }),
    ]);
    expect(normalizeQqbotPluginTaskCron('0 */6 * * *')).toBe('0 */6 * * *');
  });

  it('rejects invalid task metadata', () => {
    const manifest = createManifestWithTask();
    manifest.tasks.push({
      ...manifest.tasks[0],
      handlerName: '',
      key: 'BangDream.Bad',
      permissions: ['host.fs.read'],
      timeoutMs: undefined,
    } as any);

    expect(() => parseQqbotPluginManifest(manifest)).toThrow(
      QqbotPluginManifestValidationError,
    );
    try {
      parseQqbotPluginManifest(manifest);
    } catch (error) {
      expect((error as QqbotPluginManifestValidationError).issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'DUPLICATE_TASK_KEY' }),
          expect.objectContaining({ code: 'INVALID_CAPABILITY_KEY' }),
          expect.objectContaining({ code: 'MISSING_TASK_HANDLER' }),
          expect.objectContaining({ code: 'MISSING_TASK_TIMEOUT' }),
          expect.objectContaining({ code: 'UNKNOWN_PERMISSION' }),
        ]),
      );
    }
  });

  it('rejects six-field cron and too-frequent task cron', () => {
    expect(() => normalizeQqbotPluginTaskCron('* * * * * *')).toThrow(
      '定时任务 cron 必须是 5 段表达式',
    );
    expect(() => normalizeQqbotPluginTaskCron('* * * * *')).toThrow(
      '定时任务 cron 不允许每分钟执行',
    );
  });
});
```

- [ ] **Step 2: Run RED test**

Run:

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/plugin-platform/plugin-task-manifest.spec.ts
```

Expected: FAIL because `tasks` and `normalizeQqbotPluginTaskCron` do not exist.

- [ ] **Step 3: Implement task types and cron validator**

Add to `qqbot-plugin-task.types.ts`:

```ts
export type QqbotPluginTaskRuntimeStatus =
  | 'disabled'
  | 'failed'
  | 'idle'
  | 'running'
  | 'scheduled';

export type QqbotPluginTaskRunStatus =
  | 'failed'
  | 'running'
  | 'skipped'
  | 'success';

export type QqbotPluginTaskTriggerType =
  | 'bootstrap'
  | 'manual'
  | 'schedule';

export type QqbotPluginTaskPageQuery = {
  enabled?: boolean | string;
  pageNo?: number | string;
  pageSize?: number | string;
  pluginId?: string;
  pluginKey?: string;
  status?: QqbotPluginTaskRuntimeStatus;
  taskKey?: string;
};

export type QqbotPluginTaskRunPageQuery = {
  endTime?: string;
  pageNo?: number | string;
  pageSize?: number | string;
  startTime?: string;
  status?: QqbotPluginTaskRunStatus;
  triggerType?: QqbotPluginTaskTriggerType;
};
```

Add to `qqbot-plugin-task-cron.validator.ts`:

```ts
import { throwVbenError } from '@/common';

const fieldPattern = /^[\d*/,\-]+$/;

export function normalizeQqbotPluginTaskCron(input: unknown): string {
  const value = `${input || ''}`.trim().replace(/\s+/g, ' ');
  const fields = value.split(' ').filter(Boolean);
  if (fields.length !== 5) {
    throw new Error('定时任务 cron 必须是 5 段表达式');
  }
  if (!fields.every((field) => fieldPattern.test(field))) {
    throw new Error('定时任务 cron 只能包含数字、星号、斜杠、逗号和横线');
  }
  if (fields[0] === '*') {
    throw new Error('定时任务 cron 不允许每分钟执行');
  }
  return fields.join(' ');
}

export function requireQqbotPluginTaskCron(input: unknown): string {
  try {
    return normalizeQqbotPluginTaskCron(input);
  } catch (error) {
    throwVbenError(error instanceof Error ? error.message : '定时任务 cron 不合法');
  }
}
```

Add to `index.ts`:

```ts
export * from './qqbot-plugin-task-cron.validator';
export * from './qqbot-plugin-task.types';
```

- [ ] **Step 4: Extend manifest parsing**

Add `QqbotPluginTaskManifest` to `manifest.types.ts`:

```ts
export type QqbotPluginTaskManifest = {
  defaultCron: string;
  description?: string;
  enabled: boolean;
  handlerName: string;
  key: string;
  name: string;
  permissions: QqbotPluginPermission[];
  timeoutMs: number;
};
```

Add `tasks: QqbotPluginTaskManifest[];` to `QqbotPluginManifest`.

In `manifest.parser.ts`, import `normalizeQqbotPluginTaskCron`, add `parseTasks()`, and include `tasks: parseTasks(manifestLike, issues)` in `parsedManifest`.

```ts
const parseTasks = (
  source: Record<string, unknown>,
  issues: QqbotPluginManifestValidationIssue[],
): QqbotPluginTaskManifest[] => {
  const tasks = Array.isArray(source.tasks) ? source.tasks : [];
  const seenKeys = new Set<string>();

  return tasks.filter(isPlainObject).map((task, index) => {
    const pathPrefix = `tasks[${index}]`;
    const key = getString(task, 'key') || '';
    const timeoutMs = getNumber(task, 'timeoutMs');
    let defaultCron = getString(task, 'defaultCron') || '';

    requireKey(key, `${pathPrefix}.key`, issues);
    if (seenKeys.has(key)) {
      pushIssue(issues, 'DUPLICATE_TASK_KEY', pathPrefix, `Duplicate task key: ${key}.`);
    }
    seenKeys.add(key);

    if (!getString(task, 'handlerName')) {
      pushIssue(issues, 'MISSING_TASK_HANDLER', `${pathPrefix}.handlerName`, 'Task handlerName is required.');
    }
    if (!timeoutMs) {
      pushIssue(issues, 'MISSING_TASK_TIMEOUT', `${pathPrefix}.timeoutMs`, 'Task timeoutMs is required.');
    }
    try {
      defaultCron = normalizeQqbotPluginTaskCron(defaultCron);
    } catch (error) {
      pushIssue(
        issues,
        'INVALID_TASK_CRON',
        `${pathPrefix}.defaultCron`,
        error instanceof Error ? error.message : 'Task cron is invalid.',
      );
    }

    return {
      defaultCron,
      description: getString(task, 'description'),
      enabled: task.enabled !== false,
      handlerName: getString(task, 'handlerName') || '',
      key,
      name: getString(task, 'name') || key,
      permissions: normalizePermissions(task.permissions, `${pathPrefix}.permissions`, issues),
      timeoutMs: timeoutMs || 1000,
    };
  });
};
```

- [ ] **Step 5: Run GREEN manifest tests**

Run:

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/plugin-platform/manifest.spec.ts test/modules/qqbot/plugin-platform/plugin-task-manifest.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit API manifest contract**

Run:

```powershell
git add src/modules/qqbot/plugin-platform/domain/manifest src/modules/qqbot/plugin-platform/application/task test/modules/qqbot/plugin-platform/plugin-task-manifest.spec.ts
git commit -m "feat: 增加QQBot插件定时任务manifest契约"
```

## Task 2: Task Persistence, Schema, And API Routes

**Files:**
- Modify: `src/modules/qqbot/plugin-platform/infrastructure/persistence/plugin-platform.entities.ts`
- Modify: `src/modules/qqbot/plugin-platform/infrastructure/persistence/plugin-platform.contract.ts`
- Modify: `src/modules/qqbot/plugin-platform/plugin-platform.module.ts`
- Create: `src/modules/qqbot/plugin-platform/contract/plugin-platform-task.controller.ts`
- Create: `src/modules/qqbot/plugin-platform/application/task/qqbot-plugin-task.service.ts`
- Create: `src/modules/qqbot/plugin-platform/application/task/qqbot-plugin-task-manifest.synchronizer.ts`
- Modify: `sql/refactor-v3/00-full-schema.sql`
- Modify: `sql/refactor-v3/99-verify.sql`
- Create: `test/modules/qqbot/plugin-platform/plugin-task-persistence.spec.ts`
- Create: `test/modules/qqbot/plugin-platform/plugin-task-api-contract.spec.ts`

- [ ] **Step 1: Write RED persistence and route tests**

Add persistence assertions:

```ts
import { getMetadataArgsStorage } from 'typeorm';
import {
  QQBOT_PLUGIN_PLATFORM_DOMAIN_CONTRACT,
  QQBOT_PLUGIN_PLATFORM_ENTITIES,
  QqbotPluginTask,
  QqbotPluginTaskRun,
} from '../../../../src/modules/qqbot/plugin-platform/infrastructure/persistence';
import { readRefactorV3SqlSchema } from '../../../helpers/sql-schema.helper';

describe('QQBot plugin task persistence contract', () => {
  const schema = readRefactorV3SqlSchema();

  it('declares task tables in SQL and entity registry', () => {
    expect(QQBOT_PLUGIN_PLATFORM_DOMAIN_CONTRACT.tables).toEqual(
      expect.arrayContaining(['qqbot_plugin_task', 'qqbot_plugin_task_run']),
    );
    expect(QQBOT_PLUGIN_PLATFORM_ENTITIES).toEqual(
      expect.arrayContaining([QqbotPluginTask, QqbotPluginTaskRun]),
    );
    expect(schema.hasTable('qqbot_plugin_task')).toBe(true);
    expect(schema.hasTable('qqbot_plugin_task_run')).toBe(true);
  });

  it('maps task entity columns to SQL schema', () => {
    for (const entity of [QqbotPluginTask, QqbotPluginTaskRun]) {
      const tableName = getMetadataArgsStorage().tables.find(
        (table) => table.target === entity,
      )?.name;
      const columns = getMetadataArgsStorage()
        .columns.filter((column) => column.target === entity)
        .map((column) => `${column.options.name || column.propertyName}`);

      expect(tableName).toBeTruthy();
      schema.expectTableColumns(tableName || '', columns);
    }
  });
});
```

Add route assertions:

```ts
import { QqbotPluginPlatformTaskController } from '../../../../src/modules/qqbot/plugin-platform/contract/plugin-platform-task.controller';
import {
  collectControllerRoutes,
  routeKey,
} from '../../../helpers/controller-route.helper';

describe('QQBot plugin task API contract', () => {
  it('exposes task management routes under plugin-platform ownership', () => {
    expect(collectControllerRoutes([QqbotPluginPlatformTaskController]).map(routeKey)).toEqual(
      expect.arrayContaining([
        'GET /qqbot/plugin-platform/tasks/page',
        'GET /qqbot/plugin-platform/tasks/:id',
        'POST /qqbot/plugin-platform/tasks/:id/enable',
        'POST /qqbot/plugin-platform/tasks/:id/disable',
        'POST /qqbot/plugin-platform/tasks/:id/cron',
        'POST /qqbot/plugin-platform/tasks/:id/run',
        'GET /qqbot/plugin-platform/tasks/:id/runs',
      ]),
    );
  });
});
```

- [ ] **Step 2: Run RED persistence/API tests**

Run:

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/plugin-platform/plugin-task-persistence.spec.ts test/modules/qqbot/plugin-platform/plugin-task-api-contract.spec.ts
```

Expected: FAIL because entities and controller do not exist.

- [ ] **Step 3: Add task entities**

Add to `plugin-platform.entities.ts`:

```ts
export type QqbotPluginTaskRuntimeStatus =
  | 'disabled'
  | 'failed'
  | 'idle'
  | 'running'
  | 'scheduled';

export type QqbotPluginTaskRunStatus =
  | 'failed'
  | 'running'
  | 'skipped'
  | 'success';

export type QqbotPluginTaskTriggerType =
  | 'bootstrap'
  | 'manual'
  | 'schedule';

@Entity('qqbot_plugin_task')
@Index('uk_qqbot_plugin_task', ['installationId', 'taskKey'], { unique: true })
@Index('idx_qqbot_plugin_task_plugin', ['pluginId'])
@Index('idx_qqbot_plugin_task_enabled', ['enabled'])
@Index('idx_qqbot_plugin_task_status', ['runtimeStatus'])
export class QqbotPluginTask {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'plugin_id', type: 'bigint' })
  pluginId: string;

  @Column({ name: 'installation_id', type: 'bigint' })
  installationId: string;

  @Column({ length: 128, name: 'task_key' })
  taskKey: string;

  @Column({ length: 128, name: 'task_name' })
  taskName: string;

  @Column({ length: 128, name: 'handler_name' })
  handlerName: string;

  @Column({ name: 'description', nullable: true, type: 'text' })
  description: null | string;

  @Column({ length: 64, name: 'default_cron' })
  defaultCron: string;

  @Column({ length: 64, name: 'cron_expression' })
  cronExpression: string;

  @Column({ default: true })
  enabled: boolean;

  @Column({ name: 'timeout_ms', type: 'int' })
  timeoutMs: number;

  @Column({ length: 32, name: 'runtime_status' })
  runtimeStatus: QqbotPluginTaskRuntimeStatus;

  @Column({ name: 'last_run_id', nullable: true, type: 'bigint' })
  lastRunId: null | string;

  @Column({ name: 'last_run_at', nullable: true, type: 'datetime' })
  lastRunAt: null | KtDateTime;

  @Column({ length: 32, name: 'last_status', nullable: true })
  lastStatus: null | QqbotPluginTaskRunStatus;

  @Column({ name: 'last_error', nullable: true, type: 'text' })
  lastError: null | string;

  @Column({ name: 'last_duration_ms', nullable: true, type: 'int' })
  lastDurationMs: null | number;

  @Column({ name: 'next_run_at', nullable: true, type: 'datetime' })
  nextRunAt: null | KtDateTime;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}

@Entity('qqbot_plugin_task_run')
@Index('idx_qqbot_plugin_task_run_task_time', ['taskId', 'createTime'])
@Index('idx_qqbot_plugin_task_run_plugin_time', ['pluginId', 'createTime'])
@Index('idx_qqbot_plugin_task_run_status_time', ['status', 'createTime'])
export class QqbotPluginTaskRun {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'task_id', type: 'bigint' })
  taskId: string;

  @Column({ name: 'plugin_id', type: 'bigint' })
  pluginId: string;

  @Column({ name: 'installation_id', type: 'bigint' })
  installationId: string;

  @Column({ length: 128, name: 'task_key' })
  taskKey: string;

  @Column({ length: 32, name: 'trigger_type' })
  triggerType: QqbotPluginTaskTriggerType;

  @Column({ length: 32 })
  status: QqbotPluginTaskRunStatus;

  @Column({ length: 191, name: 'job_id', nullable: true })
  jobId: null | string;

  @Column({ name: 'started_at', nullable: true, type: 'datetime' })
  startedAt: null | KtDateTime;

  @Column({ name: 'finished_at', nullable: true, type: 'datetime' })
  finishedAt: null | KtDateTime;

  @Column({ name: 'duration_ms', nullable: true, type: 'int' })
  durationMs: null | number;

  @Column({ name: 'safe_summary', nullable: true, type: 'simple-json' })
  safeSummary: null | Record<string, unknown>;

  @Column({ name: 'error_message', nullable: true, type: 'text' })
  errorMessage: null | string;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
```

Append both entities to `QQBOT_PLUGIN_PLATFORM_ENTITIES`.

- [ ] **Step 4: Add SQL schema and verify checks**

Insert the two SQL tables after `qqbot_plugin_runtime_event` in `sql/refactor-v3/00-full-schema.sql` using the table definitions from the Data Model section.

Append to `sql/refactor-v3/99-verify.sql`:

```sql
SELECT 'qqbot_plugin_task' AS table_name, COUNT(*) AS row_count FROM qqbot_plugin_task;
SELECT 'qqbot_plugin_task_run' AS table_name, COUNT(*) AS row_count FROM qqbot_plugin_task_run;
```

- [ ] **Step 5: Add task controller with Vben wrappers**

Add `plugin-platform-task.controller.ts`:

```ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { vbenSuccess } from '@/common';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/jwt-auth.guard';
import { QqbotPluginTaskService } from '../application/task';

@ApiTags('QQBot - 插件定时任务')
@Controller('qqbot/plugin-platform/tasks')
@UseGuards(JwtAuthGuard)
export class QqbotPluginPlatformTaskController {
  constructor(private readonly service: QqbotPluginTaskService) {}

  @Get('page')
  @ApiOperation({ summary: '插件定时任务分页' })
  async page(@Query() query: Record<string, unknown>) {
    return vbenSuccess(await this.service.pageTasks(query));
  }

  @Get(':id')
  @ApiOperation({ summary: '插件定时任务详情' })
  async detail(@Param('id') id: string) {
    return vbenSuccess(await this.service.getTaskDetail(id));
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '启用插件定时任务' })
  async enable(@Param('id') id: string) {
    return vbenSuccess(await this.service.enableTask(id));
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '停用插件定时任务' })
  async disable(@Param('id') id: string) {
    return vbenSuccess(await this.service.disableTask(id));
  }

  @Post(':id/cron')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '更新插件定时任务 cron' })
  async updateCron(
    @Param('id') id: string,
    @Body() body: { cronExpression?: string },
  ) {
    return vbenSuccess(await this.service.updateTaskCron(id, body));
  }

  @Post(':id/run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '手动运行插件定时任务' })
  async run(@Param('id') id: string, @Body() body: { input?: Record<string, unknown> }) {
    return vbenSuccess(await this.service.runTaskOnce(id, body));
  }

  @Get(':id/runs')
  @ApiOperation({ summary: '插件定时任务运行记录分页' })
  async runs(@Param('id') id: string, @Query() query: Record<string, unknown>) {
    return vbenSuccess(await this.service.pageTaskRuns(id, query));
  }
}
```

- [ ] **Step 6: Implement minimal service/synchronizer for route tests**

Create service methods with repository-backed pagination and clear errors. The initial implementation can call scheduler placeholders injected in Task 3; keep public method names stable.

```ts
@Injectable()
export class QqbotPluginTaskService {
  constructor(
    @InjectRepository(QqbotPluginTask)
    private readonly taskRepository: Repository<QqbotPluginTask>,
    @InjectRepository(QqbotPluginTaskRun)
    private readonly runRepository: Repository<QqbotPluginTaskRun>,
  ) {}

  async pageTasks(query: QqbotPluginTaskPageQuery) {
    const pageNo = Math.max(1, Number(query.pageNo || 1));
    const pageSize = Math.max(1, Number(query.pageSize || 10));
    const [list, total] = await this.taskRepository.findAndCount({
      order: { createTime: 'DESC' },
      skip: (pageNo - 1) * pageSize,
      take: pageSize,
    });
    return { list, pageNo, pageSize, total };
  }

  async getTaskDetail(id: string) {
    const task = await this.taskRepository.findOne({ where: { id } });
    if (!task) throwVbenError('插件定时任务不存在');
    return task;
  }

  async enableTask(id: string) {
    await this.taskRepository.update({ id }, { enabled: true, runtimeStatus: 'scheduled' });
    return this.getTaskDetail(id);
  }

  async disableTask(id: string) {
    await this.taskRepository.update({ id }, { enabled: false, runtimeStatus: 'disabled' });
    return this.getTaskDetail(id);
  }

  async updateTaskCron(id: string, body: { cronExpression?: string }) {
    const cronExpression = requireQqbotPluginTaskCron(body.cronExpression);
    await this.taskRepository.update({ id }, { cronExpression });
    return this.getTaskDetail(id);
  }

  async runTaskOnce(id: string, body: { input?: Record<string, unknown> }) {
    void body;
    const task = await this.getTaskDetail(id);
    return this.runRepository.save({
      installationId: task.installationId,
      pluginId: task.pluginId,
      status: 'running',
      taskId: task.id,
      taskKey: task.taskKey,
      triggerType: 'manual',
    });
  }

  async pageTaskRuns(id: string, query: QqbotPluginTaskRunPageQuery) {
    const pageNo = Math.max(1, Number(query.pageNo || 1));
    const pageSize = Math.max(1, Number(query.pageSize || 10));
    const [list, total] = await this.runRepository.findAndCount({
      order: { createTime: 'DESC' },
      skip: (pageNo - 1) * pageSize,
      take: pageSize,
      where: { taskId: id },
    });
    return { list, pageNo, pageSize, total };
  }
}
```

- [ ] **Step 7: Register controller/entities/services**

Modify `plugin-platform.module.ts`:

```ts
controllers: [
  QqbotPluginController,
  QqbotPluginPlatformController,
  QqbotPluginPlatformTaskController,
],
providers: [
  QqbotPluginTaskManifestSynchronizer,
  QqbotPluginTaskService,
  ...
],
```

- [ ] **Step 8: Run GREEN persistence/API tests**

Run:

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/plugin-platform/persistence-contract.spec.ts test/modules/qqbot/plugin-platform/plugin-task-persistence.spec.ts test/modules/qqbot/plugin-platform/plugin-platform-api-contract.spec.ts test/modules/qqbot/plugin-platform/plugin-task-api-contract.spec.ts
```

Expected: PASS.

- [ ] **Step 9: Commit persistence/API contract**

Run:

```powershell
git add src/modules/qqbot/plugin-platform sql/refactor-v3 test/modules/qqbot/plugin-platform
git commit -m "feat: 增加QQBot插件定时任务持久化接口"
```

## Task 3: BullMQ Scheduler Bridge And Worker `executeTask`

**Files:**
- Create: `src/modules/qqbot/plugin-platform/application/task/qqbot-plugin-task-scheduler.service.ts`
- Create: `src/modules/qqbot/plugin-platform/application/task/qqbot-plugin-task-worker.processor.ts`
- Modify: `src/modules/qqbot/plugin-platform/application/task/qqbot-plugin-task.service.ts`
- Modify: `src/modules/qqbot/plugin-platform/application/task/index.ts`
- Modify: `src/modules/qqbot/plugin-platform/plugin-platform.module.ts`
- Modify: `src/modules/qqbot/plugin-platform/application/plugin-platform.service.ts`
- Modify: `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/worker-runtime.types.ts`
- Modify: `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/worker-runtime.ts`
- Modify: `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/builtin-plugin-worker.thread.ts`
- Create: `test/modules/qqbot/plugin-platform/plugin-task-scheduler.spec.ts`
- Modify: `test/modules/qqbot/plugin-platform/worker-runtime.spec.ts`

- [ ] **Step 1: Write RED runtime test for `executeTask`**

Append to `worker-runtime.spec.ts`:

```ts
it('sends executeTask RPC with safe input summary and timeout', async () => {
  const { driver, runtime } = createRuntime();
  driver.responses.set('executeTask', { syncedKeys: ['songs'] });

  await expect(
    runtime.executeTask({
      input: { fullPayload: 'secret', force: true },
      taskHandlerName: 'syncBestdoriMainData',
      taskId: 'task-1',
      taskKey: 'bangdream.bestdori.sync-main-data',
      timeoutMs: 120000,
      triggerType: 'manual',
    }),
  ).resolves.toEqual({ syncedKeys: ['songs'] });

  expect(driver.requests[0]).toMatchObject({
    safeInputSummary: { fieldCount: 2, keys: ['force', 'fullPayload'] },
    taskHandlerName: 'syncBestdoriMainData',
    taskId: 'task-1',
    taskKey: 'bangdream.bestdori.sync-main-data',
    timeoutMs: 120000,
    triggerType: 'manual',
    type: 'executeTask',
  });
  expect(JSON.stringify(driver.requests[0].safeInputSummary)).not.toContain('secret');
});
```

Run:

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/plugin-platform/worker-runtime.spec.ts -t executeTask
```

Expected: FAIL because `executeTask` does not exist.

- [ ] **Step 2: Implement runtime `executeTask`**

In `worker-runtime.types.ts`, add request type and DTO:

```ts
export type QqbotPluginWorkerRequestType =
  | 'activate'
  | 'deactivate'
  | 'dispose'
  | 'executeOperation'
  | 'executeTask'
  | 'handleEvent'
  | 'health'
  | 'load';

export type QqbotPluginTaskRequest = {
  input: Record<string, unknown>;
  taskHandlerName: string;
  taskId: string;
  taskKey: string;
  timeoutMs?: number;
  triggerType: 'bootstrap' | 'manual' | 'schedule';
};
```

Add optional request fields:

```ts
taskHandlerName?: string;
taskId?: string;
taskKey?: string;
triggerType?: 'bootstrap' | 'manual' | 'schedule';
```

In `worker-runtime.ts`, add:

```ts
async executeTask(request: QqbotPluginTaskRequest) {
  return this.request(
    'executeTask',
    {
      input: request.input,
      safeInputSummary: summarizeInput(request.input),
      taskHandlerName: request.taskHandlerName,
      taskId: request.taskId,
      taskKey: request.taskKey,
      triggerType: request.triggerType,
    },
    request.timeoutMs,
  );
}
```

In `QqbotPluginRuntimeFactory` pick list inside `plugin-platform.service.ts`, add `'executeTask'`.

- [ ] **Step 3: Implement worker thread task dispatch**

In `builtin-plugin-worker.thread.ts`, extend plugin type:

```ts
type RuntimeCommandPlugin = QqbotIntegrationPlugin & {
  activate?: () => Promise<unknown> | unknown;
  dispose?: () => Promise<unknown> | unknown;
  tasks?: Array<{
    execute(input: Record<string, unknown>): Promise<Record<string, unknown>> | Record<string, unknown>;
    handlerName: string;
    key: string;
  }>;
};
```

Add switch case:

```ts
case 'executeTask':
  return executeTask(message);
```

Add function:

```ts
async function executeTask(message: QqbotPluginWorkerRequest) {
  const task = commandPlugin?.tasks?.find(
    (item) =>
      item.key === message.taskKey ||
      item.handlerName === message.taskHandlerName,
  );
  if (!task) {
    throw new Error(`QQBot 插件定时任务不存在：${message.taskKey}`);
  }
  return task.execute((message.input || {}) as Record<string, unknown>);
}
```

- [ ] **Step 4: Run GREEN runtime test**

Run:

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/plugin-platform/worker-runtime.spec.ts -t executeTask
```

Expected: PASS.

- [ ] **Step 5: Write RED scheduler tests**

Add `plugin-task-scheduler.spec.ts`:

```ts
const createdQueues: any[] = [];
const createdWorkers: any[] = [];

jest.mock('bullmq', () => ({
  Queue: class MockQueue {
    readonly schedulers = new Map<string, unknown>();
    constructor(public name: string, public options: unknown) {
      createdQueues.push(this);
    }
    async add(name: string, data: unknown, opts?: unknown) {
      return { data, id: `${name}-job`, name, opts };
    }
    async close() {}
    async removeJobScheduler(id: string) {
      this.schedulers.delete(id);
      return 1;
    }
    async upsertJobScheduler(id: string, repeat: unknown, template: unknown) {
      this.schedulers.set(id, { repeat, template });
      return { id };
    }
    async waitUntilReady() {}
  },
  Worker: class MockWorker {
    constructor(public name: string, public processor: Function, public options: unknown) {
      createdWorkers.push(this);
    }
    on() { return this; }
    async close() {}
    async waitUntilReady() {}
  },
}));

import { QqbotPluginTaskSchedulerService } from '../../../../src/modules/qqbot/plugin-platform/application/task';

describe('QQBot plugin task scheduler', () => {
  beforeEach(() => {
    createdQueues.length = 0;
    createdWorkers.length = 0;
  });

  it('registers cron through BullMQ Job Scheduler with a stable scheduler id', async () => {
    const scheduler = new QqbotPluginTaskSchedulerService(
      createConfigService(),
      createTaskRepository([{ id: 'task-1', cronExpression: '0 */6 * * *', enabled: true }]),
    } as any);

    await scheduler.syncTaskScheduler({
      cronExpression: '0 */6 * * *',
      enabled: true,
      id: 'task-1',
      installationId: 'install-1',
      taskKey: 'bangdream.bestdori.sync-main-data',
      timeoutMs: 120000,
    } as any);

    expect(createdQueues[0].schedulers.get('plugin-task:task-1')).toMatchObject({
      repeat: { pattern: '0 */6 * * *' },
      template: {
        data: { taskId: 'task-1', triggerType: 'schedule' },
        name: 'execute-plugin-task',
      },
    });
  });
});
```

Use helpers in the same file:

```ts
function createConfigService() {
  return {
    get: (key: string) =>
      ({
        QQBOT_PLUGIN_QUEUE_REDIS_HOST: 'redis.local',
        QQBOT_PLUGIN_TASK_QUEUE_PREFIX: 'kt:qqbot:plugin-task',
      })[key],
  };
}

function createTaskRepository(tasks: any[]) {
  return {
    find: jest.fn(async () => tasks),
    findOne: jest.fn(async ({ where }: any) =>
      tasks.find((task) => task.id === where.id) || null,
    ),
    update: jest.fn(async () => ({ affected: 1 })),
  };
}
```

Run:

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/plugin-platform/plugin-task-scheduler.spec.ts
```

Expected: FAIL because scheduler service does not exist.

- [ ] **Step 6: Implement scheduler bridge**

Create `QqbotPluginTaskSchedulerService` using BullMQ `Queue.upsertJobScheduler`.

```ts
@Injectable()
export class QqbotPluginTaskSchedulerService implements OnModuleDestroy, OnModuleInit {
  private readonly queue: Queue;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(QqbotPluginTask)
    private readonly taskRepository: Repository<QqbotPluginTask>,
  ) {
    this.queue = new Queue('qqbot-plugin-task', {
      connection: resolveQqbotPluginQueueConnection(configService),
      prefix: readTaskQueuePrefix(configService),
    });
  }

  async onModuleInit() {
    await this.resyncEnabledTasks();
  }

  async onModuleDestroy() {
    await this.queue.close();
  }

  async resyncEnabledTasks() {
    const tasks = await this.taskRepository.find({ where: { enabled: true } });
    for (const task of tasks) {
      await this.syncTaskScheduler(task);
    }
  }

  async syncTaskScheduler(task: Pick<QqbotPluginTask, 'cronExpression' | 'enabled' | 'id' | 'installationId' | 'taskKey' | 'timeoutMs'>) {
    const schedulerId = this.buildSchedulerId(task.id);
    if (!task.enabled) {
      await this.queue.removeJobScheduler(schedulerId);
      await this.taskRepository.update({ id: task.id }, { nextRunAt: null, runtimeStatus: 'disabled' });
      return;
    }
    await this.queue.upsertJobScheduler(
      schedulerId,
      { pattern: task.cronExpression },
      {
        data: {
          taskId: task.id,
          triggerType: 'schedule',
        },
        name: 'execute-plugin-task',
        opts: {
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: 100,
        },
      },
    );
    await this.taskRepository.update({ id: task.id }, { runtimeStatus: 'scheduled' });
  }

  async removeTaskScheduler(taskId: string) {
    await this.queue.removeJobScheduler(this.buildSchedulerId(taskId));
  }

  async enqueueManualRun(taskId: string, input: Record<string, unknown>) {
    return this.queue.add('execute-plugin-task', {
      input,
      taskId,
      triggerType: 'manual',
    });
  }

  private buildSchedulerId(taskId: string) {
    return `plugin-task:${taskId}`;
  }
}
```

- [ ] **Step 7: Implement task worker processor**

Create processor with one-running-run guard:

```ts
@Injectable()
export class QqbotPluginTaskWorkerProcessor implements OnModuleDestroy, OnModuleInit {
  private worker?: Worker;

  constructor(
    private readonly configService: ConfigService,
    private readonly platformService: QqbotPluginPlatformService,
    @InjectRepository(QqbotPluginTask)
    private readonly taskRepository: Repository<QqbotPluginTask>,
    @InjectRepository(QqbotPluginTaskRun)
    private readonly runRepository: Repository<QqbotPluginTaskRun>,
  ) {}

  async onModuleInit() {
    this.worker = new Worker(
      'qqbot-plugin-task',
      async (job) => this.processJob(job),
      {
        concurrency: 1,
        connection: resolveQqbotPluginQueueConnection(this.configService),
        prefix: readTaskQueuePrefix(this.configService),
      },
    );
    this.worker.on('error', (error) => Logger.error(error.message, error.stack, QqbotPluginTaskWorkerProcessor.name));
    await this.worker.waitUntilReady();
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async processJob(job: Job<{ input?: Record<string, unknown>; taskId: string; triggerType: QqbotPluginTaskTriggerType }>) {
    const task = await this.taskRepository.findOne({ where: { id: job.data.taskId } });
    if (!task) return { skipped: true, reason: 'task-not-found' };
    if (job.data.triggerType === 'schedule' && !task.enabled) {
      return this.writeSkippedRun(task, job.id, job.data.triggerType, 'task-disabled');
    }
    const running = await this.runRepository.findOne({
      where: { status: 'running', taskId: task.id },
    });
    if (running) {
      return this.writeSkippedRun(task, job.id, job.data.triggerType, 'previous-run-running');
    }
    return this.executeTaskRun(task, `${job.id || ''}`, job.data.triggerType, job.data.input || {});
  }
}
```

`executeTaskRun()` must:

- create a `running` run row with `startedAt`;
- update task `runtimeStatus='running'`;
- call `platformService.executeTask({ input, taskId, taskKey, taskHandlerName, timeoutMs, triggerType, pluginId, installationId })`;
- store success safe summary with output keys only;
- store failed error message without external response bodies;
- update `lastRunId`, `lastRunAt`, `lastStatus`, `lastError`, `lastDurationMs`, `runtimeStatus`.

- [ ] **Step 8: Wire scheduler into service mutations**

Change `QqbotPluginTaskService` constructor to inject scheduler. Update:

```ts
async enableTask(id: string) {
  const task = await this.getTaskDetail(id);
  task.enabled = true;
  task.runtimeStatus = 'scheduled';
  const saved = await this.taskRepository.save(task);
  await this.scheduler.syncTaskScheduler(saved);
  return saved;
}

async disableTask(id: string) {
  const task = await this.getTaskDetail(id);
  task.enabled = false;
  task.runtimeStatus = 'disabled';
  const saved = await this.taskRepository.save(task);
  await this.scheduler.removeTaskScheduler(id);
  return saved;
}

async updateTaskCron(id: string, body: { cronExpression?: string }) {
  const task = await this.getTaskDetail(id);
  task.cronExpression = requireQqbotPluginTaskCron(body.cronExpression);
  const saved = await this.taskRepository.save(task);
  await this.scheduler.syncTaskScheduler(saved);
  return saved;
}

async runTaskOnce(id: string, body: { input?: Record<string, unknown> }) {
  await this.getTaskDetail(id);
  const job = await this.scheduler.enqueueManualRun(id, body.input || {});
  return { jobId: `${job.id || ''}`, taskId: id };
}
```

- [ ] **Step 9: Add platform `executeTask` method and manifest sync calls**

Add to `QqbotPluginPlatformService`:

```ts
async executeTask(input: {
  input: Record<string, unknown>;
  installationId: string;
  taskHandlerName: string;
  taskId: string;
  taskKey: string;
  timeoutMs: number;
  triggerType: QqbotPluginTaskTriggerType;
}) {
  const workerContext = this.activeWorkerContexts.get(input.installationId);
  if (!workerContext) {
    throwVbenError('插件运行时未启用');
  }
  try {
    return await workerContext.worker.executeTask({
      input: input.input,
      taskHandlerName: input.taskHandlerName,
      taskId: input.taskId,
      taskKey: input.taskKey,
      timeoutMs: input.timeoutMs,
      triggerType: input.triggerType,
    });
  } finally {
    await this.flushWorkerRuntimeEvents(workerContext);
  }
}
```

Inject `QqbotPluginTaskManifestSynchronizer` and `QqbotPluginTaskSchedulerService`. Call synchronizer after `persistManifestCapabilities`, `registerActiveWorker`, `enableInstallation`, `upgradeInstallation`, and builtin bootstrap. On disable/uninstall, remove schedulers for that installation.

- [ ] **Step 10: Run GREEN scheduler/runtime tests**

Run:

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/plugin-platform/worker-runtime.spec.ts test/modules/qqbot/plugin-platform/plugin-task-scheduler.spec.ts test/modules/qqbot/plugin-platform/plugin-lifecycle-runtime.spec.ts
```

Expected: PASS.

- [ ] **Step 11: Commit scheduler/runtime bridge**

Run:

```powershell
git add src/modules/qqbot/plugin-platform test/modules/qqbot/plugin-platform
git commit -m "feat: 接入QQBot插件定时任务调度桥"
```

## Task 4: BangDream Bestdori Main-Data Sync Task

**Files:**
- Modify: `src/modules/qqbot/plugins/bangdream/plugin.json`
- Modify: `src/modules/qqbot/plugins/bangdream/src/index.ts`
- Create: `src/modules/qqbot/plugins/bangdream/src/application/tasks/bestdori-main-data-sync.task.ts`
- Create: `src/modules/qqbot/plugins/bangdream/src/application/tasks/index.ts`
- Modify: `src/modules/qqbot/plugins/bangdream/src/application/catalog/bangdream-catalog-cache.ts`
- Modify: `src/modules/qqbot/plugins/bangdream/src/infrastructure/integration/runtime-io.ts`
- Create: `test/modules/qqbot/plugins/bangdream/bestdori-main-data-sync.task.spec.ts`

- [ ] **Step 1: Write RED BangDream sync test**

Add test:

```ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createBestdoriMainDataSyncTask,
  BANGDREAM_BESTDORI_MAIN_DATA_KEYS,
} from '../../../../../src/modules/qqbot/plugins/bangdream/src/application/tasks';
import { configureBangDreamRuntimeIo } from '../../../../../src/modules/qqbot/plugins/bangdream/src/infrastructure/integration/runtime-io';

describe('BangDream Bestdori main-data sync task', () => {
  const cacheRoot = mkdtempSync(join(tmpdir(), 'bangdream-sync-'));

  afterEach(() => {
    rmSync(cacheRoot, { force: true, recursive: true });
  });

  it('downloads main JSON data, writes cache atomically, and returns safe summary', async () => {
    const requestedUrls: string[] = [];
    configureBangDreamRuntimeIo({
      getConfig: (key) =>
        key === 'BANGDREAM_TSUGU_CACHE_ROOT' ? cacheRoot : undefined,
      requestJson: async (url) => {
        requestedUrls.push(`${url}`);
        return { body: { ok: true, url } };
      },
    });

    const task = createBestdoriMainDataSyncTask();
    const output = await task.execute({ keys: ['songs', 'meta'] });

    expect(output).toMatchObject({
      failedCount: 0,
      successCount: 2,
      syncedKeys: ['songs', 'meta'],
    });
    expect(readFileSync(join(cacheRoot, 'bestdori', 'songs.json'), 'utf8')).toContain('"ok":true');
    expect(readFileSync(join(cacheRoot, 'bestdori', 'meta.json'), 'utf8')).toContain('"ok":true');
    expect(requestedUrls).toHaveLength(2);
  });

  it('keeps existing cache file when one key fails', async () => {
    configureBangDreamRuntimeIo({
      getConfig: (key) =>
        key === 'BANGDREAM_TSUGU_CACHE_ROOT' ? cacheRoot : undefined,
      requestJson: async (url) => {
        if (`${url}`.includes('/api/songs/meta/')) throw new Error('network failed');
        return { body: { ok: true } };
      },
    });

    const task = createBestdoriMainDataSyncTask();
    await expect(task.execute({ keys: ['songs', 'meta'] })).rejects.toThrow(
      'BangDream Bestdori 主数据同步失败',
    );
    expect(BANGDREAM_BESTDORI_MAIN_DATA_KEYS).toEqual(
      expect.arrayContaining(['songs', 'meta', 'cards', 'skills', 'events']),
    );
  });
});
```

Run:

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/plugins/bangdream/bestdori-main-data-sync.task.spec.ts
```

Expected: FAIL because task module does not exist.

- [ ] **Step 2: Implement BangDream task module**

Create `bestdori-main-data-sync.task.ts`:

```ts
import { dirname, join } from 'node:path';
import {
  bestdoriApiPath,
  bestdoriUrl,
} from '../../config/runtime-config';
import { BANGDREAM_TSUGU_ENV_KEYS } from '../../config/runtime-options';
import {
  readBangDreamRuntimeConfig,
  requestBangDreamJson,
  writeBangDreamJsonFileAtomic,
} from '../../infrastructure/integration/runtime-io';
import { refreshBangDreamCatalogFromCache } from '../catalog/bangdream-catalog-cache';

export const BANGDREAM_BESTDORI_MAIN_DATA_KEYS = [
  'songs',
  'meta',
  'cards',
  'skills',
  'events',
  'gacha',
  'costumes',
  'bands',
  'characters',
  'areaItems',
] as const;

type MainDataKey = (typeof BANGDREAM_BESTDORI_MAIN_DATA_KEYS)[number];

export function createBestdoriMainDataSyncTask() {
  return {
    handlerName: 'syncBestdoriMainData',
    key: 'bangdream.bestdori.sync-main-data',
    execute: syncBestdoriMainData,
  };
}

async function syncBestdoriMainData(input: Record<string, unknown>) {
  const startedAt = Date.now();
  const keys = normalizeKeys(input.keys);
  const cacheRoot = resolveCacheRoot();
  const failures: Array<{ key: string; message: string }> = [];
  const syncedKeys: string[] = [];

  for (const key of keys) {
    try {
      const path = bestdoriApiPath[key];
      const url = new URL(path, bestdoriUrl).toString();
      const response = await requestBangDreamJson(url, { timeoutMs: 30000 });
      await writeBangDreamJsonFileAtomic(resolveCachePath(cacheRoot, key), response.body);
      syncedKeys.push(key);
    } catch (error) {
      failures.push({
        key,
        message: error instanceof Error ? error.message : `${error}`,
      });
    }
  }

  if (syncedKeys.length > 0) {
    await refreshBangDreamCatalogFromCache(syncedKeys as MainDataKey[]);
  }
  if (failures.length > 0) {
    throw new Error(
      `BangDream Bestdori 主数据同步失败：${failures
        .map((failure) => `${failure.key}:${failure.message}`)
        .join('; ')}`,
    );
  }

  return {
    cacheRootConfigured: Boolean(readBangDreamRuntimeConfig(BANGDREAM_TSUGU_ENV_KEYS.cacheRoot)),
    durationMs: Date.now() - startedAt,
    failedCount: failures.length,
    successCount: syncedKeys.length,
    syncedKeys,
  };
}

function normalizeKeys(input: unknown): MainDataKey[] {
  const requested = Array.isArray(input) ? input : BANGDREAM_BESTDORI_MAIN_DATA_KEYS;
  const allowed = new Set<string>(BANGDREAM_BESTDORI_MAIN_DATA_KEYS);
  return [...new Set(requested.filter((key): key is MainDataKey => typeof key === 'string' && allowed.has(key)))];
}

function resolveCacheRoot() {
  return (
    readBangDreamRuntimeConfig(BANGDREAM_TSUGU_ENV_KEYS.cacheRoot) ||
    join(process.cwd(), '.kt-workspace', 'cache', 'bangdream')
  );
}

function resolveCachePath(cacheRoot: string, key: MainDataKey) {
  return join(cacheRoot, 'bestdori', `${key}.json`);
}
```

- [ ] **Step 3: Add atomic write IO**

In `runtime-io.ts`, add:

```ts
export async function writeBangDreamJsonFileAtomic(filePath: string, data: unknown) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeBangDreamJsonFile(tempPath, data);
  await runtimeIo.renameFile?.(tempPath, filePath);
}
```

Extend `BangDreamRuntimeIo`:

```ts
renameFile?: (from: string, to: string) => Promise<void>;
```

In `builtin-plugin-worker.thread.ts` `createBangDreamRuntimeIo()`, provide mkdir/rename through host-safe local worker fs:

```ts
renameFile: async (from, to) => {
  mkdirSync(dirname(to), { recursive: true });
  renameSync(from, to);
},
writeJsonFile: async (filePath, data) => {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data));
},
```

Use Node fs only inside worker thread runtime boundary, not inside Nest services.

- [ ] **Step 4: Refresh catalog from synced cache**

In `bangdream-catalog-cache.ts`, export:

```ts
export async function refreshBangDreamCatalogFromCache(
  keys?: readonly BangDreamCatalogKey[],
) {
  const catalogKeys = normalizeCatalogKeys(keys);
  for (const key of catalogKeys) {
    bangdreamCatalogCache[key] = {};
  }
  await loadCatalogData(catalogKeys, true);
}
```

- [ ] **Step 5: Expose task from plugin entry and manifest**

In `plugin.json`, add:

```json
"tasks": [
  {
    "key": "bangdream.bestdori.sync-main-data",
    "name": "同步 Bestdori 主数据",
    "handlerName": "syncBestdoriMainData",
    "description": "同步 BangDream 重命令依赖的 Bestdori JSON 主数据。",
    "defaultCron": "0 */6 * * *",
    "enabled": true,
    "timeoutMs": 120000,
    "permissions": ["runtime.http", "plugin.storage.read", "plugin.storage.write"]
  }
]
```

In `src/index.ts`:

```ts
import { createBestdoriMainDataSyncTask } from './application/tasks';

const tasks = [createBestdoriMainDataSyncTask()];

return {
  ...existingPluginFields,
  tasks,
};
```

- [ ] **Step 6: Run GREEN BangDream tests and manifest tests**

Run:

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/plugins/bangdream/bestdori-main-data-sync.task.spec.ts test/modules/qqbot/plugin-platform/plugin-task-manifest.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit BangDream task**

Run:

```powershell
git add src/modules/qqbot/plugins/bangdream test/modules/qqbot/plugins/bangdream
git commit -m "feat: 增加BangDream主数据同步任务"
```

## Task 5: Admin Task Caller, Cron Component, And Page

**Files:**
- Modify: `D:\MyFiles\KT\Vue\kt-template-admin\pnpm-workspace.yaml`
- Modify: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\package.json`
- Modify: `D:\MyFiles\KT\Vue\kt-template-admin\pnpm-lock.yaml`
- Create: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\api\qqbot\plugin-task.ts`
- Create: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\api\qqbot\plugin-task.spec.ts`
- Modify: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\router\routes\modules\qqbot.ts`
- Create: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\views\qqbot\plugin-task\list.tsx`
- Create: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\views\qqbot\plugin-task\components\CronEditorAntdvNext.tsx`
- Create: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\views\qqbot\plugin-task\components\TaskCronModal.tsx`
- Create: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\views\qqbot\plugin-task\components\TaskRunDrawer.tsx`
- Create: `D:\MyFiles\KT\Vue\kt-template-admin\apps\web-antdv-next\src\views\qqbot\plugin-task\plugin-task.spec.tsx`

- [ ] **Step 1: Add dependency**

Run:

```powershell
pnpm add @vue-js-cron/core --filter @vben/web-antdv-next
```

Expected: `apps/web-antdv-next/package.json` includes `@vue-js-cron/core`; lockfile updates. If workspace catalog is used for all external frontend dependencies, move the version into `pnpm-workspace.yaml` catalog and keep app dependency as `catalog:`.

- [ ] **Step 2: Write RED caller test**

Create `plugin-task.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestClient } from '#/api/request';
import {
  disableQqbotPluginTask,
  enableQqbotPluginTask,
  getQqbotPluginTaskPage,
  getQqbotPluginTaskRunPage,
  runQqbotPluginTaskOnce,
  updateQqbotPluginTaskCron,
} from './plugin-task';

vi.mock('#/api/request', () => ({
  requestClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

describe('qqbot plugin task API wrappers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses plugin-platform task endpoints', async () => {
    vi.mocked(requestClient.get).mockResolvedValue({ list: [], total: 0 });
    vi.mocked(requestClient.post).mockResolvedValue({});

    await getQqbotPluginTaskPage({ enabled: true, pageNo: 1, pageSize: 10, taskKey: 'bangdream.bestdori.sync-main-data' });
    await enableQqbotPluginTask('task-1');
    await disableQqbotPluginTask('task-1');
    await updateQqbotPluginTaskCron('task-1', '0 */6 * * *');
    await runQqbotPluginTaskOnce('task-1', { force: true });
    await getQqbotPluginTaskRunPage('task-1', { pageNo: 1, pageSize: 20 });

    expect(requestClient.get).toHaveBeenCalledWith('/qqbot/plugin-platform/tasks/page', {
      params: { enabled: true, pageNo: 1, pageSize: 10, taskKey: 'bangdream.bestdori.sync-main-data' },
    });
    expect(requestClient.post).toHaveBeenCalledWith('/qqbot/plugin-platform/tasks/task-1/enable');
    expect(requestClient.post).toHaveBeenCalledWith('/qqbot/plugin-platform/tasks/task-1/disable');
    expect(requestClient.post).toHaveBeenCalledWith('/qqbot/plugin-platform/tasks/task-1/cron', {
      cronExpression: '0 */6 * * *',
    });
    expect(requestClient.post).toHaveBeenCalledWith('/qqbot/plugin-platform/tasks/task-1/run', {
      input: { force: true },
    });
    expect(requestClient.get).toHaveBeenCalledWith('/qqbot/plugin-platform/tasks/task-1/runs', {
      params: { pageNo: 1, pageSize: 20 },
    });
  });
});
```

Run:

```powershell
pnpm -F @vben/web-antdv-next exec vitest run apps/web-antdv-next/src/api/qqbot/plugin-task.spec.ts
```

Expected: FAIL because caller does not exist.

- [ ] **Step 3: Implement Admin caller**

Create `plugin-task.ts`:

```ts
import type { Recordable } from '@vben/types';
import { requestClient } from '#/api/request';
import type { QqbotApi } from './index';

export namespace QqbotPluginTaskApi {
  export type RuntimeStatus = 'disabled' | 'failed' | 'idle' | 'running' | 'scheduled';
  export type RunStatus = 'failed' | 'running' | 'skipped' | 'success';
  export type TriggerType = 'bootstrap' | 'manual' | 'schedule';

  export interface Task {
    cronExpression: string;
    defaultCron: string;
    description?: null | string;
    enabled: boolean;
    id: string;
    installationId: string;
    lastDurationMs?: null | number;
    lastError?: null | string;
    lastRunAt?: null | string;
    lastStatus?: null | RunStatus;
    nextRunAt?: null | string;
    pluginId: string;
    pluginKey?: string;
    pluginName?: string;
    runtimeStatus: RuntimeStatus;
    taskKey: string;
    taskName: string;
  }

  export interface TaskRun {
    createTime?: string;
    durationMs?: null | number;
    errorMessage?: null | string;
    finishedAt?: null | string;
    id: string;
    jobId?: null | string;
    safeSummary?: null | Recordable<any>;
    startedAt?: null | string;
    status: RunStatus;
    taskId: string;
    taskKey: string;
    triggerType: TriggerType;
  }

  export interface TaskQuery extends Recordable<any> {
    enabled?: boolean;
    pageNo?: number;
    pageSize?: number;
    pluginId?: string;
    pluginKey?: string;
    status?: RuntimeStatus;
    taskKey?: string;
  }

  export interface TaskRunQuery extends Recordable<any> {
    pageNo?: number;
    pageSize?: number;
    status?: RunStatus;
    triggerType?: TriggerType;
  }
}

export function getQqbotPluginTaskPage(params: QqbotPluginTaskApi.TaskQuery) {
  return requestClient.get<QqbotApi.PageResult<QqbotPluginTaskApi.Task>>(
    '/qqbot/plugin-platform/tasks/page',
    { params },
  );
}

export function enableQqbotPluginTask(id: string) {
  return requestClient.post<QqbotPluginTaskApi.Task>(`/qqbot/plugin-platform/tasks/${id}/enable`);
}

export function disableQqbotPluginTask(id: string) {
  return requestClient.post<QqbotPluginTaskApi.Task>(`/qqbot/plugin-platform/tasks/${id}/disable`);
}

export function updateQqbotPluginTaskCron(id: string, cronExpression: string) {
  return requestClient.post<QqbotPluginTaskApi.Task>(`/qqbot/plugin-platform/tasks/${id}/cron`, {
    cronExpression,
  });
}

export function runQqbotPluginTaskOnce(id: string, input: Recordable<any> = {}) {
  return requestClient.post<{ jobId: string; taskId: string }>(`/qqbot/plugin-platform/tasks/${id}/run`, {
    input,
  });
}

export function getQqbotPluginTaskRunPage(id: string, params: QqbotPluginTaskApi.TaskRunQuery) {
  return requestClient.get<QqbotApi.PageResult<QqbotPluginTaskApi.TaskRun>>(
    `/qqbot/plugin-platform/tasks/${id}/runs`,
    { params },
  );
}
```

- [ ] **Step 4: Add route**

In `router/routes/modules/qqbot.ts`, add under plugin platform:

```ts
{
  component: () => import('#/views/qqbot/plugin-task/list'),
  meta: {
    icon: 'lucide:calendar-clock',
    title: '插件定时任务',
  },
  name: 'QqBotPluginTask',
  path: '/qqbot/plugin-task',
},
```

- [ ] **Step 5: Build Cron editor thin adapter**

Create `CronEditorAntdvNext.tsx` with antdv-next controls and `@vue-js-cron/core` state. Keep output to five-field cron.

```tsx
import { defineComponent, ref, watch } from 'vue';
import { Alert, Input, Radio, Space } from 'antdv-next';
import { parseCronExpression } from '@vue-js-cron/core';

export default defineComponent({
  name: 'CronEditorAntdvNext',
  props: {
    value: { default: '0 */6 * * *', type: String },
  },
  emits: ['update:value', 'validChange'],
  setup(props, { emit }) {
    const expression = ref(props.value);
    const error = ref('');

    function validate(value: string) {
      const fields = value.trim().split(/\s+/);
      if (fields.length !== 5) {
        error.value = '请输入 5 段 cron 表达式';
        emit('validChange', false);
        return;
      }
      try {
        parseCronExpression(value);
        error.value = '';
        emit('validChange', true);
      } catch {
        error.value = 'cron 表达式不合法';
        emit('validChange', false);
      }
    }

    watch(
      () => props.value,
      (value) => {
        expression.value = value;
        validate(value);
      },
      { immediate: true },
    );

    return () => (
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Radio.Group
          buttonStyle="solid"
          value={expression.value}
          onChange={(event: any) => {
            expression.value = event.target.value;
            emit('update:value', expression.value);
            validate(expression.value);
          }}
        >
          <Radio.Button value="0 */6 * * *">每 6 小时</Radio.Button>
          <Radio.Button value="0 3 * * *">每天 03:00</Radio.Button>
          <Radio.Button value="0 3 * * 1">每周一 03:00</Radio.Button>
        </Radio.Group>
        <Input
          value={expression.value}
          onChange={(event: any) => {
            expression.value = event.target.value;
            emit('update:value', expression.value);
            validate(expression.value);
          }}
        />
        {error.value ? <Alert message={error.value} showIcon type="error" /> : null}
      </Space>
    );
  },
});
```

If `@vue-js-cron/core` exposes a different exported function in the installed version, use its documented validation primitive and keep this component API unchanged.

- [ ] **Step 6: Build page and drawers**

`list.tsx` must use `KtTable` with task pagination and row actions:

```tsx
const columns: Array<TableColumnType<QqbotPluginTaskApi.Task>> = [
  { dataIndex: 'pluginName', key: 'pluginName', title: '插件', width: 160 },
  { dataIndex: 'taskKey', key: 'taskKey', title: '任务 Key', width: 260 },
  { dataIndex: 'taskName', key: 'taskName', title: '任务名称', width: 180 },
  { dataIndex: 'cronExpression', key: 'cronExpression', title: 'Cron', width: 140 },
  { dataIndex: 'enabled', key: 'enabled', title: '启用', width: 90 },
  { dataIndex: 'runtimeStatus', key: 'runtimeStatus', title: '运行状态', width: 120 },
  { dataIndex: 'lastStatus', key: 'lastStatus', title: '最近结果', width: 120 },
  { dataIndex: 'nextRunAt', key: 'nextRunAt', title: '下次运行', width: 180 },
];

const api: KtTableApi<QqbotPluginTaskApi.Task> = {
  list: async (params) => await getQqbotPluginTaskPage(params),
};
```

Actions:

```tsx
const rowActions = [
  { label: '运行一次', onClick: (row) => runOnce(row) },
  { label: '修改 Cron', onClick: (row) => openCron(row) },
  { label: '运行记录', onClick: (row) => openRuns(row) },
  { label: row.enabled ? '停用' : '启用', onClick: (row) => toggle(row) },
];
```

Use Tag colors:

```ts
const statusColor = {
  disabled: 'default',
  failed: 'error',
  idle: 'default',
  running: 'processing',
  scheduled: 'success',
};
```

`TaskCronModal.tsx` wraps `Modal` + `CronEditorAntdvNext`; save calls `updateQqbotPluginTaskCron`.

`TaskRunDrawer.tsx` loads `getQqbotPluginTaskRunPage(task.id, { pageNo: 1, pageSize: 20 })` and shows status, triggerType, durationMs, `safeSummary` JSON, and errorMessage.

- [ ] **Step 7: Write and run page tests**

Test route and component calls:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import QqBotPluginTaskList from './list';

vi.mock('#/api/qqbot/plugin-task', () => ({
  getQqbotPluginTaskPage: vi.fn(async () => ({ list: [], total: 0 })),
  getQqbotPluginTaskRunPage: vi.fn(async () => ({ list: [], total: 0 })),
}));

describe('QQBot plugin task page', () => {
  it('renders a single route root and task table shell', () => {
    const wrapper = mount(QqBotPluginTaskList, {
      global: { stubs: ['Page', 'KtTable'] },
    });

    expect(wrapper.exists()).toBe(true);
    expect(wrapper.element.nodeType).toBe(Node.ELEMENT_NODE);
  });
});
```

Run:

```powershell
pnpm -F @vben/web-antdv-next exec vitest run apps/web-antdv-next/src/api/qqbot/plugin-task.spec.ts apps/web-antdv-next/src/views/qqbot/plugin-task/plugin-task.spec.tsx
```

Expected: PASS.

- [ ] **Step 8: Run Admin typecheck**

Run:

```powershell
pnpm -F @vben/web-antdv-next run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit Admin page**

Run:

```powershell
git -C D:\MyFiles\KT\Vue\kt-template-admin add pnpm-workspace.yaml pnpm-lock.yaml apps/web-antdv-next/package.json apps/web-antdv-next/src/api/qqbot apps/web-antdv-next/src/router/routes/modules/qqbot.ts apps/web-antdv-next/src/views/qqbot/plugin-task
git -C D:\MyFiles\KT\Vue\kt-template-admin commit -m "feat: 增加QQBot插件定时任务页面"
```

## Task 6: Env, Menu Permissions, Local HTTP Smoke, And Docs

**Files:**
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\.env.example`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\README.md`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\API.md`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\Jenkinsfile`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\k8s\prod\api.yaml`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\sql\qqbot-init.sql`
- Modify: `D:\MyFiles\KT\TASKS.md`

- [ ] **Step 1: Add runtime env documentation**

Add to `.env.example`:

```dotenv
# QQBot plugin scheduled task queue. Defaults reuse QQBOT_PLUGIN_QUEUE_REDIS_* when not set.
QQBOT_PLUGIN_TASK_QUEUE_REDIS_HOST=
QQBOT_PLUGIN_TASK_QUEUE_REDIS_PORT=6379
QQBOT_PLUGIN_TASK_QUEUE_REDIS_DB=0
QQBOT_PLUGIN_TASK_QUEUE_REDIS_PREFIX=kt:qqbot:plugin-task

# BangDream persistent main-data cache root.
BANGDREAM_TSUGU_CACHE_ROOT=.kt-workspace/cache/bangdream
```

In `k8s/prod/api.yaml`, mount/cache env must point to a persistent runtime path:

```yaml
- name: BANGDREAM_TSUGU_CACHE_ROOT
  value: /data/qqbot/plugins/bangdream/cache
- name: QQBOT_PLUGIN_TASK_QUEUE_REDIS_PREFIX
  value: kt:qqbot:plugin-task
```

If the API pod currently has no persistent volume for `/data/qqbot/plugins`, add a `hostPath` or existing PVC mount consistent with current K8s style.

- [ ] **Step 2: Add SQL menu permissions**

Append `sql/qqbot-init.sql` menu rows under the QQBot group:

```sql
INSERT INTO admin_menu (id, parent_id, name, path, component, redirect, permission, type, meta, status, sort)
VALUES
  (2041700000000100410, 2041700000000100400, 'QqBotPluginTask', '/qqbot/plugin-task', '/qqbot/plugin-task/list', NULL, 'QqBot:PluginTask:List', 'menu', '{"icon":"lucide:calendar-clock","title":"插件定时任务"}', 1, 5)
ON DUPLICATE KEY UPDATE
  path = VALUES(path),
  component = VALUES(component),
  permission = VALUES(permission),
  meta = VALUES(meta),
  status = VALUES(status),
  sort = VALUES(sort);
```

Add button permission rows if current menu table represents buttons separately:

```sql
INSERT INTO admin_menu (id, parent_id, name, path, component, redirect, permission, type, meta, status, sort)
VALUES
  (2041700000000100411, 2041700000000100410, 'QqBotPluginTaskUpdateCron', '', '', NULL, 'QqBot:PluginTask:UpdateCron', 'button', '{"title":"修改 Cron"}', 1, 1),
  (2041700000000100412, 2041700000000100410, 'QqBotPluginTaskEnable', '', '', NULL, 'QqBot:PluginTask:Enable', 'button', '{"title":"启用"}', 1, 2),
  (2041700000000100413, 2041700000000100410, 'QqBotPluginTaskDisable', '', '', NULL, 'QqBot:PluginTask:Disable', 'button', '{"title":"停用"}', 1, 3),
  (2041700000000100414, 2041700000000100410, 'QqBotPluginTaskRun', '', '', NULL, 'QqBot:PluginTask:Run', 'button', '{"title":"手动运行"}', 1, 4),
  (2041700000000100415, 2041700000000100410, 'QqBotPluginTaskRunLog', '', '', NULL, 'QqBot:PluginTask:RunLog', 'button', '{"title":"运行记录"}', 1, 5)
ON DUPLICATE KEY UPDATE
  permission = VALUES(permission),
  meta = VALUES(meta),
  status = VALUES(status),
  sort = VALUES(sort);
```

- [ ] **Step 3: Run full backend verification**

Run:

```powershell
pnpm exec jest --runInBand --runTestsByPath test/modules/qqbot/plugin-platform/manifest.spec.ts test/modules/qqbot/plugin-platform/plugin-task-manifest.spec.ts test/modules/qqbot/plugin-platform/plugin-task-persistence.spec.ts test/modules/qqbot/plugin-platform/plugin-task-api-contract.spec.ts test/modules/qqbot/plugin-platform/plugin-task-scheduler.spec.ts test/modules/qqbot/plugin-platform/worker-runtime.spec.ts test/modules/qqbot/plugin-platform/plugin-lifecycle-runtime.spec.ts test/modules/qqbot/plugins/bangdream/bestdori-main-data-sync.task.spec.ts
pnpm run typecheck
pnpm exec eslint src/modules/qqbot/plugin-platform src/modules/qqbot/plugins/bangdream/src test/modules/qqbot/plugin-platform test/modules/qqbot/plugins/bangdream
pnpm run build
git diff --check
```

Expected: Jest suites pass; typecheck passes; ESLint passes; build passes; diff check has no whitespace errors beyond known CRLF warnings if present.

- [ ] **Step 4: Run local API HTTP smoke**

Start or reuse local API according to repo conventions. With an admin token, call:

```powershell
$headers = @{ Authorization = "Bearer $env:KT_ADMIN_TOKEN" }
Invoke-RestMethod -Headers $headers -Uri 'http://127.0.0.1:48085/qqbot/plugin-platform/tasks/page?pageNo=1&pageSize=10'
Invoke-RestMethod -Headers $headers -Method Post -Uri 'http://127.0.0.1:48085/qqbot/plugin-platform/tasks/<taskId>/cron' -Body (@{ cronExpression='0 */6 * * *' } | ConvertTo-Json) -ContentType 'application/json'
Invoke-RestMethod -Headers $headers -Method Post -Uri 'http://127.0.0.1:48085/qqbot/plugin-platform/tasks/<taskId>/run' -Body (@{ input=@{} } | ConvertTo-Json) -ContentType 'application/json'
Invoke-RestMethod -Headers $headers -Uri 'http://127.0.0.1:48085/qqbot/plugin-platform/tasks/<taskId>/runs?pageNo=1&pageSize=10'
```

Expected: task page returns BangDream task; cron update returns normalized cron; manual run returns job id; run list eventually includes running/success or failed with safe error.

- [ ] **Step 5: Run Admin verification**

Run:

```powershell
pnpm -F @vben/web-antdv-next exec vitest run apps/web-antdv-next/src/api/qqbot/plugin-task.spec.ts apps/web-antdv-next/src/views/qqbot/plugin-task/plugin-task.spec.tsx
pnpm -F @vben/web-antdv-next run typecheck
```

Start Admin dev server and use Browser/Playwright to verify:

- `/qqbot/plugin-task` loads without route blank page.
- Task table fetches `/qqbot/plugin-platform/tasks/page`.
- Cron modal opens, edits `0 */6 * * *`, saves.
- Run-log drawer opens and lists rows.

- [ ] **Step 6: Update docs and TASKS**

Update `README.md` and `API.md` with:

- task manifest `tasks` fields;
- task endpoints;
- BullMQ task queue env;
- BangDream cache root env;
- Admin page path `/qqbot/plugin-task`.

Update root `D:\MyFiles\KT\TASKS.md` recent record with scope, keywords, and verification evidence only.

- [ ] **Step 7: Run KT review and cleanup gates**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run global-review -- --repo D:\MyFiles\KT\Node\kt-template-online-api --changed
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run global-review -- --repo D:\MyFiles\KT\Vue\kt-template-admin --changed
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run cleanup-history -- --dry-run
```

If cleanup dry-run lists stale artifacts:

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run cleanup-history -- --execute
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run cleanup-history -- --dry-run
```

Expected: review findings empty or fixed; cleanup final `deleted=[]`.

- [ ] **Step 8: Commit final docs/env/menu**

Run:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add .env.example README.md API.md Jenkinsfile k8s/prod/api.yaml sql/qqbot-init.sql sql/refactor-v3 src test
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "feat: 完成QQBot插件定时任务平台"
git -C D:\MyFiles\KT add TASKS.md
git -C D:\MyFiles\KT commit -m "docs: 记录QQBot插件定时任务闭环"
```

## Task 7: Push, Deploy, And Online Closure

**Files:**
- No planned code files. Runtime evidence must stay under `.kt-workspace/test-artifacts/qqbot-plugin-task/**`.

- [ ] **Step 1: Push changed repos**

Run only after local verification and review pass:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api status --short --branch
git -C D:\MyFiles\KT\Vue\kt-template-admin status --short --branch
git -C D:\MyFiles\KT\Node\kt-template-online-api push
git -C D:\MyFiles\KT\Vue\kt-template-admin push
```

Expected: API/Admin branches push successfully.

- [ ] **Step 2: Observe Jenkins/K8s rollout**

Use the stabilized deploy observation workflow:

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run deploy-observation -- --project api --job KT-Template/KT-Template-API/main --execute
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run deploy-observation -- --project admin --job KT-Template/KT-Template-Admin/main --execute
```

Expected for API: Jenkins build success, Deployment observedGeneration matches generation, desired=ready=updated=1, pod Running, image tag matches pushed commit, restartCount stable.

Expected for Admin: Jenkins build success and static deployment points to pushed commit/build.

- [ ] **Step 3: Run online API task smoke**

Through the existing online tunnel/admin token flow, call:

```powershell
GET  /qqbot/plugin-platform/tasks/page?pageNo=1&pageSize=10&taskKey=bangdream.bestdori.sync-main-data
POST /qqbot/plugin-platform/tasks/<taskId>/cron {"cronExpression":"0 */6 * * *"}
POST /qqbot/plugin-platform/tasks/<taskId>/run {"input":{}}
GET  /qqbot/plugin-platform/tasks/<taskId>/runs?pageNo=1&pageSize=10
POST /qqbot/command/test {"commandId":"<查分数表命令ID>","text":"/查分数表 cn","targetType":"private","targetId":"KT_TEST","userId":"KT_TEST"}
```

Expected:

- task exists and is enabled;
- cron update succeeds;
- manual run creates a run row and finishes `success` or `failed` with explicit safe error;
- BangDream command still succeeds after task run;
- response summaries redact `replyText`, image/base64 payloads, tokens, cookies, and QR data.

- [ ] **Step 4: Run online Admin page smoke**

Use Browser/Playwright:

- Open Admin `/qqbot/plugin-task`.
- Confirm table rows render.
- Open Cron modal and save `0 */6 * * *`.
- Click manual run.
- Open run-log drawer and verify latest run row appears.
- Switch away and back to ensure route has a single stable root and no blank page.

Expected: all page actions complete without console route-root warning or failed network request.

- [ ] **Step 5: Final closeout**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run global-review -- --repo D:\MyFiles\KT\Node\kt-template-online-api --changed
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run global-review -- --repo D:\MyFiles\KT\Vue\kt-template-admin --changed
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run cleanup-history -- --dry-run
```

Expected: findings empty; cleanup final `deleted=[]`; final answer reports local tests, online API smoke, online Admin smoke, deployment evidence, remaining risks, and exact artifact paths.

## Self-Review

- Spec coverage: manifest `tasks`, DB design, BullMQ scheduler bridge, worker `executeTask`, Admin dedicated page, cron editor with `@vue-js-cron/core`, BangDream Bestdori main-data sync, menu/permissions, env, local/online verification are all mapped to tasks.
- Placeholder scan: no task step uses TBD, broad "handle errors" placeholders, or out-of-order references without file paths.
- Type consistency: task status names are `idle | scheduled | running | failed | disabled`; run status names are `running | success | failed | skipped`; trigger types are `schedule | manual | bootstrap`; route base is `/qqbot/plugin-platform/tasks`.
