import { FflogsApplication } from './application/fflogs-application';
import { FflogsClient } from './infrastructure/integration/fflogs-client';
import { buildFflogsOperations, type FflogsManifest } from './operations';

type FflogsPluginOptions = {
  host: import('./infrastructure/integration/fflogs-client').FflogsPluginHost;
  manifest: FflogsManifest;
  normalizeError?: (error: unknown, fallback: string) => string;
  now?: () => Date;
};

/**
 * 创建 FFLogs 插件对象或配置。
 * @param options - FFLogs列表；使用 `host`、`manifest`、`now`、`normalizeError` 字段生成结果。
 */
export function createPlugin(options: FflogsPluginOptions) {
  const application = new FflogsApplication(new FflogsClient(options.host));
  return {
    description: options.manifest.description,
    /**
     * 执行 FFLogs回调。
     */
    healthCheck: async () => {
      const checkedAt = formatFflogsCheckedAt(options.now?.() || new Date());
      try {
        await application.checkHealth();
        return {
          checkedAt,
          message: 'FFLogs 插件可用',
          status: 'healthy',
        };
      } catch (error) {
        return {
          checkedAt,
          message:
            options.normalizeError?.(error, 'FFLogs 插件不可用') || `${error}`,
          status: 'degraded',
        };
      }
    },
    key: options.manifest.pluginKey,
    legacyKeys: options.manifest.legacyAliases,
    name: options.manifest.name,
    operations: buildFflogsOperations(application, options.manifest.operations),
    version: options.manifest.version,
  };
}

/**
 * 转换 FFLogs 插件输入。
 * @param date - date 输入；执行 `date.getFullYear()`、`date.getMonth()`、`date.getDate()`、`date.getHours()` 对应的 FFLogs步骤。
 */
function formatFflogsCheckedAt(date: Date) {
  /**
   * 补齐 FFLogs 插件展示文本。
   * @param input - input 输入；影响 pad 的返回值。
   */
  const pad = (input: number) => `${input}`.padStart(2, '0');
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    ' ',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
    ':',
    pad(date.getSeconds()),
  ].join('');
}
