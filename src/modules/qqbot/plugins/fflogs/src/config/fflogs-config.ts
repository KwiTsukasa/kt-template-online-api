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
 * 从`host`解析Fflogs配置；从 `host.getConfig` 读取Fflogs配置。
 * @param host - 可能包含认证信息或端口的外部服务地址。
 * @returns 包含 `baseUrl`、`clientId`、`clientSecret`、`graphqlUrl`、`tokenUrl` 字段的Fflogs配置。
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
 * 将`value`规范为BaseURL 地址，使等价输入得到一致表示。
 * @param value - 待转换为BaseURL 地址的原始值。
 * @returns BaseURL 地址。
 */
function normalizeBaseUrl(value: string) {
  return `${value || ''}`.trim().replace(/\/+$/, '');
}
