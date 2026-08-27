import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DictService } from '../../../src/modules/admin/platform-config/dict/dict.service';
import { NetworkPortForward } from '../../../src/modules/admin/platform-config/network-management/infrastructure/persistence/network-management.entity';
import type { PluginPermission } from '../../../src/modules/plugin-platform/domain/manifest';
import { PluginHostBridgeService } from '../../../src/modules/plugin-platform/infrastructure/integration/runtime/plugin-host-bridge.service';
import { PluginHttpClientService } from '../../../src/modules/plugin-platform/infrastructure/integration/sdk/plugin-http-client.service';
import type { PluginPackageDescriptor } from '../../../src/modules/plugin-platform/infrastructure/integration/package/plugin-package.types';
import type { Repository } from 'typeorm';

describe('plugin protocol host bridge', () => {
  let tempRoot: string;
  let bridge: PluginHostBridgeService;
  const httpClient = {
    requestBuffer: jest.fn(),
    requestJson: jest.fn().mockResolvedValue({ ok: true }),
    resolveRedirect: jest.fn(),
  };
  const networkRepository = {
    find: jest.fn(),
  };

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'plugin-host-'));
    const dictService = {
      getDictByKey: jest.fn(),
      getDictItemsByKey: jest.fn(),
      relationTree: jest.fn(),
    } as unknown as DictService;
    bridge = new PluginHostBridgeService(
      dictService,
      httpClient as unknown as PluginHttpClientService,
      networkRepository as unknown as Repository<NetworkPortForward>,
    );
  });

  afterEach(() => {
    rmSync(tempRoot, { force: true, recursive: true });
    jest.clearAllMocks();
  });

  it('rejects file reads that escape the plugin package root', async () => {
    await expect(
      bridge.handleHostCall(createDescriptor(), {
        args: { path: '../escape.json' },
        method: 'readJsonFile',
        pluginKey: 'sample',
      }),
    ).resolves.toEqual({
      message: 'Plugin host file path must stay inside the package root',
      ok: false,
    });
  });

  it('delegates protocol-neutral HTTP calls to the controlled client', async () => {
    const options = {
      context: 'sample call',
      url: 'https://example.test/data',
    };
    await expect(
      bridge.handleHostCall(createDescriptor(), {
        args: { options },
        method: 'requestJson',
        pluginKey: 'sample',
      }),
    ).resolves.toEqual({ ok: true, value: { ok: true } });
    expect(httpClient.requestJson).toHaveBeenCalledWith(options);
  });

  it('reads package-owned JSON without exposing adapter services', async () => {
    mkdirSync(join(tempRoot, 'data'), { recursive: true });
    writeFileSync(join(tempRoot, 'data', 'sample.json'), '{"enabled":true}\n');
    await expect(
      bridge.handleHostCall(createDescriptor(), {
        args: { path: 'data/sample.json' },
        method: 'readJsonFile',
        pluginKey: 'sample',
      }),
    ).resolves.toEqual({ ok: true, value: { enabled: true } });
  });

  it('rejects NATMap reads unless the manifest declares the exact permission', async () => {
    await expect(
      bridge.handleHostCall(createDescriptor(), {
        args: {},
        method: 'resolveNatmapEndpoint',
        pluginKey: 'sample',
      }),
    ).resolves.toEqual({
      message: '插件缺少宿主权限：network.endpoint.read',
      ok: false,
    });
    expect(networkRepository.find).not.toHaveBeenCalled();
  });

  it('resolves one named channel without exposing addresses or the remaining name catalog', async () => {
    networkRepository.find.mockResolvedValue([
      createNatmapMapping({
        currentObservedAt: new Date('2026-08-27T00:00:00.000Z'),
        currentPublicIpv4: '203.0.113.8',
        currentPublicPort: 45_678,
        currentValidUntil: new Date('2099-01-01T00:00:00.000Z'),
        id: '1',
        name: '  Gitea\nSSH  ',
      }),
      createNatmapMapping({
        currentObservedAt: new Date('2026-08-26T00:00:00.000Z'),
        currentPublicIpv4: '203.0.113.9',
        currentPublicPort: 54_321,
        currentValidUntil: new Date('2000-01-01T00:00:00.000Z'),
        id: '2',
        name: '旧通道',
      }),
    ]);

    const current = await bridge.handleHostCall(
      createDescriptor(['network.endpoint.read']),
      {
        args: { selector: 'Gitea SSH' },
        method: 'resolveNatmapEndpoint',
        pluginKey: 'sample',
      },
    );

    expect(current).toEqual({
      ok: true,
      value: {
        endpoint: {
          label: 'Gitea SSH',
          observedAt: '2026-08-27T00:00:00.000Z',
          publicPort: 45_678,
          status: 'current',
          validUntil: '2099-01-01T00:00:00.000Z',
        },
        kind: 'found',
      },
    });
    const stale = await bridge.handleHostCall(
      createDescriptor(['network.endpoint.read']),
      {
        args: { selector: '旧通道' },
        method: 'resolveNatmapEndpoint',
        pluginKey: 'sample',
      },
    );
    expect(stale).toEqual({
      ok: true,
      value: {
        endpoint: {
          label: '旧通道',
          observedAt: '2026-08-26T00:00:00.000Z',
          publicPort: null,
          status: 'stale',
          validUntil: null,
        },
        kind: 'found',
      },
    });
    expect(JSON.stringify([current, stale])).not.toContain('203.0.113');
    expect(JSON.stringify([current, stale])).not.toContain('targetIpv4');
  });

  it('uses a generic label for the unique default channel', async () => {
    networkRepository.find.mockResolvedValue([
      createNatmapMapping({
        currentObservedAt: new Date('2026-08-27T00:00:00.000Z'),
        currentPublicIpv4: '203.0.113.8',
        currentPublicPort: 45_678,
        currentValidUntil: new Date('2099-01-01T00:00:00.000Z'),
        name: 'NAS root 192.168.31.224',
      }),
    ]);

    const result = await bridge.handleHostCall(
      createDescriptor(['network.endpoint.read']),
      {
        args: { selector: '' },
        method: 'resolveNatmapEndpoint',
        pluginKey: 'sample',
      },
    );

    expect(result).toEqual({
      ok: true,
      value: {
        endpoint: expect.objectContaining({ label: '默认通道' }),
        kind: 'found',
      },
    });
    expect(JSON.stringify(result)).not.toContain('192.168.31.224');
    expect(JSON.stringify(result)).not.toContain('NAS root');
  });

  it('returns only a count for multiple channels and rejects topology-shaped selectors', async () => {
    networkRepository.find.mockResolvedValue([
      createNatmapMapping({ id: '1', name: 'NAS root' }),
      createNatmapMapping({ id: '2', name: 'Router SSH' }),
    ]);

    const ambiguous = await bridge.handleHostCall(
      createDescriptor(['network.endpoint.read']),
      {
        args: { selector: '' },
        method: 'resolveNatmapEndpoint',
        pluginKey: 'sample',
      },
    );

    expect(ambiguous).toEqual({
      ok: true,
      value: { channelCount: 2, kind: 'ambiguous' },
    });
    expect(JSON.stringify(ambiguous)).not.toContain('NAS root');
    expect(JSON.stringify(ambiguous)).not.toContain('Router SSH');

    await expect(
      bridge.handleHostCall(createDescriptor(['network.endpoint.read']), {
        args: { selector: '192.168.31.224:22' },
        method: 'resolveNatmapEndpoint',
        pluginKey: 'sample',
      }),
    ).resolves.toEqual({
      message: 'NATMap 通道选择器无效',
      ok: false,
    });
  });

  it('normalizes repository errors before they cross the worker boundary', async () => {
    networkRepository.find.mockRejectedValue(
      new Error('mysql://secret@internal:3306 connection refused'),
    );

    await expect(
      bridge.handleHostCall(createDescriptor(['network.endpoint.read']), {
        args: {},
        method: 'resolveNatmapEndpoint',
        pluginKey: 'sample',
      }),
    ).resolves.toEqual({
      message: 'NATMap 只读状态查询失败',
      ok: false,
    });
  });

  /**
   * 构造仅声明协议中立能力的测试插件描述。
   * @returns 临时包目录绑定的插件描述。
   */
  function createDescriptor(
    permissions: PluginPermission[] = [],
  ): PluginPackageDescriptor {
    return {
      entry: 'src/index.ts',
      entryFile: join(tempRoot, 'src', 'index.ts'),
      manifest: {
        assets: [],
        configSchema: {},
        entry: 'src/index.ts',
        events: [],
        key: 'sample',
        legacyAliases: [],
        migrations: [],
        minApiSdkVersion: '1.0.0',
        name: 'Sample',
        operations: [],
        permissions,
        pluginKey: 'sample',
        runtime: {
          configKeys: [],
          maxConcurrency: 1,
          memoryMb: 128,
          timeoutMs: 5000,
          workerType: 'thread',
        },
        tasks: [],
        version: '1.0.0',
      },
      packageRoot: tempRoot,
      pluginKey: 'sample',
    };
  }

  /**
   * 构造当前同步且 NATMap 活动的 TCP 通道，允许测试仅覆盖需要改变的租约字段。
   * @param input - 覆盖默认端点身份、名称、端口和时间的字段。
   * @returns 满足 Host 只读筛选条件的网络映射。
   */
  function createNatmapMapping(
    input: Partial<NetworkPortForward>,
  ): NetworkPortForward {
    return {
      currentObservedAt: null,
      currentPublicIpv4: null,
      currentPublicPort: null,
      currentValidUntil: null,
      desiredPresence: 'present',
      id: '1',
      isDeleted: false,
      name: 'NATMap',
      natmapDesiredEnabled: true,
      natmapStatus: 'active',
      protocol: 'tcp',
      syncStatus: 'synced',
      ...input,
    } as NetworkPortForward;
  }
});
