import { NatmapPortApplication } from './application/natmap-port-application';
import type { NatmapPortPluginHost } from './infrastructure/integration/natmap-port-host';
import { createNatmapPortQueryOperation } from './operations/query-current-port';

type NatmapPortManifest = {
  description?: string;
  legacyAliases?: string[];
  name: string;
  operations: Array<Parameters<typeof createNatmapPortQueryOperation>[1]>;
  pluginKey: string;
  version: string;
};

type NatmapPortPluginOptions = {
  host: Record<string, unknown>;
  manifest: NatmapPortManifest & { key?: string };
};

/**
 * 创建只读 NATMap 命令插件，并仅通过动态 Host 桥获取脱敏端点快照。
 * @param options - Worker 提供的已校验清单与受控 Host 外观。
 * @returns 包含单一查询操作和无副作用健康检查的插件实例。
 */
export function createPlugin(options: NatmapPortPluginOptions) {
  const host = createNatmapPortHost(options.host);
  const application = new NatmapPortApplication(host);
  return {
    description: options.manifest.description,
    healthCheck: async () => ({
      checkedAt: new Date().toISOString(),
      message: 'NATMap 只读插件已加载',
      status: 'healthy',
    }),
    key: options.manifest.pluginKey || options.manifest.key || 'natmap-port',
    legacyKeys: options.manifest.legacyAliases || [],
    name: options.manifest.name,
    operations: options.manifest.operations.map((operation) =>
      createNatmapPortQueryOperation(application, operation),
    ),
    version: options.manifest.version,
  };
}

/**
 * 把 worker 的动态 Host 外观收窄为 NATMap 插件唯一需要的只读方法。
 * @param host - Plugin Platform 注入的动态 Host 对象。
 * @returns 只能列出脱敏 NATMap 端点的宿主端口。
 */
function createNatmapPortHost(
  host: Record<string, unknown>,
): NatmapPortPluginHost {
  return {
    resolveNatmapEndpoint: async (input) =>
      await callNatmapPortHost(host, 'resolveNatmapEndpoint', input),
  };
}

/**
 * 调用精确 Host 方法并拒绝缺失能力，错误正文只由应用层统一转换为安全提示。
 * @param host - Plugin Platform 注入的动态 Host 对象。
 * @param method - 本插件允许调用的只读 Host 方法名。
 * @param input - 只携带已通过本地校验的可选通道选择器。
 * @returns Host 返回的未知快照载荷。
 * @throws Host 方法缺失时抛出稳定错误。
 */
async function callNatmapPortHost(
  host: Record<string, unknown>,
  method: 'resolveNatmapEndpoint',
  input: { selector: string },
) {
  const fn = host[method];
  if (typeof fn !== 'function') {
    throw new Error('NATMap 插件 Host 能力不可用');
  }
  return await fn(input);
}
