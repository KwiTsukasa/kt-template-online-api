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
  transportEnabled: boolean;
  httpRequestPushEnabled: boolean;
  queryConfigured: boolean;
  host: string;
  queryHost: string;
  environment: string;
  tenantId: string;
  username: string;
  passwordConfigured: boolean;
}

export interface RuntimeMinioConfig {
  endpoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  bucket: string;
}

export interface RuntimeWordpressConfig {
  baseUrl: string;
  hostHeader: string;
  adminUsername: string;
  passwordConfigured: boolean;
  timeoutMs: number;
  loginTimeoutMs: number;
  availabilityTtlMs: number;
}

export interface RuntimeQqbotConfig {
  reverseWsPath: string;
  reverseWsToken: string;
  napcatRoot: string;
  napcatContainerMode: string;
  napcatSshTarget: string;
  napcatSshPort: number;
  napcatSshKeyPath: string;
  napcatReverseWsBase: string;
  napcatWebuiBaseUrl: string;
  napcatWebuiToken: string;
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

const OPTIONAL_CONFIG_CHECKS: ReadonlyArray<string | readonly string[]> = [
  'MINIO_ENDPOINT',
  'MINIO_PORT',
  'MINIO_ACCESS_KEY',
  'MINIO_SECRET_KEY',
  'MINIO_BUCKET',
  ['LOKI_HOST', 'LOKI_URL'],
  ['LOKI_QUERY_HOST', 'LOKI_HOST', 'LOKI_URL'],
  'LOKI_ENV',
  'LOKI_HTTP_REQUEST_PUSH_ENABLED',
  'LOKI_TENANT_ID',
  'LOKI_USERNAME',
  'LOKI_PASSWORD',
  'LOKI_PUSH_ENDPOINT',
  'LOKI_QUERY_ENDPOINT',
  'LOKI_PUSH_TIMEOUT_MS',
  'LOKI_QUERY_TIMEOUT_MS',
  'LOKI_BATCH_INTERVAL_SECONDS',
  'LOKI_BATCH_MAX_BUFFER_SIZE',
  'WORDPRESS_BASE_URL',
  'WORDPRESS_HOST_HEADER',
  'WORDPRESS_ADMIN_USERNAME',
  'WORDPRESS_ADMIN_PASSWORD',
  'WORDPRESS_TIMEOUT_MS',
  'WORDPRESS_LOGIN_TIMEOUT_MS',
  'WORDPRESS_AVAILABILITY_TTL_MS',
  'QQBOT_REVERSE_WS_PATH',
  'QQBOT_REVERSE_WS_TOKEN',
  'QQBOT_NAPCAT_ROOT',
  'QQBOT_NAPCAT_CONTAINER_MODE',
  'QQBOT_NAPCAT_SSH_TARGET',
  'QQBOT_NAPCAT_SSH_PORT',
  'QQBOT_NAPCAT_SSH_KEY_PATH',
  ['QQBOT_NAPCAT_REVERSE_WS_URL', 'QQBOT_NAPCAT_REVERSE_WS_BASE'],
  ['NAPCAT_WEBUI_BASE_URL', 'QQBOT_NAPCAT_WEBUI_URL'],
  ['NAPCAT_WEBUI_TOKEN', 'QQBOT_NAPCAT_WEBUI_TOKEN'],
];

@Injectable()
export class RuntimeConfigService {
  constructor(
    private readonly configService: ConfigService,
    private readonly toolsService: ToolsService,
  ) {}

  readAppProfile(): RuntimeAppConfig {
    return {
      nodeEnv: this.getString('NODE_ENV', 'development'),
      port: 48085,
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
    const host = this.getFirstString(['LOKI_HOST', 'LOKI_URL']);
    const queryHost = this.getFirstString([
      'LOKI_QUERY_HOST',
      'LOKI_HOST',
      'LOKI_URL',
    ]);

    return {
      transportEnabled: !!host,
      httpRequestPushEnabled:
        !!host && this.getBoolean('LOKI_HTTP_REQUEST_PUSH_ENABLED', true),
      queryConfigured: !!queryHost,
      host,
      queryHost,
      environment: this.getString(
        'LOKI_ENV',
        this.getString('NODE_ENV', 'development'),
      ),
      tenantId: this.getString('LOKI_TENANT_ID'),
      username: this.getString('LOKI_USERNAME'),
      passwordConfigured: !!this.getString('LOKI_PASSWORD'),
    };
  }

  readMinioProfile(): RuntimeMinioConfig {
    return {
      endpoint: this.getString('MINIO_ENDPOINT'),
      port: this.getPositiveNumber('MINIO_PORT', 9000),
      useSSL: false,
      accessKey: this.maskSecret(this.configService.get('MINIO_ACCESS_KEY')),
      bucket: this.getString('MINIO_BUCKET', 'kt-template-online'),
    };
  }

  readWordpressProfile(): RuntimeWordpressConfig {
    const timeoutMs = this.getPositiveNumber('WORDPRESS_TIMEOUT_MS', 15000);

    return {
      baseUrl: this.getString('WORDPRESS_BASE_URL'),
      hostHeader: this.getString('WORDPRESS_HOST_HEADER'),
      adminUsername: this.getString('WORDPRESS_ADMIN_USERNAME'),
      passwordConfigured: !!this.getString('WORDPRESS_ADMIN_PASSWORD'),
      timeoutMs,
      loginTimeoutMs: this.getPositiveNumber(
        'WORDPRESS_LOGIN_TIMEOUT_MS',
        this.getPositiveNumber('WORDPRESS_TIMEOUT_MS', 3000),
      ),
      availabilityTtlMs: this.getPositiveNumber(
        'WORDPRESS_AVAILABILITY_TTL_MS',
        60_000,
      ),
    };
  }

  readQqbotProfile(): RuntimeQqbotConfig {
    return {
      reverseWsPath: this.getString(
        'QQBOT_REVERSE_WS_PATH',
        '/qqbot/onebot/reverse',
      ),
      reverseWsToken: this.maskSecret(
        this.configService.get('QQBOT_REVERSE_WS_TOKEN'),
      ),
      napcatRoot: this.getString(
        'QQBOT_NAPCAT_ROOT',
        '/vol1/docker/kt-qqbot/napcat-instances',
      ),
      napcatContainerMode: this.getString('QQBOT_NAPCAT_CONTAINER_MODE'),
      napcatSshTarget: this.getString('QQBOT_NAPCAT_SSH_TARGET', 'nas'),
      napcatSshPort: this.getPositiveNumber('QQBOT_NAPCAT_SSH_PORT', 22),
      napcatSshKeyPath: this.getString('QQBOT_NAPCAT_SSH_KEY_PATH'),
      napcatReverseWsBase: this.getFirstString([
        'QQBOT_NAPCAT_REVERSE_WS_URL',
        'QQBOT_NAPCAT_REVERSE_WS_BASE',
      ]),
      napcatWebuiBaseUrl: this.getFirstString([
        'NAPCAT_WEBUI_BASE_URL',
        'QQBOT_NAPCAT_WEBUI_URL',
      ]),
      napcatWebuiToken: this.maskSecret(
        this.getFirstString(['NAPCAT_WEBUI_TOKEN', 'QQBOT_NAPCAT_WEBUI_TOKEN']),
      ),
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
      ...OPTIONAL_CONFIG_CHECKS.map((check) =>
        typeof check === 'string'
          ? this.createCheck(check, 'optional')
          : this.createAnyCheck([...check], 'optional'),
      ),
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

  private createAnyCheck(
    keys: string[],
    level: RuntimeConfigCheckLevel,
  ): RuntimeConfigCheck {
    const key = keys.join('|');
    const value = this.getFirstString(keys);
    const present = !!value;

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

  private getFirstString(keys: string[], fallback = '') {
    for (const key of keys) {
      const value = this.getString(key);
      if (value) return value;
    }
    return fallback;
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
      PORT: '12345',
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
      MINIO_USE_SSL: 'true',
      WORDPRESS_ADMIN_USERNAME: 'wordpress-user',
      WORDPRESS_ADMIN_PASSWORD: 'wordpress-password',
      LOKI_PASSWORD: 'loki-password',
      QQBOT_REVERSE_WS_TOKEN: 'qq-reverse-token',
      NAPCAT_WEBUI_TOKEN: 'napcat-webui-token',
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
    expect(JSON.stringify(snapshot)).not.toContain('wordpress-password');
    expect(JSON.stringify(snapshot)).not.toContain('loki-password');
    expect(JSON.stringify(snapshot)).not.toContain('qq-reverse-token');
    expect(JSON.stringify(snapshot)).not.toContain('napcat-webui-token');
    expect(snapshot.minio.accessKey).toBe('mi***ey');
    expect(snapshot.minio.useSSL).toBe(false);
    expect(snapshot.wordpress.adminUsername).toBe('wordpress-user');
    expect(snapshot.wordpress.passwordConfigured).toBe(true);
    expect(snapshot.loki.passwordConfigured).toBe(true);
    expect(snapshot.qqbot.reverseWsToken).toBe('qq***en');
    expect(snapshot.qqbot.napcatWebuiToken).toBe('na***en');
  });

  it('reads current WordPress, Loki, and NapCat runtime keys without leaking secrets', () => {
    const service = createService({
      WORDPRESS_BASE_URL: 'https://blog.example.test',
      WORDPRESS_HOST_HEADER: 'blog.example.test',
      WORDPRESS_ADMIN_USERNAME: 'wordpress-admin',
      WORDPRESS_ADMIN_PASSWORD: 'wordpress-password',
      WORDPRESS_TIMEOUT_MS: '16000',
      WORDPRESS_LOGIN_TIMEOUT_MS: '4000',
      WORDPRESS_AVAILABILITY_TTL_MS: '70000',
      LOKI_URL: 'https://loki-push.example.test',
      LOKI_QUERY_HOST: 'https://loki-query.example.test',
      LOKI_ENV: 'production',
      LOKI_HTTP_REQUEST_PUSH_ENABLED: 'false',
      LOKI_USERNAME: 'loki-user',
      LOKI_PASSWORD: 'loki-password',
      QQBOT_NAPCAT_ROOT: '/vol1/docker/napcat',
      QQBOT_NAPCAT_CONTAINER_MODE: 'ssh',
      QQBOT_NAPCAT_SSH_TARGET: 'nas',
      QQBOT_NAPCAT_SSH_PORT: '2202',
      QQBOT_NAPCAT_SSH_KEY_PATH: '/home/kt/.ssh/napcat',
      QQBOT_NAPCAT_REVERSE_WS_BASE: 'ws://api.example.test/onebot',
      QQBOT_REVERSE_WS_PATH: '/qqbot/reverse',
      QQBOT_REVERSE_WS_TOKEN: 'qq-reverse-token',
      NAPCAT_WEBUI_BASE_URL: 'http://127.0.0.1:6099',
      NAPCAT_WEBUI_TOKEN: 'napcat-webui-token',
    });

    expect(service.readWordpressProfile()).toEqual({
      baseUrl: 'https://blog.example.test',
      hostHeader: 'blog.example.test',
      adminUsername: 'wordpress-admin',
      passwordConfigured: true,
      timeoutMs: 16000,
      loginTimeoutMs: 4000,
      availabilityTtlMs: 70000,
    });
    expect(service.readLokiProfile()).toEqual({
      transportEnabled: true,
      httpRequestPushEnabled: false,
      queryConfigured: true,
      host: 'https://loki-push.example.test',
      queryHost: 'https://loki-query.example.test',
      environment: 'production',
      tenantId: '',
      username: 'loki-user',
      passwordConfigured: true,
    });
    expect(service.readQqbotProfile()).toEqual({
      reverseWsPath: '/qqbot/reverse',
      reverseWsToken: 'qq***en',
      napcatRoot: '/vol1/docker/napcat',
      napcatContainerMode: 'ssh',
      napcatSshTarget: 'nas',
      napcatSshPort: 2202,
      napcatSshKeyPath: '/home/kt/.ssh/napcat',
      napcatReverseWsBase: 'ws://api.example.test/onebot',
      napcatWebuiBaseUrl: 'http://127.0.0.1:6099',
      napcatWebuiToken: 'na***en',
    });
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
  RuntimeEvidenceInput,
  RuntimeEvidenceRecord,
} from './runtime-evidence.types';

const REDACTED_VALUE = '<redacted>';
const SENSITIVE_KEY_PATTERN =
  /password|secret|token|authorization|cookie|privateKey|sshKey|ticket|randstr|replyText/i;
const SENSITIVE_TEXT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\b(Authorization)\s*[:=]\s*Bearer\s+[^\s,;]+/gi, '$1=<redacted>'],
  [/\b(Cookie)\s*[:=]\s*[^\s,;]+/gi, '$1=<redacted>'],
  [/\b(ticket|randstr|token|replyText)\s*=\s*[^\s,;&]+/gi, '$1=<redacted>'],
];

@Injectable()
export class RuntimeEvidenceService {
  createRecord(input: RuntimeEvidenceInput): RuntimeEvidenceRecord {
    const startedAt = input.startedAt ?? new Date();
    const endedAt = input.endedAt ?? new Date();
    const record: RuntimeEvidenceRecord = {
      ...input,
      startedAt,
      endedAt,
      durationMs: Math.max(0, endedAt.getTime() - startedAt.getTime()),
      schemaVersion: 1,
    };

    return this.sanitizeValue(record) as RuntimeEvidenceRecord;
  }

  private sanitizeValue(value: unknown): unknown {
    if (value instanceof Date) return value;
    if (typeof value === 'string') return this.sanitizeText(value);
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeValue(item));
    }
    if (!this.isPlainRecord(value)) {
      return value;
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        this.isSensitiveKey(key) ? REDACTED_VALUE : this.sanitizeValue(item),
      ]),
    );
  }

  private sanitizeText(value: string) {
    return SENSITIVE_TEXT_REPLACEMENTS.reduce(
      (text, [pattern, replacement]) => text.replace(pattern, replacement),
      value,
    );
  }

  private isPlainRecord(value: unknown): value is Record<string, unknown> {
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    );
  }

  private isSensitiveKey(key: string) {
    return SENSITIVE_KEY_PATTERN.test(key);
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
        ['password']: 'plain-password',
        data: {
          ['token']: 'raw-token',
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
import type { RuntimeSafeConfigSnapshot } from '../../src/runtime/config/runtime-config.types';

function createSnapshot(
  checks: RuntimeSafeConfigSnapshot['checks'],
): RuntimeSafeConfigSnapshot {
  return {
    app: { nodeEnv: 'test', port: 48085 },
    database: {
      host: 'mysql',
      port: 3306,
      database: 'kt',
      username: 'root',
      synchronize: false,
    },
    loki: {
      transportEnabled: true,
      httpRequestPushEnabled: true,
      queryConfigured: true,
      host: 'https://loki-push.example.test',
      queryHost: 'https://loki-query.example.test',
      environment: 'test',
      tenantId: 'kt',
      username: 'loki-user',
      passwordConfigured: true,
    },
    minio: {
      endpoint: 'minio',
      port: 9000,
      useSSL: false,
      accessKey: 'mi***ey',
      bucket: 'kt-template-online',
    },
    wordpress: {
      baseUrl: 'https://blog.example.test',
      hostHeader: 'blog.example.test',
      adminUsername: 'wordpress-admin',
      passwordConfigured: true,
      timeoutMs: 15000,
      loginTimeoutMs: 3000,
      availabilityTtlMs: 60000,
    },
    qqbot: {
      reverseWsPath: '/qqbot/onebot/reverse',
      reverseWsToken: 'qq***en',
      napcatRoot: '/vol1/docker/napcat',
      napcatContainerMode: 'ssh',
      napcatSshTarget: 'nas',
      napcatSshPort: 2202,
      napcatSshKeyPath: '/home/kt/.ssh/napcat',
      napcatReverseWsBase: 'ws://api.example.test/onebot',
      napcatWebuiBaseUrl: 'http://127.0.0.1:6099',
      napcatWebuiToken: 'na***en',
    },
    checks,
  };
}

function createService(snapshot: RuntimeSafeConfigSnapshot) {
  return new RuntimeHealthService({
    getSafeSnapshot: jest.fn(() => snapshot),
  } as any);
}

describe('RuntimeHealthService', () => {
  it('returns ready when required and optional checks are present', () => {
    const service = createService(
      createSnapshot([
        { key: 'DB_HOST', level: 'required', present: true },
        { key: 'MINIO_ENDPOINT', level: 'optional', present: true },
      ]),
    );

    expect(service.getRuntimeHealth()).toEqual(
      expect.objectContaining({
        service: 'kt-template-online-api',
        status: 'ready',
      }),
    );
  });

  it('returns blocked when required config is missing', () => {
    const service = createService(
      createSnapshot([
        {
          key: 'DB_PASSWORD',
          level: 'required',
          present: false,
          message: 'DB_PASSWORD is not configured',
        },
        { key: 'MINIO_ENDPOINT', level: 'optional', present: true },
      ]),
    );

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

  it('returns degraded when only optional config is missing', () => {
    const service = createService(
      createSnapshot([
        { key: 'DB_HOST', level: 'required', present: true },
        {
          key: 'LOKI_PASSWORD',
          level: 'optional',
          present: false,
          message: 'LOKI_PASSWORD is not configured',
        },
      ]),
    );

    const report = service.getRuntimeHealth();

    expect(report.status).toBe('degraded');
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: 'config:LOKI_PASSWORD',
        status: 'degraded',
        critical: false,
      }),
    );
  });
});
```

- [ ] Add `test/runtime/runtime-health.controller.spec.ts`:

```ts
import { RuntimeHealthController } from '../../src/runtime/health/runtime-health.controller';
import type { RuntimeHealthReport } from '../../src/runtime/health/runtime-health.types';

describe('RuntimeHealthController', () => {
  it('returns the runtime health report from the service', () => {
    const report: RuntimeHealthReport = {
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
        loki: {
          transportEnabled: false,
          httpRequestPushEnabled: false,
          queryConfigured: false,
          host: '',
          queryHost: '',
          environment: 'test',
          tenantId: '',
          username: '',
          passwordConfigured: false,
        },
        minio: {
          endpoint: 'minio',
          port: 9000,
          useSSL: false,
          accessKey: 'mi***ey',
          bucket: 'kt-template-online',
        },
        wordpress: {
          baseUrl: 'https://blog.example.test',
          hostHeader: 'blog.example.test',
          adminUsername: 'wordpress-admin',
          passwordConfigured: true,
          timeoutMs: 15000,
          loginTimeoutMs: 3000,
          availabilityTtlMs: 60000,
        },
        qqbot: {
          reverseWsPath: '/qqbot/onebot/reverse',
          reverseWsToken: 'qq***en',
          napcatRoot: '/vol1/docker/napcat',
          napcatContainerMode: 'ssh',
          napcatSshTarget: 'nas',
          napcatSshPort: 2202,
          napcatSshKeyPath: '/home/kt/.ssh/napcat',
          napcatReverseWsBase: 'ws://api.example.test/onebot',
          napcatWebuiBaseUrl: 'http://127.0.0.1:6099',
          napcatWebuiToken: 'na***en',
        },
        checks: [],
      },
    };
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
git add src/runtime src/app.module.ts src/main.ts test/runtime docs/superpowers/plans/2026-06-13-api-runtime-foundation.md
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
