import type { FflogsPluginHost } from '../infrastructure/integration/fflogs-client';

export type FflogsConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  graphqlUrl: string;
  tokenUrl: string;
  webBaseUrl: string;
};

export function resolveFflogsConfig(host: FflogsPluginHost): FflogsConfig {
  const webBaseUrl = normalizeBaseUrl(
    host.getConfig<string>('FFLOGS_WEB_BASE_URL') ||
      host.getConfig<string>('FFLOGS_BASE_URL') ||
      'https://cn.fflogs.com',
  );
  const baseUrl = normalizeBaseUrl(
    host.getConfig<string>('FFLOGS_BASE_URL') ||
      webBaseUrl ||
      'https://cn.fflogs.com',
  );

  return {
    baseUrl,
    clientId: `${host.getConfig<string>('FFLOGS_CLIENT_ID') || ''}`.trim(),
    clientSecret: `${
      host.getConfig<string>('FFLOGS_CLIENT_SECRET') || ''
    }`.trim(),
    graphqlUrl:
      host.getConfig<string>('FFLOGS_GRAPHQL_URL') ||
      `${baseUrl}/api/v2/client`,
    tokenUrl:
      host.getConfig<string>('FFLOGS_TOKEN_URL') ||
      `${baseUrl}/oauth/token`,
    webBaseUrl,
  };
}

function normalizeBaseUrl(value: string) {
  return `${value || ''}`.trim().replace(/\/+$/, '');
}
