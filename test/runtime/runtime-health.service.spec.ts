import { RuntimeHealthService } from '../../src/runtime/health/runtime-health.service';
import type { RuntimeSafeConfigSnapshot } from '../../src/runtime/config/runtime-config.types';

/**
 * 创建 运行态健康检查对象或配置。
 * @param checks - 健康检查项列表；生成 运行态对象。
 * @returns 创建后的 运行态健康检查对象或配置。
 */
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
      napcatImage: 'mlikiowa/napcat-docker:latest',
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

/**
 * 创建 运行态健康检查对象或配置。
 * @param snapshot - snapshot 输入；构造 Jest mock 返回值。
 */
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

    const report = service.getRuntimeHealth();

    expect(report).toEqual(
      expect.objectContaining({
        service: 'kt-template-online-api',
        status: 'ready',
      }),
    );
    expect(report).not.toHaveProperty('config');
    expect(JSON.stringify(report)).not.toContain('mysql');
    expect(JSON.stringify(report)).not.toContain('/vol1/docker/napcat');
    expect(new Date(report.checkedAt).toISOString()).toBe(report.checkedAt);
    expect(report.checks).toContainEqual({
      name: 'process',
      status: 'live',
      critical: true,
      message: 'NestJS process answered runtime health request',
    });
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: 'config:DB_HOST',
        status: 'ready',
        critical: true,
        message: 'DB_HOST is configured',
      }),
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: 'config:MINIO_ENDPOINT',
        status: 'ready',
        critical: false,
        message: 'MINIO_ENDPOINT is configured',
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
        message: 'DB_PASSWORD is not configured',
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
        message: 'LOKI_PASSWORD is not configured',
      }),
    );
  });
});
