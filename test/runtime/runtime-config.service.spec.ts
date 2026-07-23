import { ConfigService } from '@nestjs/config';
import { ToolsService } from '../../src/common';
import { RuntimeConfigService } from '../../src/runtime/config/runtime-config.service';

/**
 * 创建 运行态健康检查对象或配置。
 * @param values - 配置值字典；构造 Jest mock 返回值。
 */
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
      timezone: '+08:00',
    });
  });

  it('surfaces DB_TIMEZONE in the safe runtime database profile and config checks', () => {
    const service = createService({
      DB_HOST: '127.0.0.1',
      DB_PORT: '3307',
      DB_DATABASE: 'kt',
      DB_USERNAME: 'admin',
      DB_TIMEZONE: 'Z',
    });

    expect(service.readDatabaseProfile()).toEqual(
      expect.objectContaining({
        timezone: 'Z',
      }),
    );
    expect(service.getConfigChecks()).toContainEqual(
      expect.objectContaining({
        key: 'DB_TIMEZONE',
        level: 'optional',
        present: true,
      }),
    );
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
    const snapshotJson = JSON.stringify(snapshot);
    const adminSecretCheck = snapshot.checks.find(
      (check) => check.key === 'ADMIN_TOKEN_SECRET',
    );

    expect(service.maskSecret('abcdef123456')).toBe('ab***56');
    expect(service.maskSecret('')).toBe('');
    expect(service.maskSecret('abcd')).toBe('****');
    expect(adminSecretCheck).toEqual(
      expect.objectContaining({
        present: true,
        maskedValue: 'ab***56',
      }),
    );
    expect(snapshotJson).not.toContain('abcdef123456');
    expect(snapshotJson).not.toContain('password-value');
    expect(snapshotJson).not.toContain('minio-access-key');
    expect(snapshotJson).not.toContain('wordpress-password');
    expect(snapshotJson).not.toContain('loki-password');
    expect(snapshotJson).not.toContain('qq-reverse-token');
    expect(snapshotJson).not.toContain('napcat-webui-token');
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
      QQBOT_NAPCAT_IMAGE: 'mlikiowa/napcat-docker:latest',
      QQBOT_NAPCAT_CONTAINER_MODE: 'ssh',
      QQBOT_NAPCAT_SSH_TARGET: 'nas',
      QQBOT_NAPCAT_SSH_PORT: '2202',
      QQBOT_NAPCAT_SSH_KEY_PATH: '/home/kt/.ssh/napcat',
      NAPCAT_LOGIN_HUMAN_VERIFY_EXPIRE_MS: '900000',
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
      napcatImage: 'mlikiowa/napcat-docker:latest',
      napcatContainerMode: 'ssh',
      napcatSshTarget: 'nas',
      napcatSshPort: 2202,
      napcatSshKeyPath: '/home/kt/.ssh/napcat',
      napcatReverseWsBase: 'ws://api.example.test/onebot',
      napcatWebuiBaseUrl: 'http://127.0.0.1:6099',
      napcatWebuiToken: 'na***en',
    });

    const checks = service.getConfigChecks();
    expect(checks).toContainEqual(
      expect.objectContaining({
        key: 'LOKI_HOST|LOKI_URL',
        level: 'optional',
        present: true,
      }),
    );
    expect(checks).toContainEqual(
      expect.objectContaining({
        key: 'QQBOT_NAPCAT_IMAGE',
        level: 'optional',
        present: true,
      }),
    );
    expect(checks).toContainEqual(
      expect.objectContaining({
        key: 'QQBOT_NAPCAT_REVERSE_WS_URL|QQBOT_NAPCAT_REVERSE_WS_BASE',
        level: 'optional',
        present: true,
      }),
    );
    expect(checks).toContainEqual(
      expect.objectContaining({
        key: 'NAPCAT_LOGIN_HUMAN_VERIFY_EXPIRE_MS',
        level: 'optional',
        present: true,
      }),
    );
    expect(checks).toContainEqual(
      expect.objectContaining({
        key: 'NAPCAT_WEBUI_BASE_URL|QQBOT_NAPCAT_WEBUI_URL',
        level: 'optional',
        present: true,
      }),
    );

    const snapshotJson = JSON.stringify(service.getSafeSnapshot());
    expect(snapshotJson).not.toContain('wordpress-password');
    expect(snapshotJson).not.toContain('loki-password');
    expect(snapshotJson).not.toContain('qq-reverse-token');
    expect(snapshotJson).not.toContain('napcat-webui-token');
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
    expect(checks).toContainEqual(
      expect.objectContaining({
        key: 'NETWORK_AGENT_MQTT_URL',
        level: 'required',
        present: false,
        message: 'NETWORK_AGENT_MQTT_URL is not configured',
      }),
    );
  });

  it('requires the complete Network Agent production connection contract', () => {
    const service = createService({
      NETWORK_AGENT_ID: 'nas-main',
      NETWORK_AGENT_TARGET_IPV4: '192.168.31.224',
      NETWORK_AGENT_MQTT_URL: 'mqtt://192.168.31.224:1883',
      NETWORK_AGENT_MQTT_CLIENT_ID: 'kt-template-online-api-network-nas-main',
      NETWORK_AGENT_MQTT_USERNAME: 'network-api',
      NETWORK_AGENT_MQTT_PASSWORD: 'network-api-password',
      NETWORK_AGENT_MQTT_RETRY_MS: '5000',
    });

    const networkChecks = service
      .getConfigChecks()
      .filter((check) => check.key.startsWith('NETWORK_AGENT_'));

    expect(networkChecks).toHaveLength(7);
    expect(networkChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'NETWORK_AGENT_MQTT_PASSWORD',
          level: 'required',
          present: true,
          maskedValue: 'ne***rd',
        }),
      ]),
    );
    expect(JSON.stringify(networkChecks)).not.toContain('network-api-password');
  });

  it('reports DDNS runtime keys as optional without exposing provider credentials', () => {
    const secretId = 'ddns-id-fixture-123';
    const secretKey = 'ddns-key-fixture-456';
    const service = createService({
      NETWORK_DDNS_DNSPOD_ENABLED: 'true',
      NETWORK_DDNS_DNSPOD_SECRET_ID: secretId,
      NETWORK_DDNS_DNSPOD_SECRET_KEY: secretKey,
      NETWORK_DDNS_RECONCILE_INTERVAL_MS: '60000',
      NETWORK_DDNS_AGENT_IPV6_MAX_AGE_MS: '60000',
    });

    const checks = service
      .getConfigChecks()
      .filter((check) => check.key.startsWith('NETWORK_DDNS_'));
    const serialized = JSON.stringify(checks);

    expect(checks).toHaveLength(5);
    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'NETWORK_DDNS_DNSPOD_ENABLED',
          level: 'optional',
          present: true,
        }),
        expect.objectContaining({
          key: 'NETWORK_DDNS_DNSPOD_SECRET_ID',
          level: 'optional',
          present: true,
        }),
        expect.objectContaining({
          key: 'NETWORK_DDNS_DNSPOD_SECRET_KEY',
          level: 'optional',
          present: true,
        }),
        expect.objectContaining({
          key: 'NETWORK_DDNS_RECONCILE_INTERVAL_MS',
          level: 'optional',
          present: true,
        }),
        expect.objectContaining({
          key: 'NETWORK_DDNS_AGENT_IPV6_MAX_AGE_MS',
          level: 'optional',
          present: true,
        }),
      ]),
    );
    expect(serialized).not.toContain(secretId);
    expect(serialized).not.toContain(secretKey);
  });
});
