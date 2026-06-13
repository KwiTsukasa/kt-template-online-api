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
    expect(snapshotJson).not.toContain('wordpress-user');
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
