import { RuntimeHealthController } from '../../src/runtime/health/runtime-health.controller';
import type { RuntimeHealthReport } from '../../src/runtime/health/runtime-health.types';

describe('RuntimeHealthController', () => {
  it('returns the service report and calls the service once', () => {
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
