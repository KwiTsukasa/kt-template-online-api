import type { Ff14MarketApplication } from '../application/ff14-market-application';

export const ff14PricePriceHandlerName = 'getPrice';

/**
 * 创建 FF14 市场插件对象或配置。
 * @param application - application 输入；执行 `application.parsePriceInput()`、`application.getPrice()` 对应的 FF14 市场步骤。
 */
export function createFf14MarketPriceOperation(
  application: Ff14MarketApplication,
) {
  return {
    /**
     * 执行插件操作处理器。
     * @param input - input 输入；使用 `raw`、`text` 字段生成结果。
     * @returns 插件处理结果。
     */
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

/**
 * 清理 FF14 市场插件状态。
 * @param input - input 输入；驱动 `Object.entries()` 的 FF14 市场步骤。
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
