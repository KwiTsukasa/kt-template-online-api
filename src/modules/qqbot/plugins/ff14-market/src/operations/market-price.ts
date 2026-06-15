import type { Ff14MarketApplication } from '../application/ff14-market-application';

export const ff14PricePriceHandlerName = 'getPrice';

export function createFf14MarketPriceOperation(
  application: Ff14MarketApplication,
) {
  return {
    execute: async (input: Record<string, any>) => {
      const raw = `${input.raw ?? input.text ?? ''}`.trim();
      const parsed = raw ? await application.parsePriceInput(raw) : {};
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

function removeEmpty(input: Record<string, any>) {
  return Object.entries(input).reduce<Record<string, any>>(
    (result, [key, value]) => {
      if (value !== undefined && value !== '') result[key] = value;
      return result;
    },
    {},
  );
}
