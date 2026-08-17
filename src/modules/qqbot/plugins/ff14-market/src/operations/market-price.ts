import type { Ff14MarketApplication } from '../application/ff14-market-application';

export const ff14PricePriceHandlerName = 'getPrice';

/**
 * 根据`application`构造Ff14市场数据Price操作。
 * @param application - 用于Ff14市场数据Price操作的领域对象，包含 `parsePriceInput`、`getPrice` 字段。
 * @returns 包含 `execute`、`inputSchema`、`outputSchema` 字段的Ff14市场数据Price操作。
 */
export function createFf14MarketPriceOperation(
  application: Ff14MarketApplication,
) {
  return {
    execute: async (input: Record<string, any>) => {
      const raw = `${input.raw ?? input.text ?? ''}`.trim();
      const parsed = await (async () => {
        if (raw) {
          return await application.parsePriceInput(raw);
        }
        return {};
      })();
      return application.getPrice(removeEmpty({ ...input, ...parsed }));
    },
    inputSchema: {
      properties: {
        dataCenter: { description: '大区名，如陆行鸟', type: 'string' },
        hq: { description: '是否只查 HQ', type: 'boolean' },
        item: { description: '物品名称或 ID', type: 'string' },
        itemId: { description: '物品 ID', type: 'number' },
        language: { default: 'chs', type: 'string' },
        region: { description: '地区名，如中国', type: 'string' },
        world: { description: '小区/服务器名，如红玉海', type: 'string' },
      },
      required: ['item'],
      type: 'object',
    },
    outputSchema: {
      properties: {
        averagePrice: { type: 'number' },
        minPrice: { type: 'number' },
        replyText: { type: 'string' },
        world: { type: 'string' },
      },
      type: 'object',
    },
  };
}

/**
 * 按`input`移除针对FF14 市场插件。
 * @param input - 用于针对FF14 市场插件的结构化输入。
 * @returns 针对FF14 市场插件。
 */
function removeEmpty(input: Record<string, any>) {
  return Object.entries(input).reduce<Record<string, any>>(
    (result, [key, value]) => {
      if (value !== undefined && value !== '') result[key] = value;
      return result;
    },
    {},
  );
}
