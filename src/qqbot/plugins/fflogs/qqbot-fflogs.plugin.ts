import { Injectable } from '@nestjs/common';
import type { QqbotIntegrationPlugin } from '../../plugin/qqbot-plugin.types';
import { QqbotFflogsClientService } from './qqbot-fflogs-client.service';

@Injectable()
export class QqbotFflogsPluginService {
  constructor(private readonly fflogsClientService: QqbotFflogsClientService) {}

  getPlugin(): QqbotIntegrationPlugin {
    return {
      description: '对接 FFLogs v2 GraphQL，提供 FF14 角色公开排名查询能力。',
      healthCheck: async () => {
        const checkedAt = new Date().toISOString();
        try {
          await this.fflogsClientService.checkHealth();
          return {
            checkedAt,
            message: 'FFLogs 插件可用',
            status: 'healthy',
          };
        } catch (err) {
          return {
            checkedAt,
            message: err instanceof Error ? err.message : 'FFLogs 插件不可用',
            status: 'degraded',
          };
        }
      },
      key: 'fflogs',
      name: 'FFLogs 查询',
      operations: [
        {
          cacheTtlMs: 60_000,
          description: '查询指定角色的 FFLogs 公开排名摘要。',
          inputSchema: {
            properties: {
              characterName: { description: '角色名', type: 'string' },
              metric: { description: '排名指标，如 dps/hps', type: 'string' },
              serverRegion: {
                default: 'CN',
                description: '服务器地区，如 CN/JP/NA/EU',
                type: 'string',
              },
              serverSlug: { description: '服务器名或 slug', type: 'string' },
              timeframe: {
                description: 'Today 或 Historical',
                type: 'string',
              },
              zoneId: { description: '副本区域 ID', type: 'number' },
            },
            required: ['characterName', 'serverSlug'],
            type: 'object',
          },
          key: 'fflogs.character.summary',
          name: '角色排名摘要',
          outputSchema: {
            properties: {
              characterName: { type: 'string' },
              rankings: { type: 'array' },
              replyText: { type: 'string' },
              url: { type: 'string' },
            },
            type: 'object',
          },
          execute: async (input) =>
            await this.fflogsClientService.getCharacterSummary(input),
        },
      ],
      version: '1.0.0',
    };
  }
}
