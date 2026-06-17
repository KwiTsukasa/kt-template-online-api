import type { FflogsPluginHost } from '../infrastructure/integration/fflogs-client';

export type FflogsConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  graphqlUrl: string;
  tokenUrl: string;
  webBaseUrl: string;
};

/**
 * 解析Fflogs Config。
 * @param host - host 输入；使用 `getConfig` 字段生成结果。
 * @returns FFLogs 插件转换后的值。
 */
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
      host.getConfig<string>('FFLOGS_TOKEN_URL') || `${baseUrl}/oauth/token`,
    webBaseUrl,
  };
}

/**
 * 转换 FFLogs 插件输入。
 * @param value - 待转换值；影响 normalizeBaseUrl 的返回值。
 */
function normalizeBaseUrl(value: string) {
  return `${value || ''}`.trim().replace(/\/+$/, '');
}
