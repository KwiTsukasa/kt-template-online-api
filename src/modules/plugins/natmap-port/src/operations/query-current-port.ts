import type { NatmapPortApplication } from '../application/natmap-port-application';

type NatmapPortManifestOperation = {
  aliases?: string[];
  description?: string;
  handlerName: string;
  inputSchema?: Record<string, unknown>;
  key: string;
  name: string;
  outputSchema?: Record<string, unknown>;
  timeoutMs?: number;
};

/**
 * 把清单中的唯一查询能力绑定到应用服务，未识别 handler 时立即拒绝启动而不是静默缺失命令。
 * @param application - 已注入受控 Host 的 NATMap 查询应用。
 * @param operation - 从 `plugin.json` 解析得到的操作定义。
 * @returns 保留清单元数据并绑定执行函数的运行态操作。
 * @throws handler 不是 `queryCurrentPort` 时抛出能力未实现错误。
 */
export function createNatmapPortQueryOperation(
  application: NatmapPortApplication,
  operation: NatmapPortManifestOperation,
) {
  if (operation.handlerName !== 'queryCurrentPort') {
    throw new Error(`NATMap 插件能力未实现：${operation.handlerName}`);
  }
  return {
    aliases: operation.aliases || [],
    description: operation.description,
    execute: async (input: Record<string, unknown>) => application.query(input),
    inputSchema: operation.inputSchema,
    key: operation.key,
    name: operation.name,
    outputSchema: operation.outputSchema,
    timeoutMs: operation.timeoutMs,
  };
}
