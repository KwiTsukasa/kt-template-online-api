import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NatmapPortApplication } from '@/modules/plugins/natmap-port/src/application/natmap-port-application';
import { createPlugin } from '@/modules/plugins/natmap-port/src/index';
import type { NatmapPortPluginHost } from '@/modules/plugins/natmap-port/src/infrastructure/integration/natmap-port-host';
import { parsePluginManifest } from '@/modules/plugin-platform/domain/manifest';

const pluginRoot = join(process.cwd(), 'src/modules/plugins/natmap-port');
const currentEndpoint = {
  label: 'Gitea SSH',
  observedAt: '2026-08-27T00:00:00.000Z',
  publicPort: 45_678,
  status: 'current' as const,
  validUntil: '2026-08-27T00:02:00.000Z',
};

describe('natmap-port plugin', () => {
  it('loads one manifest operation with only the read-only network permission', async () => {
    const manifest = parsePluginManifest(
      JSON.parse(readFileSync(join(pluginRoot, 'plugin.json'), 'utf8')),
      { pluginRoot },
    );
    const resolveNatmapEndpoint = jest.fn().mockResolvedValue({
      endpoint: currentEndpoint,
      kind: 'found',
    });
    const plugin = createPlugin({
      host: { resolveNatmapEndpoint },
      manifest,
    });

    expect(manifest.permissions).toEqual(['network.endpoint.read']);
    expect(manifest.operations).toHaveLength(1);
    expect(manifest.operations[0]).toMatchObject({
      aliases: ['natmap', '动态端口', '公网端口'],
      handlerName: 'queryCurrentPort',
      key: 'natmap.port.current',
      permissions: ['network.endpoint.read'],
      timeoutMs: 3000,
    });

    await expect(plugin.operations[0].execute({ raw: '' })).resolves.toEqual({
      channel: 'Gitea SSH',
      observedAt: currentEndpoint.observedAt,
      publicPort: 45_678,
      replyText: expect.stringContaining('端口：45678'),
      status: 'current',
      validUntil: currentEndpoint.validUntil,
    });
    expect(
      JSON.stringify(await plugin.operations[0].execute({ raw: '' })),
    ).not.toContain('publicIpv4');
  });

  it('returns an explicit empty state without probing any remote system', async () => {
    const application = createApplication({ kind: 'empty' });

    await expect(application.query({ raw: '' })).resolves.toEqual({
      channel: null,
      observedAt: null,
      publicPort: null,
      replyText: '当前没有已启用的 TCP NATMap 通道。',
      status: 'empty',
      validUntil: null,
    });
  });

  it('never returns an expired port', async () => {
    const application = createApplication({
      endpoint: {
        label: 'Gitea SSH',
        observedAt: '2026-08-26T00:00:00.000Z',
        publicPort: null,
        status: 'stale',
        validUntil: null,
      },
      kind: 'found',
    });

    const result = await application.query({ raw: '' });

    expect(result.status).toBe('stale');
    expect(result.publicPort).toBeNull();
    expect(result.validUntil).toBeNull();
    expect(result.replyText).toContain('状态已过期');
    expect(result.replyText).not.toContain('45678');
  });

  it('requires an exact known channel name when multiple channels exist', async () => {
    const second = {
      ...currentEndpoint,
      label: 'Admin HTTPS',
      publicPort: 51_524,
    };
    const resolveNatmapEndpoint = jest.fn(
      async (input: { selector: string }) => {
        if (input.selector === 'Admin HTTPS') {
          return { endpoint: second, kind: 'found' };
        }
        return { channelCount: 2, kind: 'ambiguous' };
      },
    );
    const application = new NatmapPortApplication({ resolveNatmapEndpoint });

    const ambiguous = await application.query({ raw: '' });
    expect(ambiguous.status).toBe('ambiguous');
    expect(ambiguous.publicPort).toBeNull();
    expect(ambiguous.replyText).toBe(
      '检测到 2 个 NATMap 通道，请指定已知通道名称。',
    );

    const selected = await application.query({ raw: 'Admin HTTPS' });
    expect(selected.status).toBe('current');
    expect(selected.channel).toBe('Admin HTTPS');
    expect(selected.publicPort).toBe(51_524);
  });

  it('handles help, sensitive selectors and unknown channels without guessing', async () => {
    const resolveNatmapEndpoint = jest.fn().mockResolvedValue({
      endpoint: currentEndpoint,
      kind: 'found',
    });
    const application = new NatmapPortApplication({ resolveNatmapEndpoint });

    const help = await application.query({ raw: 'help' });
    expect(help.status).toBe('help');
    expect(help.replyText).toContain('/natmap [通道名称]');
    expect(resolveNatmapEndpoint).not.toHaveBeenCalled();

    const invalid = await application.query({ raw: `bad\u0000name` });
    expect(invalid.status).toBe('invalid');
    expect(resolveNatmapEndpoint).not.toHaveBeenCalled();

    const sensitive = await application.query({ raw: '192.168.31.224' });
    expect(sensitive.status).toBe('invalid');
    expect(resolveNatmapEndpoint).not.toHaveBeenCalled();

    resolveNatmapEndpoint.mockResolvedValueOnce({
      channelCount: 1,
      kind: 'not-found',
    });
    const missing = await application.query({ raw: '不存在' });
    expect(missing.status).toBe('not-found');
    expect(missing.publicPort).toBeNull();
  });

  it('normalizes Host failures without exposing raw errors', async () => {
    const host: NatmapPortPluginHost = {
      resolveNatmapEndpoint: jest
        .fn()
        .mockRejectedValue(new Error('mysql://secret@internal:3306 EPIPE')),
    };
    const application = new NatmapPortApplication(host);

    const result = await application.query({ raw: '' });

    expect(result.status).toBe('unavailable');
    expect(result.replyText).toBe('NATMap 实时状态暂不可用，请稍后再试。');
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('3306');
  });

  it('rejects topology-shaped labels even if a compromised Host returns one', async () => {
    const application = createApplication({
      endpoint: { ...currentEndpoint, label: 'NAS 192.168.31.224:22' },
      kind: 'found',
    });

    const result = await application.query({ raw: '' });

    expect(result.status).toBe('unavailable');
    expect(JSON.stringify(result)).not.toContain('192.168.31.224');
    expect(JSON.stringify(result)).not.toContain(':22');
  });
});

/**
 * 创建返回固定解析结果的只读应用实例，避免测试加载 Bot 服务或触发网络访问。
 * @param resolution - 由测试声明的 Host 解析结果。
 * @returns 使用内存 Host 的 NATMap 查询应用。
 */
function createApplication(resolution: unknown) {
  return new NatmapPortApplication({
    resolveNatmapEndpoint: jest.fn().mockResolvedValue(resolution),
  });
}
