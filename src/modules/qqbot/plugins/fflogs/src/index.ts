import { FflogsApplication } from './application/fflogs-application';
import { FflogsClient } from './infrastructure/integration/fflogs-client';
import { buildFflogsOperations, type FflogsManifest } from './operations';

type FflogsPluginOptions = {
  host: import('./infrastructure/integration/fflogs-client').FflogsPluginHost;
  manifest: FflogsManifest;
  normalizeError?: (error: unknown, fallback: string) => string;
  now?: () => Date;
};

export function createPlugin(options: FflogsPluginOptions) {
  const application = new FflogsApplication(new FflogsClient(options.host));
  return {
    description: options.manifest.description,
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

function formatFflogsCheckedAt(date: Date) {
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
