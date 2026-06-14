import { Injectable } from '@nestjs/common';
import { formatKtDateTime, ToolsService } from '@/common';
import type { QqbotIntegrationPlugin } from '@/qqbot/qqbot.types';
import { QqbotFflogsClientService } from './qqbot-fflogs-client.service';

@Injectable()
export class QqbotFflogsPluginService {
  constructor(
    private readonly fflogsClientService: QqbotFflogsClientService,
    private readonly toolsService: ToolsService,
  ) {}

  getPlugin(): QqbotIntegrationPlugin {
    return {
      description:
        '对接 FFLogs v2 GraphQL，提供 FF14 角色公开排名和指定高难最近记录查询能力。',
      healthCheck: async () => {
        const checkedAt = formatKtDateTime(new Date());
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
            message: this.toolsService.getErrorMessage(
              err,
              'FFLogs 插件不可用',
            ),
            status: 'degraded',
          };
        }
      },
      key: 'fflogs',
      name: 'FFLogs 查询',
      operations: [
        {
          cacheTtlMs: 60_000,
          description:
            '查询指定角色的 FFLogs 公开排名摘要；传入 encounter/任务 后查询指定高难最近10次记录。',
          inputSchema: {
            properties: {
              characterName: { description: '角色名', type: 'string' },
              encounter: {
                description:
                  '高难任务名，按 FFLogs 公开报告中的任务名或 encounterID 匹配',
                type: 'string',
              },
              limit: {
                default: 10,
                description: '最近记录数量，最多10条',
                type: 'number',
              },
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
              zoneId: {
                description: '副本区域 ID，用于排名摘要',
                type: 'number',
              },
            },
            required: ['characterName', 'serverSlug'],
            type: 'object',
          },
          key: 'fflogs.character.summary',
          name: '角色排名摘要',
          outputSchema: {
            properties: {
              characterName: { type: 'string' },
              encounterName: { type: 'string' },
              logs: { type: 'array' },
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
