import { Ff14MarketApplication } from './application/ff14-market-application';
import { Ff14MarketClient } from './infrastructure/integration/ff14-market-client';
import {
  buildFf14MarketOperations,
  type Ff14MarketManifest,
} from './operations';

type Ff14MarketPluginOptions = {
  host: import('./infrastructure/integration/ff14-market-client').Ff14MarketPluginHost;
  manifest: Ff14MarketManifest;
  normalizeError?: (error: unknown, fallback: string) => string;
  now?: () => Date;
};

/**
 * 创建 FF14 市场插件对象或配置。
 * @param options - FF14 市场列表；使用 `host`、`manifest`、`now`、`normalizeError` 字段生成结果。
 */
export function createPlugin(options: Ff14MarketPluginOptions) {
  const application = new Ff14MarketApplication(
    new Ff14MarketClient(options.host),
  );

  return {
    description: options.manifest.description,
    /**
     * 执行 FF14 市场回调。
     */
    healthCheck: async () => {
      const checkedAt = formatFf14CheckedAt(options.now?.() || new Date());
      try {
        await application.checkHealth();
        return {
          checkedAt,
          message: 'FF14 插件可用',
          status: 'healthy',
        };
      } catch (error) {
        return {
          checkedAt,
          message:
            options.normalizeError?.(error, 'FF14 插件不可用') || `${error}`,
          status: 'degraded',
        };
      }
    },
    key: options.manifest.pluginKey,
    legacyKeys: options.manifest.legacyAliases,
    name: options.manifest.name,
    operations: buildFf14MarketOperations(
      application,
      options.manifest.operations,
    ),
    version: options.manifest.version,
  };
}

/**
 * 转换 FF14 市场插件输入。
 * @param date - date 输入；执行 `date.getFullYear()`、`date.getMonth()`、`date.getDate()`、`date.getHours()` 对应的 FF14 市场步骤。
 */
function formatFf14CheckedAt(date: Date) {
  /**
   * 补齐 FF14 市场插件展示文本。
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
