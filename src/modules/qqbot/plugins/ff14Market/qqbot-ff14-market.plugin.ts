import { Injectable } from '@nestjs/common';
import { formatKtDateTime, ToolsService } from '@/common';
import type { QqbotIntegrationPlugin } from '@/qqbot/qqbot.types';
import { QqbotFf14ClientService } from './qqbot-ff14-client.service';

@Injectable()
export class QqbotFf14MarketPluginService {
  constructor(
    private readonly ff14ClientService: QqbotFf14ClientService,
    private readonly toolsService: ToolsService,
  ) {}

  getPlugin(): QqbotIntegrationPlugin {
    return {
      description:
        '对接 XIVAPI v2 与 Universalis，提供 FF14 物品解析和市场价格查询能力。',
      healthCheck: async () => {
        const checkedAt = formatKtDateTime(new Date());
        try {
          await this.ff14ClientService.resolveItem({
            itemId: 2,
            language: 'en',
          });
          return {
            checkedAt,
            message: 'FF14 插件可用',
            status: 'healthy',
          };
        } catch (err) {
          return {
            checkedAt,
            message: this.toolsService.getErrorMessage(err, 'FF14 插件不可用'),
            status: 'degraded',
          };
        }
      },
      key: 'ff14-market',
      legacyKeys: ['ff14Market'],
      name: 'FF14 市场价格',
      operations: [
        {
          description: '按物品名称或 ID 解析 XIVAPI 物品信息。',
          inputSchema: {
            properties: {
              item: { description: '物品名称或 ID', type: 'string' },
              itemId: { description: '物品 ID', type: 'number' },
              language: { default: 'chs', type: 'string' },
            },
            required: ['item'],
            type: 'object',
          },
          key: 'ff14.item.resolve',
          name: '解析物品',
          outputSchema: {
            properties: {
              itemId: { type: 'number' },
              name: { type: 'string' },
            },
            type: 'object',
          },
          execute: async (input) =>
            await this.ff14ClientService.resolveItem(input),
        },
        {
          cacheTtlMs: 60_000,
          description: '查询指定服务器的 FF14 市场最低价、均价与近期挂单。',
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
          key: 'ff14.market.price',
          name: '市场查价',
          outputSchema: {
            properties: {
              averagePrice: { type: 'number' },
              minPrice: { type: 'number' },
              replyText: { type: 'string' },
              world: { type: 'string' },
            },
            type: 'object',
          },
          execute: async (input) =>
            await this.ff14ClientService.getPrice(input),
        },
      ],
      version: '1.0.0',
    };
  }
}
