import type { Ff14MarketPluginHost } from '../infrastructure/integration/ff14-market-client';

export type Ff14MarketConfig = {
  universalisBaseUrl: string;
  xivapiBaseUrl: string;
  xivapiChsBaseUrl: string;
};

/**
 * 解析Ff14 Market Config。
 * @param host - host 输入；使用 `getConfig` 字段生成结果。
 * @returns FF14 市场插件转换后的值。
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
