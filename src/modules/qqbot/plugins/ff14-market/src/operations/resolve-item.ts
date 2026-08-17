import type { Ff14MarketApplication } from '../application/ff14-market-application';

export const ff14ResolveItemHandlerName = 'resolveItem';

/**
 * 根据`application`构造Ff14条目操作。
 * @param application - 用于Ff14条目操作的领域对象，包含 `resolveItem` 字段。
 * @returns 包含 `execute`、`inputSchema`、`outputSchema` 字段的Ff14条目操作。
 */
export function createFf14ResolveItemOperation(
  application: Ff14MarketApplication,
) {
  return {
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
