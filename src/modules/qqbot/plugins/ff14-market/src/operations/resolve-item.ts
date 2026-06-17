import type { Ff14MarketApplication } from '../application/ff14-market-application';

export const ff14ResolveItemHandlerName = 'resolveItem';

/**
 * 创建 FF14 市场插件对象或配置。
 * @param application - application 输入；执行 `application.resolveItem()` 对应的 FF14 市场步骤。
 */
export function createFf14ResolveItemOperation(
  application: Ff14MarketApplication,
) {
  return {
    /**
     * 执行插件操作处理器。
     * @param input - input 输入；使用 `item`、`raw`、`text` 字段生成结果。
     * @returns 插件处理结果。
     */
    execute: (input: Record<string, any>) =>
      application.resolveItem({
        ...input,
        item: input.item || input.raw || input.text,
      }),
    inputSchema: {
      properties: {
        item: { description: '物品名称或 ID', type: 'string' },
        itemId: { description: '物品 ID', type: 'number' },
        language: { default: 'chs', type: 'string' },
      },
      required: ['item'],
      type: 'object',
    },
    outputSchema: {
      properties: {
        itemId: { type: 'number' },
        name: { type: 'string' },
      },
      type: 'object',
    },
  };
}
