# API Runtime Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase 1 of the approved API runtime foundation: typed runtime config, classified runtime errors, structured runtime evidence, and a lightweight `GET /health/runtime` endpoint that can be used by Jenkins/K8s/ktWorkflow in the next plan.

**Architecture:** Add a focused `src/runtime` Nest module. It depends on `ConfigModule` and `CommonModule`, exports typed runtime primitives, and keeps business modules unchanged during this phase. The endpoint returns plain machine-readable JSON, not a Vben response wrapper, so deployment tooling can consume it directly.

**Tech Stack:** NestJS 11, TypeScript 5.9, Jest 29 with `ts-jest`, existing `@nestjs/config`, existing `ToolsService`, existing Swagger/Knife4j setup.

---

## Scope Boundary

This plan implements the runtime foundation skeleton only. It does not refactor NapCat login, Docker device persistence, Jenkins observation scripts, or ktWorkflow automation. Those follow as separate plans after this endpoint and evidence shape are verified.

The implementation must start from a clean API worktree except committed docs. If `git status --short` shows uncommitted source changes, inspect them before editing and do not overwrite user work.

## File Structure

Create these files:

```text
src/runtime/
  index.ts
  runtime.module.ts
  config/
    runtime-config.service.ts
    runtime-config.types.ts
  errors/
    runtime-error.types.ts
  evidence/
    runtime-evidence.service.ts
    runtime-evidence.types.ts
  health/
    runtime-health.controller.ts
    runtime-health.service.ts
    runtime-health.types.ts
test/runtime/
  runtime-config.service.spec.ts
  runtime-evidence.service.spec.ts
  runtime-health.controller.spec.ts
  runtime-health.service.spec.ts
```

Modify these files:

```text
src/app.module.ts
src/main.ts
README.md
API.md
```

---

## Task 1: Add Runtime Error and Config Primitives

- [ ] Confirm repo state and package metadata before edits:

```powershell
git status --short --branch
git rev-parse --is-inside-work-tree
node -v
pnpm -v
if (Test-Path .node-version) { Get-Content .node-version }
```

- [ ] Add `src/runtime/errors/runtime-error.types.ts`:

```ts
export type RuntimeErrorCategory =
  | 'config_error'
  | 'dependency_unavailable'
  | 'operation_failed'
  | 'cleanup_failed';

export interface RuntimeClassifiedError {
  category: RuntimeErrorCategory;
  operation: string;
  message: string;
  cause?: string;
  retryable: boolean;
}
```

- [ ] Add `src/runtime/config/runtime-config.types.ts`:

```ts
export type RuntimeConfigCheckLevel = 'required' | 'optional';

export interface RuntimeConfigCheck {
  key: string;
  level: RuntimeConfigCheckLevel;
  present: boolean;
  maskedValue?: string;
  message?: string;
}

export interface RuntimeAppConfig {
  nodeEnv: string;
  port: number;
}

export interface RuntimeDatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  synchronize: boolean;
}

export interface RuntimeLokiConfig {
  enabled: boolean;
  host: string;
  basicAuth: string;
}

export interface RuntimeMinioConfig {
  endpoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
}

export interface RuntimeWordpressConfig {
  endpoint: string;
  username: string;
}

export interface RuntimeQqbotConfig {
  reverseWsUrl: string;
  napcatDataRoot: string;
  napcatSshHost: string;
  napcatSshPort: number;
  napcatSshUser: string;
}

export interface RuntimeSafeConfigSnapshot {
  app: RuntimeAppConfig;
  database: RuntimeDatabaseConfig;
  loki: RuntimeLokiConfig;
  minio: RuntimeMinioConfig;
  wordpress: RuntimeWordpressConfig;
  qqbot: RuntimeQqbotConfig;
  checks: RuntimeConfigCheck[];
}
```

- [ ] Add `src/runtime/config/runtime-config.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ToolsService } from '../../common';
import {
  RuntimeAppConfig,
  RuntimeConfigCheck,
  RuntimeConfigCheckLevel,
  RuntimeDatabaseConfig,
  RuntimeLokiConfig,
  RuntimeMinioConfig,
  RuntimeQqbotConfig,
  RuntimeSafeConfigSnapshot,
  RuntimeWordpressConfig,
} from './runtime-config.types';

const REQUIRED_CONFIG_KEYS = [
  'DB_HOST',
  'DB_PORT',
  'DB_USERNAME',
  'DB_PASSWORD',
  'DB_DATABASE',
  'ADMIN_TOKEN_SECRET',
] as const;

const OPTIONAL_CONFIG_KEYS = [
  'MINIO_ENDPOINT',
  'MINIO_PORT',
  'MINIO_ACCESS_KEY',
  'MINIO_SECRET_KEY',
  'LOKI_HOST',
  'WORDPRESS_API_URL',
  'QQBOT_REVERSE_WS_URL',
  'NAPCAT_DATA_ROOT',
  'NAPCAT_SSH_HOST',
  'NAPCAT_SSH_PORT',
  'NAPCAT_SSH_USER',
] as const;

@Injectable()
export class RuntimeConfigService {
  constructor(
    private readonly configService: ConfigService,
    private readonly toolsService: ToolsService,
  ) {}

  readAppProfile(): RuntimeAppConfig {
    return {
      nodeEnv: this.getString('NODE_ENV', 'development'),
      port: this.getPositiveNumber('PORT', 48085),
    };
  }

  readDatabaseProfile(): RuntimeDatabaseConfig {
    return {
      host: this.getString('DB_HOST'),
      port: this.getPositiveNumber('DB_PORT', 3306),
      database: this.getString('DB_DATABASE'),
      username: this.getString('DB_USERNAME'),
      synchronize: this.getBoolean('DB_SYNC', false),
    };
  }

  readLokiProfile(): RuntimeLokiConfig {
    return {
      enabled: this.getBoolean('LOKI_ENABLED', false),
      host: this.getString('LOKI_HOST'),
      basicAuth: this.maskSecret(this.configService.get('LOKI_BASIC_AUTH')),
    };
  }

  readMinioProfile(): RuntimeMinioConfig {
    return {
      endpoint: this.getString('MINIO_ENDPOINT'),
      port: this.getPositiveNumber('MINIO_PORT', 9000),
      useSSL: this.getBoolean('MINIO_USE_SSL', false),
      accessKey: this.maskSecret(this.configService.get('MINIO_ACCESS_KEY')),
    };
  }

  readWordpressProfile(): RuntimeWordpressConfig {
    return {
      endpoint: this.getString('WORDPRESS_API_URL'),
      username: this.maskSecret(this.configService.get('WORDPRESS_USERNAME')),
    };
  }

  readQqbotProfile(): RuntimeQqbotConfig {
    return {
      reverseWsUrl: this.getString('QQBOT_REVERSE_WS_URL'),
      napcatDataRoot: this.getString('NAPCAT_DATA_ROOT'),
      napcatSshHost: this.getString('NAPCAT_SSH_HOST'),
      napcatSshPort: this.getPositiveNumber('NAPCAT_SSH_PORT', 22),
      napcatSshUser: this.getString('NAPCAT_SSH_USER'),
    };
  }

  getSafeSnapshot(): RuntimeSafeConfigSnapshot {
    return {
      app: this.readAppProfile(),
      database: this.readDatabaseProfile(),
      loki: this.readLokiProfile(),
      minio: this.readMinioProfile(),
      wordpress: this.readWordpressProfile(),
      qqbot: this.readQqbotProfile(),
      checks: this.getConfigChecks(),
    };
  }

  getConfigChecks(): RuntimeConfigCheck[] {
    return [
      ...REQUIRED_CONFIG_KEYS.map((key) => this.createCheck(key, 'required')),
      ...OPTIONAL_CONFIG_KEYS.map((key) => this.createCheck(key, 'optional')),
    ];
  }

  maskSecret(value: unknown): string {
    const text = this.toolsService.toSecretText(value);
    if (!text) return '';
    if (text.length <= 4) return '****';
    return `${text.slice(0, 2)}***${text.slice(-2)}`;
  }

  private createCheck(
    key: string,
    level: RuntimeConfigCheckLevel,
  ): RuntimeConfigCheck {
    const value = this.configService.get(key);
    const text = this.toolsService.toSecretText(value);
    const present = !!text;

    return {
      key,
      level,
      present,
      maskedValue: present ? this.maskSecret(value) : undefined,
      message: present ? undefined : `${key} is not configured`,
    };
  }

  private getString(key: string, fallback = '') {
    const value = this.toolsService.toTrimmedString(this.configService.get(key));
    return value || fallback;
  }

  private getPositiveNumber(key: string, fallback: number) {
    return this.toolsService.toPositiveNumber(
      this.configService.get<string | number>(key),
      fallback,
    );
  }

  private getBoolean(key: string, fallback: boolean) {
    return this.toolsService.normalizeBoolean(
      this.configService.get<string | boolean | number>(key),
      fallback,
    );
  }
}
```

- [ ] Add `test/runtime/runtime-config.service.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import { ToolsService } from '../../src/common';
import { RuntimeConfigService } from '../../src/runtime/config/runtime-config.service';

function createService(values: Record<string, unknown>) {
  const configService = {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;

  return new RuntimeConfigService(configService, new ToolsService());
}

describe('RuntimeConfigService', () => {
  it('parses app and database profiles with stable defaults', () => {
    const service = createService({
      DB_HOST: '127.0.0.1',
      DB_PORT: '3307',
      DB_DATABASE: 'kt',
      DB_USERNAME: 'admin',
      DB_SYNC: 'true',
      NODE_ENV: 'test',
    });

    expect(service.readAppProfile()).toEqual({
      nodeEnv: 'test',
      port: 48085,
    });
    expect(service.readDatabaseProfile()).toEqual({
      host: '127.0.0.1',
      port: 3307,
      database: 'kt',
      username: 'admin',
      synchronize: true,
    });
  });

  it('masks secrets in checks and snapshots', () => {
    const service = createService({
      ADMIN_TOKEN_SECRET: 'abcdef123456',
      DB_HOST: 'mysql',
      DB_PORT: '3306',
      DB_USERNAME: 'root',
      DB_PASSWORD: 'password-value',
      DB_DATABASE: 'kt',
      MINIO_ACCESS_KEY: 'minio-access-key',
      WORDPRESS_USERNAME: 'wordpress-user',
    });

    const snapshot = service.getSafeSnapshot();
    const adminSecretCheck = snapshot.checks.find(
      (check) => check.key === 'ADMIN_TOKEN_SECRET',
    );

    expect(adminSecretCheck).toEqual(
      expect.objectContaining({
        present: true,
        maskedValue: 'ab***56',
      }),
    );
    expect(JSON.stringify(snapshot)).not.toContain('abcdef123456');
    expect(JSON.stringify(snapshot)).not.toContain('password-value');
    expect(snapshot.minio.accessKey).toBe('mi***ey');
    expect(snapshot.wordpress.username).toBe('wo***er');
  });

  it('marks missing required config as absent', () => {
    const service = createService({
      DB_HOST: 'mysql',
    });

    const checks = service.getConfigChecks();

    expect(checks).toContainEqual(
      expect.objectContaining({
        key: 'DB_PASSWORD',
        level: 'required',
        present: false,
        message: 'DB_PASSWORD is not configured',
      }),
    );
  });
});
```

- [ ] Run the first targeted test:

```powershell
pnpm exec jest --runTestsByPath test/runtime/runtime-config.service.spec.ts
```

- [ ] Commit after the test passes:

```powershell
git status --short
git add src/runtime/errors/runtime-error.types.ts src/runtime/config/runtime-config.types.ts src/runtime/config/runtime-config.service.ts test/runtime/runtime-config.service.spec.ts
git diff --cached --check
git commit -m "feat: 添加API运行时配置基础"
```

---

## Task 2: Add Structured Runtime Evidence

- [ ] Add `src/runtime/evidence/runtime-evidence.types.ts`:

```ts
import type { RuntimeClassifiedError } from '../errors/runtime-error.types';

export type RuntimeEvidenceStatus =
  | 'passed'
  | 'failed'
  | 'blocked'
  | 'skipped';

export interface RuntimeEvidenceCleanupResult {
  status: RuntimeEvidenceStatus;
  message: string;
  details?: Record<string, unknown>;
}

export interface RuntimeEvidenceAssertion {
  name: string;
  passed: boolean;
  message: string;
}

export interface RuntimeEvidenceInput {
  title: string;
  taskType: string;
  project: string;
  environment: string;
  operation: string;
  target?: string;
  status: RuntimeEvidenceStatus;
  startedAt?: Date;
  endedAt?: Date;
  details?: Record<string, unknown>;
  assertions?: RuntimeEvidenceAssertion[];
  cleanup?: RuntimeEvidenceCleanupResult;
  error?: RuntimeClassifiedError;
}

export interface RuntimeEvidenceRecord extends RuntimeEvidenceInput {
  startedAt: Date;
  endedAt: Date;
  durationMs: number;
  schemaVersion: 1;
}
```

- [ ] Add `src/runtime/evidence/runtime-evidence.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import {
  RuntimeEvidenceCleanupResult,
  RuntimeEvidenceInput,
  RuntimeEvidenceRecord,
} from './runtime-evidence.types';

@Injectable()
export class RuntimeEvidenceService {
  createRecord(input: RuntimeEvidenceInput): RuntimeEvidenceRecord {
    const startedAt = input.startedAt ?? new Date();
    const endedAt = input.endedAt ?? new Date();

    return {
      ...input,
      details: this.sanitizeRecord(input.details),
      cleanup: this.sanitizeCleanup(input.cleanup),
      startedAt,
      endedAt,
      durationMs: Math.max(0, endedAt.getTime() - startedAt.getTime()),
      schemaVersion: 1,
    };
  }

  sanitizeRecord<T extends Record<string, unknown> | undefined>(value: T): T {
    if (!value) return value;
    return this.sanitizeValue(value) as T;
  }

  private sanitizeCleanup(
    cleanup: RuntimeEvidenceCleanupResult | undefined,
  ): RuntimeEvidenceCleanupResult | undefined {
    if (!cleanup) return undefined;
    return {
      ...cleanup,
      details: this.sanitizeRecord(cleanup.details),
    };
  }

  private sanitizeValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeValue(item));
    }

    if (value instanceof Date) {
      return value;
    }

    if (!value || typeof value !== 'object') {
      return value;
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        this.isSensitiveKey(key) ? '<redacted>' : this.sanitizeValue(item),
      ]),
    );
  }

  private isSensitiveKey(key: string) {
    return /password|secret|token|authorization|cookie|privateKey|sshKey|ticket|randstr|replyText/i.test(
      key,
    );
  }
}
```

- [ ] Add `test/runtime/runtime-evidence.service.spec.ts`:

```ts
import { RuntimeEvidenceService } from '../../src/runtime/evidence/runtime-evidence.service';

describe('RuntimeEvidenceService', () => {
  it('creates records with duration and schema version', () => {
    const service = new RuntimeEvidenceService();
    const startedAt = new Date('2026-06-13T00:00:00.000Z');
    const endedAt = new Date('2026-06-13T00:00:01.250Z');

    const record = service.createRecord({
      title: 'runtime health local request',
      taskType: 'api-smoke',
      project: 'kt-template-online-api',
      environment: 'local',
      operation: 'GET /health/runtime',
      status: 'passed',
      startedAt,
      endedAt,
    });

    expect(record.durationMs).toBe(1250);
    expect(record.schemaVersion).toBe(1);
  });

  it('redacts nested sensitive fields from evidence details and cleanup', () => {
    const service = new RuntimeEvidenceService();

    const record = service.createRecord({
      title: 'napcat login evidence',
      taskType: 'api-smoke',
      project: 'kt-template-online-api',
      environment: 'local',
      operation: 'NapCat PasswordLogin',
      status: 'blocked',
      details: {
        account: '123456',
        password: 'plain-password',
        data: {
          token: 'raw-token',
          output: {
            replyText: 'base64-payload',
          },
        },
      },
      cleanup: {
        status: 'failed',
        message: 'runtime password cleanup failed',
        details: {
          sshKey: 'private-key',
          remoteFile: '/tmp/kt-script.sh',
        },
      },
    });

    expect(record.details).toEqual({
      account: '123456',
      password: '<redacted>',
      data: {
        token: '<redacted>',
        output: {
          replyText: '<redacted>',
        },
      },
    });
    expect(record.cleanup?.details).toEqual({
      sshKey: '<redacted>',
      remoteFile: '/tmp/kt-script.sh',
    });
  });
});
```

- [ ] Run the evidence test:

```powershell
pnpm exec jest --runTestsByPath test/runtime/runtime-evidence.service.spec.ts
```

- [ ] Commit after the test passes:

```powershell
git status --short
git add src/runtime/evidence/runtime-evidence.types.ts src/runtime/evidence/runtime-evidence.service.ts test/runtime/runtime-evidence.service.spec.ts
git diff --cached --check
git commit -m "feat: 添加API运行时证据模型"
```

---

## Task 3: Add Runtime Health Service, Controller, and Module Wiring

- [ ] Add `src/runtime/health/runtime-health.types.ts`:

```ts
import type { RuntimeSafeConfigSnapshot } from '../config/runtime-config.types';

export type RuntimeHealthStatus = 'live' | 'ready' | 'degraded' | 'blocked';

export interface RuntimeHealthCheck {
  name: string;
  status: RuntimeHealthStatus;
  critical: boolean;
  message: string;
  detail?: Record<string, unknown>;
}

export interface RuntimeHealthReport {
  service: 'kt-template-online-api';
  checkedAt: string;
  status: RuntimeHealthStatus;
  checks: RuntimeHealthCheck[];
  config: RuntimeSafeConfigSnapshot;
}
```

- [ ] Add `src/runtime/health/runtime-health.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { RuntimeConfigService } from '../config/runtime-config.service';
import {
  RuntimeHealthCheck,
  RuntimeHealthReport,
  RuntimeHealthStatus,
} from './runtime-health.types';

@Injectable()
export class RuntimeHealthService {
  constructor(private readonly runtimeConfigService: RuntimeConfigService) {}

  getRuntimeHealth(): RuntimeHealthReport {
    const config = this.runtimeConfigService.getSafeSnapshot();
    const checks: RuntimeHealthCheck[] = [
      {
        name: 'process',
        status: 'live',
        critical: true,
        message: 'NestJS process answered runtime health request',
      },
      ...config.checks.map((check) => ({
        name: `config:${check.key}`,
        status: this.getConfigCheckStatus(check.present, check.level),
        critical: check.level === 'required',
        message: check.present
          ? `${check.key} is configured`
          : check.message ?? `${check.key} is not configured`,
      })),
    ];

    return {
      service: 'kt-template-online-api',
      checkedAt: new Date().toISOString(),
      status: this.aggregateStatus(checks),
      checks,
      config,
    };
  }

  private getConfigCheckStatus(
    present: boolean,
    level: 'required' | 'optional',
  ): RuntimeHealthStatus {
    if (present) return 'ready';
    return level === 'required' ? 'blocked' : 'degraded';
  }

  private aggregateStatus(checks: RuntimeHealthCheck[]): RuntimeHealthStatus {
    if (checks.some((check) => check.critical && check.status === 'blocked')) {
      return 'blocked';
    }

    if (checks.some((check) => check.status === 'degraded')) {
      return 'degraded';
    }

    if (checks.every((check) => check.status === 'live')) {
      return 'live';
    }

    return 'ready';
  }
}
```

- [ ] Add `src/runtime/health/runtime-health.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RuntimeHealthService } from './runtime-health.service';
import type { RuntimeHealthReport } from './runtime-health.types';

@ApiTags('Runtime Health')
@Controller('health')
export class RuntimeHealthController {
  constructor(private readonly runtimeHealthService: RuntimeHealthService) {}

  @Get('runtime')
  @ApiOperation({ summary: 'Get machine-readable API runtime health' })
  getRuntimeHealth(): RuntimeHealthReport {
    return this.runtimeHealthService.getRuntimeHealth();
  }
}
```

- [ ] Add `src/runtime/runtime.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from '../common';
import { RuntimeConfigService } from './config/runtime-config.service';
import { RuntimeEvidenceService } from './evidence/runtime-evidence.service';
import { RuntimeHealthController } from './health/runtime-health.controller';
import { RuntimeHealthService } from './health/runtime-health.service';

@Module({
  imports: [ConfigModule, CommonModule],
  controllers: [RuntimeHealthController],
  providers: [
    RuntimeConfigService,
    RuntimeEvidenceService,
    RuntimeHealthService,
  ],
  exports: [RuntimeConfigService, RuntimeEvidenceService, RuntimeHealthService],
})
export class RuntimeModule {}
```

- [ ] Add `src/runtime/index.ts`:

```ts
export * from './config/runtime-config.service';
export * from './config/runtime-config.types';
export * from './errors/runtime-error.types';
export * from './evidence/runtime-evidence.service';
export * from './evidence/runtime-evidence.types';
export * from './health/runtime-health.controller';
export * from './health/runtime-health.service';
export * from './health/runtime-health.types';
export * from './runtime.module';
```

- [ ] Modify `src/app.module.ts`:

```ts
import { RuntimeModule } from './runtime';
```

Add `RuntimeModule` to `imports` after `CommonModule`:

```ts
    CommonModule,
    RuntimeModule,
    AdminModule,
```

- [ ] Modify `src/main.ts` so `/health/runtime` appears in the basic Swagger group:

```ts
  {
    matcher: (path) =>
      path === '/' || path.startsWith('/minio') || path.startsWith('/health'),
    name: '基础能力',
    path: 'api/basic',
  },
```

- [ ] Add `test/runtime/runtime-health.service.spec.ts`:

```ts
import { RuntimeHealthService } from '../../src/runtime/health/runtime-health.service';

describe('RuntimeHealthService', () => {
  it('returns ready when required config is present and optional config is present', () => {
    const service = new RuntimeHealthService({
      getSafeSnapshot: () => ({
        app: { nodeEnv: 'test', port: 48085 },
        database: {
          host: 'mysql',
          port: 3306,
          database: 'kt',
          username: 'root',
          synchronize: false,
        },
        loki: { enabled: false, host: '', basicAuth: '' },
        minio: {
          endpoint: 'minio',
          port: 9000,
          useSSL: false,
          accessKey: 'mi***ey',
        },
        wordpress: { endpoint: 'https://example.test', username: 'wo***er' },
        qqbot: {
          reverseWsUrl: 'ws://127.0.0.1:3001',
          napcatDataRoot: '/data/napcat',
          napcatSshHost: 'nas',
          napcatSshPort: 22,
          napcatSshUser: 'root',
        },
        checks: [
          { key: 'DB_HOST', level: 'required', present: true },
          { key: 'MINIO_ENDPOINT', level: 'optional', present: true },
        ],
      }),
    } as any);

    expect(service.getRuntimeHealth()).toEqual(
      expect.objectContaining({
        service: 'kt-template-online-api',
        status: 'ready',
      }),
    );
  });

  it('returns blocked when required config is missing', () => {
    const service = new RuntimeHealthService({
      getSafeSnapshot: () => ({
        app: { nodeEnv: 'test', port: 48085 },
        database: {
          host: '',
          port: 3306,
          database: '',
          username: '',
          synchronize: false,
        },
        loki: { enabled: false, host: '', basicAuth: '' },
        minio: { endpoint: '', port: 9000, useSSL: false, accessKey: '' },
        wordpress: { endpoint: '', username: '' },
        qqbot: {
          reverseWsUrl: '',
          napcatDataRoot: '',
          napcatSshHost: '',
          napcatSshPort: 22,
          napcatSshUser: '',
        },
        checks: [
          {
            key: 'DB_PASSWORD',
            level: 'required',
            present: false,
            message: 'DB_PASSWORD is not configured',
          },
          {
            key: 'MINIO_ENDPOINT',
            level: 'optional',
            present: false,
            message: 'MINIO_ENDPOINT is not configured',
          },
        ],
      }),
    } as any);

    const report = service.getRuntimeHealth();

    expect(report.status).toBe('blocked');
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: 'config:DB_PASSWORD',
        status: 'blocked',
        critical: true,
      }),
    );
  });
});
```

- [ ] Add `test/runtime/runtime-health.controller.spec.ts`:

```ts
import { RuntimeHealthController } from '../../src/runtime/health/runtime-health.controller';

describe('RuntimeHealthController', () => {
  it('returns the runtime health report from the service', () => {
    const report = {
      service: 'kt-template-online-api',
      checkedAt: '2026-06-13T00:00:00.000Z',
      status: 'ready',
      checks: [],
      config: {
        app: { nodeEnv: 'test', port: 48085 },
        database: {
          host: 'mysql',
          port: 3306,
          database: 'kt',
          username: 'root',
          synchronize: false,
        },
        loki: { enabled: false, host: '', basicAuth: '' },
        minio: { endpoint: '', port: 9000, useSSL: false, accessKey: '' },
        wordpress: { endpoint: '', username: '' },
        qqbot: {
          reverseWsUrl: '',
          napcatDataRoot: '',
          napcatSshHost: '',
          napcatSshPort: 22,
          napcatSshUser: '',
        },
        checks: [],
      },
    } as const;
    const service = { getRuntimeHealth: jest.fn(() => report) };
    const controller = new RuntimeHealthController(service as any);

    expect(controller.getRuntimeHealth()).toBe(report);
    expect(service.getRuntimeHealth).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] Run runtime tests:

```powershell
pnpm exec jest --runTestsByPath test/runtime/runtime-config.service.spec.ts test/runtime/runtime-evidence.service.spec.ts test/runtime/runtime-health.service.spec.ts test/runtime/runtime-health.controller.spec.ts
```

- [ ] Run typecheck:

```powershell
pnpm run typecheck
```

- [ ] Commit after tests and typecheck pass:

```powershell
git status --short
git add src/runtime src/app.module.ts src/main.ts test/runtime
git diff --cached --check
git commit -m "feat: 添加API运行时健康检查"
```

---

## Task 4: Document Runtime Health and Verify the Local Interface

- [ ] Update `README.md` with a concise runtime health section:

```md
### Runtime health

The API exposes `GET /health/runtime` for deployment and local smoke checks.
It returns plain JSON with:

- `status`: `live`, `ready`, `degraded`, or `blocked`.
- `checks`: process and runtime config checks.
- `config`: a safe runtime config snapshot with secrets masked.

The endpoint is machine-readable and intentionally does not use the Vben
response wrapper.
```

- [ ] Update `API.md` with the endpoint contract:

```md
## Runtime Health

| Method | Path              | Auth | Description                         |
| ------ | ----------------- | ---- | ----------------------------------- |
| GET    | `/health/runtime` | No   | Runtime health and safe config view |

Status meanings:

- `live`: the NestJS process answered the request.
- `ready`: critical config checks are present.
- `degraded`: optional runtime config is absent.
- `blocked`: required runtime config is absent.
```

- [ ] Start or reuse the local API service, then make one real request to the endpoint. Use a bounded wait loop and clean up only the process started for this check:

```powershell
$repo = 'D:\MyFiles\KT\Node\kt-template-online-api'
$job = Start-Job -ScriptBlock {
  param($repoPath)
  Set-Location $repoPath
  pnpm start
} -ArgumentList $repo

try {
  $deadline = (Get-Date).AddSeconds(60)
  $response = $null
  do {
    try {
      $response = Invoke-RestMethod -Uri 'http://127.0.0.1:48085/health/runtime' -TimeoutSec 5
      break
    } catch {
      Start-Sleep -Seconds 2
    }
  } while ((Get-Date) -lt $deadline)

  if (-not $response) {
    throw 'GET /health/runtime did not answer within 60 seconds'
  }

  $response | ConvertTo-Json -Depth 8
} finally {
  Stop-Job $job -ErrorAction SilentlyContinue
  Remove-Job $job -Force -ErrorAction SilentlyContinue
}
```

- [ ] If the local service cannot start because required local infrastructure is unavailable, record the start failure and do not claim interface verification. Keep the committed tests and typecheck evidence separate from the interface evidence.

- [ ] Run the full lightweight verification set for this phase:

```powershell
pnpm exec jest --runTestsByPath test/runtime/runtime-config.service.spec.ts test/runtime/runtime-evidence.service.spec.ts test/runtime/runtime-health.service.spec.ts test/runtime/runtime-health.controller.spec.ts
pnpm run typecheck
git diff --check
```

- [ ] Run KT documentation sync for the changed files and apply any required doc update it reports. Prefer the `kt_change_doc_sync` MCP tool with these inputs:

```json
{
  "project": "D:\\MyFiles\\KT\\Node\\kt-template-online-api",
  "changedFiles": [
    "README.md",
    "API.md",
    "src/runtime",
    "src/app.module.ts",
    "src/main.ts",
    "test/runtime"
  ]
}
```

- [ ] Update root `D:\MyFiles\KT\TASKS.md` with a short implementation evidence record because source files changed. Keep the record to scope, keywords, verification commands, and any remaining uncertainty. If `TASKS.md` already has pre-existing user changes, inspect the diff and do not commit unrelated lines.

- [ ] Run KT global review scoped to this implementation. Fix important findings before continuing:

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run global-review -- --project D:\MyFiles\KT\Node\kt-template-online-api --changed-files README.md API.md src/runtime src/app.module.ts src/main.ts test/runtime
```

- [ ] Run the Superpowers code-review gate after implementation:

```text
Use superpowers:requesting-code-review, then address actionable findings with superpowers:receiving-code-review if findings are returned.
```

- [ ] Commit API docs after verification and review pass:

```powershell
git status --short
git add README.md API.md
git diff --cached --check
git commit -m "docs: 补充API运行时健康说明"
```

- [ ] Commit the root task record only when the staged `TASKS.md` diff contains only this implementation record:

```powershell
git -C D:\MyFiles\KT status --short TASKS.md
git -C D:\MyFiles\KT diff -- TASKS.md
git -C D:\MyFiles\KT add TASKS.md
git -C D:\MyFiles\KT diff --cached --check
git -C D:\MyFiles\KT commit -m "docs: 记录API运行时基础验证"
```

---

## Final Verification Gate

- [ ] Confirm API repo status is clean apart from expected ahead commits:

```powershell
git status --short --branch
```

- [ ] Confirm root repo only contains intentional KT record changes:

```powershell
git -C D:\MyFiles\KT status --short --branch
```

- [ ] Report exact evidence:

```text
Jest command and result
typecheck command and result
local GET /health/runtime result or explicit local-start blocker
KT doc sync result
KT global review result
Superpowers review result
cleanup action for any started local process
```

## Handoff to the Next Plan

After this phase is verified, the next plan should extend the same evidence shape into ktWorkflow/Jenkins/K8s deployment observation. The NapCat adapter plan should start only after the deploy observation plan has a reusable read-only observation path.
