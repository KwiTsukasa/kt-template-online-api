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

export function createPlugin(options: Ff14MarketPluginOptions) {
  const application = new Ff14MarketApplication(
    new Ff14MarketClient(options.host),
  );

  return {
    description: options.manifest.description,
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

function formatFf14CheckedAt(date: Date) {
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
