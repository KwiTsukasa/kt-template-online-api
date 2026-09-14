import { TencentDocuments } from './client';

/**
 * 将腾讯文档独立适配器接入平台，权限和调度仍由宿主统一执行。
 * @param options - 清单、令牌配置及受控 HTTP 能力。
 * @returns 不依赖飞书、人格或市场插件的操作实例。
 * @throws 宿主能力缺失或命令参数格式错误时拒绝执行。
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
    throw new Error('腾讯文档 HTTP 能力未接线。');
  const client = new TencentDocuments(
    options.runtime.configSnapshot.TENCENT_DOCS_TOKEN,
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
              '命令参数使用 JSON，例如 /腾讯文档读取 {"url":"腾讯文档链接"}。',
            );
          }
        }
        if (!value || Array.isArray(value) || typeof value !== 'object')
          throw new Error('文档参数必须是 JSON 对象。');
        if (operation.handlerName === 'readDocument') return client.read(value);
        if (operation.handlerName === 'editDocument') return client.edit(value);
        throw new Error('腾讯文档操作未实现。');
      },
    })),
  };
}
