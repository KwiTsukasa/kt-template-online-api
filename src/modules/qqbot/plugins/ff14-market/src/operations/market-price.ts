import type { Ff14MarketApplication } from '../application/ff14-market-application';

export const ff14MarketPriceHandlerName = 'getPrice';

export function createFf14MarketPriceOperation(
  application: Ff14MarketApplication,
) {
  return {
    execute: (input: Record<string, any>) => application.getPrice(input),
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
