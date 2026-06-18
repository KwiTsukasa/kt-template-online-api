import { CaddyReadonlyAdapter } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/adapters/caddy-readonly.adapter';
import { JenkinsReadonlyAdapter } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/adapters/jenkins-readonly.adapter';
import { KubernetesReadonlyAdapter } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/adapters/kubernetes-readonly.adapter';
import { MihomoReadonlyAdapter } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/adapters/mihomo-readonly.adapter';
import { TencentCloudReadonlyAdapter } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/adapters/tencent-cloud-readonly.adapter';
import { WireguardReadonlyAdapter } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/adapters/wireguard-readonly.adapter';
import type {
  EnvironmentReadonlyHttpClient,
  EnvironmentReadonlyHttpResponse,
} from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/adapters/environment-readonly-http.client';
import { EnvironmentDashboardConfigService } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/environment-dashboard-config.service';

type ReadonlyHttpMock = jest.Mocked<EnvironmentReadonlyHttpClient>;

/**
 * Creates a deterministic sanitized HTTP response for readonly adapter tests.
 * @param body - Response body preview returned by the fake HTTP client.
 * @param status - HTTP status code observed by the adapter.
 * @returns HTTP response shaped like EnvironmentReadonlyHttpClient output.
 */
function httpResponse(
  body: unknown,
  status = 200,
): EnvironmentReadonlyHttpResponse {
  return {
    bodyPreview: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    observedAt: '2026-06-18T01:00:00.000Z',
    status,
    statusText: status >= 200 && status < 400 ? 'OK' : 'ERROR',
  };
}

/**
 * Creates a mocked readonly HTTP client exposing only safe GET and HEAD probes.
 * @returns Jest mock for readonly HTTP client methods used by adapters.
 */
function createHttpMock(): ReadonlyHttpMock {
  return {
    get: jest.fn(),
    head: jest.fn(),
    request: jest.fn(),
  } as unknown as ReadonlyHttpMock;
}

describe('environment remote readonly adapters', () => {
  const config = new EnvironmentDashboardConfigService({});

  it.each([
    ['Jenkins', new JenkinsReadonlyAdapter(config)],
    ['K8s', new KubernetesReadonlyAdapter(config)],
    ['Tencent Cloud', new TencentCloudReadonlyAdapter(config)],
    ['Caddy', new CaddyReadonlyAdapter(config)],
    ['WireGuard', new WireguardReadonlyAdapter(config)],
    ['Mihomo', new MihomoReadonlyAdapter(config)],
  ])(
    '%s returns unwired evidence when config is missing',
    async (_, adapter) => {
      const signal = await adapter.inspect();

      expect(signal.status).toBe('unwired');
      expect(signal.sourceKind).toBe('unwired');
      expect(signal.evidence[0].summary).toContain('缺少只读观测配置');
    },
  );

  it('keeps credential keys visible as missing config without exposing values', async () => {
    const tencentSignal = await new TencentCloudReadonlyAdapter(
      config,
    ).inspect();
    const mihomoSignal = await new MihomoReadonlyAdapter(config).inspect();

    expect(tencentSignal.evidence[0].metadata?.missingConfigKeys).toContain(
      'ENV_DASHBOARD_TENCENT_SECRET_KEY',
    );
    expect(mihomoSignal.evidence[0].metadata?.missingConfigKeys).toContain(
      'ENV_DASHBOARD_R4SE_MIHOMO_SECRET',
    );
  });

  it('Jenkins reads the last build API and returns sanitized live evidence', async () => {
    const http = createHttpMock();
    http.get.mockResolvedValue(
      httpResponse({
        building: false,
        duration: 16000,
        number: 42,
        result: 'SUCCESS',
        url: 'https://jenkins.example/job/main/42/',
      }),
    );
    const adapter = new JenkinsReadonlyAdapter(
      new EnvironmentDashboardConfigService({
        ENV_DASHBOARD_JENKINS_JOB: 'KT-Template/KT-Template-API/main',
        ENV_DASHBOARD_JENKINS_TOKEN: 'jenkins-token',
        ENV_DASHBOARD_JENKINS_URL: 'https://jenkins.example',
        ENV_DASHBOARD_JENKINS_USERNAME: 'codex',
      }),
      http,
    );

    const signal = await adapter.inspect();

    expect(http.get).toHaveBeenCalledWith(
      'https://jenkins.example/job/KT-Template/job/KT-Template-API/job/main/lastBuild/api/json',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: expect.stringMatching(/^Basic /),
        }),
      }),
    );
    expect(signal.status).toBe('ok');
    expect(signal.sourceKind).toBe('live');
    expect(signal.evidence[0]).toEqual(
      expect.objectContaining({
        sourceKind: 'live',
        summary: expect.stringContaining('SUCCESS'),
      }),
    );
    expect(JSON.stringify(signal)).not.toContain('jenkins-token');
  });

  it('Kubernetes reads deployment and pod APIs with readonly bearer auth', async () => {
    const http = createHttpMock();
    http.get
      .mockResolvedValueOnce(
        httpResponse({
          spec: { replicas: 2 },
          status: {
            availableReplicas: 2,
            readyReplicas: 2,
            replicas: 2,
            updatedReplicas: 2,
          },
        }),
      )
      .mockResolvedValueOnce(
        httpResponse({
          items: [
            {
              status: {
                conditions: [{ status: 'True', type: 'Ready' }],
                phase: 'Running',
              },
            },
            {
              status: {
                conditions: [{ status: 'True', type: 'Ready' }],
                phase: 'Running',
              },
            },
          ],
        }),
      );
    const adapter = new KubernetesReadonlyAdapter(
      new EnvironmentDashboardConfigService({
        ENV_DASHBOARD_K8S_API_SERVER: 'https://k8s.example',
        ENV_DASHBOARD_K8S_BEARER_TOKEN: 'k8s-token',
        ENV_DASHBOARD_K8S_DEPLOYMENT: 'kt-template-online-api',
        ENV_DASHBOARD_K8S_LABEL_SELECTOR: 'app=kt-template-online-api',
        ENV_DASHBOARD_K8S_NAMESPACE: 'kt-prod',
      }),
      http,
    );

    const signal = await adapter.inspect();

    expect(http.get).toHaveBeenNthCalledWith(
      1,
      'https://k8s.example/apis/apps/v1/namespaces/kt-prod/deployments/kt-template-online-api',
      expect.objectContaining({
        headers: { Authorization: 'Bearer k8s-token' },
      }),
    );
    expect(http.get).toHaveBeenNthCalledWith(
      2,
      'https://k8s.example/api/v1/namespaces/kt-prod/pods',
      expect.objectContaining({
        headers: { Authorization: 'Bearer k8s-token' },
        params: { labelSelector: 'app=kt-template-online-api' },
      }),
    );
    expect(signal.status).toBe('ok');
    expect(signal.evidence[0].metadata).toEqual(
      expect.objectContaining({
        podReadyCount: 2,
        readyReplicas: 2,
      }),
    );
    expect(JSON.stringify(signal)).not.toContain('k8s-token');
  });

  it('Tencent Cloud reads CVM DescribeInstances through the official SDK', async () => {
    const describeInstances = jest.fn().mockResolvedValue({
      InstanceSet: [
        {
          CPU: 2,
          InstanceId: 'ins-test',
          InstanceName: 'api-prod',
          InstanceState: 'RUNNING',
          Memory: 4096,
        },
      ],
      RequestId: 'req-1',
      TotalCount: 1,
    });
    const createClient = jest.fn(() => ({
      DescribeInstances: describeInstances,
    }));
    const adapter = new TencentCloudReadonlyAdapter(
      new EnvironmentDashboardConfigService({
        ENV_DASHBOARD_TENCENT_CLOUD_ENABLED: 'true',
        ENV_DASHBOARD_TENCENT_INSTANCE_ID: 'ins-test',
        ENV_DASHBOARD_TENCENT_REGION: 'ap-guangzhou',
        ENV_DASHBOARD_TENCENT_SECRET_ID: 'secret-id',
        ENV_DASHBOARD_TENCENT_SECRET_KEY: 'secret-key',
      }),
      createClient,
    );

    const signal = await adapter.inspect();

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        credential: {
          secretId: 'secret-id',
          secretKey: 'secret-key',
        },
        region: 'ap-guangzhou',
      }),
    );
    expect(describeInstances).toHaveBeenCalledWith({
      InstanceIds: ['ins-test'],
      Limit: 1,
    });
    expect(signal.status).toBe('ok');
    expect(signal.evidence[0].metadata).toEqual(
      expect.objectContaining({
        instanceState: 'RUNNING',
        totalCount: 1,
      }),
    );
    expect(JSON.stringify(signal)).not.toContain('secret-key');
  });

  it('Caddy checks public HEAD and admin GET without unsafe methods', async () => {
    const http = createHttpMock();
    http.head.mockResolvedValue(httpResponse('', 200));
    http.get.mockResolvedValue(httpResponse({ apps: { http: {} } }, 200));
    const adapter = new CaddyReadonlyAdapter(
      new EnvironmentDashboardConfigService({
        ENV_DASHBOARD_CADDY_ADMIN_URL: 'http://caddy-admin.example',
        ENV_DASHBOARD_CADDY_PUBLIC_URL: 'https://kt.example',
      }),
      http,
    );

    const signal = await adapter.inspect();

    expect(http.head).toHaveBeenCalledWith('https://kt.example');
    expect(http.get).toHaveBeenCalledWith(
      'http://caddy-admin.example/config/',
    );
    expect(signal.status).toBe('ok');
    expect(signal.evidence[0].metadata).toEqual(
      expect.objectContaining({
        adminConfigured: true,
        publicStatus: 200,
      }),
    );
  });

  it('WireGuard checks only configured readonly health endpoints', async () => {
    const http = createHttpMock();
    http.get
      .mockResolvedValueOnce(httpResponse({ status: 'ok' }, 200))
      .mockResolvedValueOnce(httpResponse({ status: 'ok' }, 200));
    const adapter = new WireguardReadonlyAdapter(
      new EnvironmentDashboardConfigService({
        ENV_DASHBOARD_R4SE_WIREGUARD_HEALTH_URL:
          'https://r4se.example/wg/health',
        ENV_DASHBOARD_TENCENT_WIREGUARD_HEALTH_URL:
          'https://tencent.example/wg/health',
      }),
      http,
    );

    const signal = await adapter.inspect();

    expect(http.get).toHaveBeenNthCalledWith(
      1,
      'https://tencent.example/wg/health',
    );
    expect(http.get).toHaveBeenNthCalledWith(
      2,
      'https://r4se.example/wg/health',
    );
    expect(signal.status).toBe('ok');
    expect(signal.evidence[0].metadata).toEqual(
      expect.objectContaining({
        endpointCount: 2,
        reachableCount: 2,
      }),
    );
  });

  it('Mihomo reads version, configs, and proxies without mutating selectors', async () => {
    const http = createHttpMock();
    http.get
      .mockResolvedValueOnce(httpResponse({ version: '1.18.0' }))
      .mockResolvedValueOnce(httpResponse({ mode: 'rule' }))
      .mockResolvedValueOnce(
        httpResponse({ proxies: { DIRECT: {}, Proxy: {} } }),
      );
    const adapter = new MihomoReadonlyAdapter(
      new EnvironmentDashboardConfigService({
        ENV_DASHBOARD_R4SE_MIHOMO_SECRET: 'mihomo-secret',
        ENV_DASHBOARD_R4SE_MIHOMO_URL: 'http://mihomo.example',
      }),
      http,
    );

    const signal = await adapter.inspect();

    expect(http.get).toHaveBeenNthCalledWith(
      1,
      'http://mihomo.example/version',
      expect.objectContaining({
        headers: { Authorization: 'Bearer mihomo-secret' },
      }),
    );
    expect(http.get).toHaveBeenNthCalledWith(
      2,
      'http://mihomo.example/configs',
      expect.objectContaining({
        headers: { Authorization: 'Bearer mihomo-secret' },
      }),
    );
    expect(http.get).toHaveBeenNthCalledWith(
      3,
      'http://mihomo.example/proxies',
      expect.objectContaining({
        headers: { Authorization: 'Bearer mihomo-secret' },
      }),
    );
    expect(http.head).not.toHaveBeenCalled();
    expect(signal.status).toBe('ok');
    expect(signal.evidence[0].metadata).toEqual(
      expect.objectContaining({
        mode: 'rule',
        proxyCount: 2,
        version: '1.18.0',
      }),
    );
    expect(JSON.stringify(signal)).not.toContain('mihomo-secret');
  });

  it('returns degraded error evidence when a configured readonly probe fails', async () => {
    const http = createHttpMock();
    http.get.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const adapter = new JenkinsReadonlyAdapter(
      new EnvironmentDashboardConfigService({
        ENV_DASHBOARD_JENKINS_JOB: 'main',
        ENV_DASHBOARD_JENKINS_URL: 'https://jenkins.example',
      }),
      http,
    );

    const signal = await adapter.inspect();

    expect(signal.status).toBe('degraded');
    expect(signal.sourceKind).toBe('derived');
    expect(signal.evidence[0]).toEqual(
      expect.objectContaining({
        sourceKind: 'derived',
        summary: 'connect ECONNREFUSED',
      }),
    );
  });
});
