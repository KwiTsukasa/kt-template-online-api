import type { Ff14MarketPluginHost } from '../infrastructure/integration/ff14-market-client';

export type Ff14MarketConfig = {
  universalisBaseUrl: string;
  xivapiBaseUrl: string;
  xivapiChsBaseUrl: string;
};

/**
 * 从`host`解析Ff14市场数据配置；从 `host.getConfig` 读取Ff14市场数据配置。
 * @param host - 可能包含认证信息或端口的外部服务地址。
 * @returns 包含 `universalisBaseUrl`、`xivapiBaseUrl`、`xivapiChsBaseUrl` 字段的Ff14市场数据配置。
 */
export function resolveFf14MarketConfig(
  host: Ff14MarketPluginHost,
): Ff14MarketConfig {
  return {
    universalisBaseUrl:
      host.getConfig<string>('FF14_UNIVERSALIS_BASE_URL') ||
      'https://universalis.app/api/v2',
    xivapiBaseUrl:
      host.getConfig<string>('FF14_XIVAPI_BASE_URL') ||
      'https://v2.xivapi.com/api',
    xivapiChsBaseUrl:
      host.getConfig<string>('FF14_XIVAPI_CHS_BASE_URL') ||
      'https://xivapi-v2.xivcdn.com/api',
  };
}
