import { FeishuDocuments } from './client';

/**
 * 将独立飞书读写操作接入现有插件宿主，权限与命令调度继续由平台执行。
 * @param options - 清单、私有配置及受控 HTTP 能力。
 * @returns 飞书插件实例，不依赖人格、市场或其他文档插件。
 * @throws 宿主未提供 HTTP 或命令参数格式错误时拒绝执行。
 */
export function createPlugin(options: {
  host: Record<string, any>;
  manifest: {
    pluginKey: string;
    name: string;
    version: string;
    description?: string;
    operations: Array<{ key: string; handlerName: string }>;
  };
  runtime: { configSnapshot: Record<string, string | undefined> };
}) {
  if (typeof options.host.requestResponse !== 'function')
    throw new Error('飞书文档 HTTP 能力未接线。');
  const client = new FeishuDocuments(
    options.runtime.configSnapshot,
    options.host.requestResponse,
  );
  return {
    key: options.manifest.pluginKey,
    name: options.manifest.name,
    version: options.manifest.version,
    description: options.manifest.description,
    operations: options.manifest.operations.map((operation) => ({
      ...operation,
      execute: async (input: Record<string, any>) => {
        let value = input;
        if (input.raw) {
          try {
            value = JSON.parse(input.raw);
          } catch {
            throw new Error(
              '命令参数使用 JSON，例如 /飞书读取 {"url":"飞书链接"}。',
            );
          }
        }
        if (!value || Array.isArray(value) || typeof value !== 'object')
          throw new Error('文档参数必须是 JSON 对象。');
        if (operation.handlerName === 'readDocument') return client.read(value);
        if (operation.handlerName === 'editDocument') return client.edit(value);
        throw new Error('飞书文档操作未实现。');
      },
    })),
  };
}
