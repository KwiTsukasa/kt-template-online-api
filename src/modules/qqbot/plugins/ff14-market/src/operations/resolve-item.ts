import type { Ff14MarketApplication } from '../application/ff14-market-application';

export const ff14ResolveItemHandlerName = 'resolveItem';

export function createFf14ResolveItemOperation(
  application: Ff14MarketApplication,
) {
  return {
    execute: (input: Record<string, any>) => application.resolveItem(input),
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
