import { Injectable } from '@nestjs/common';
import { formatKtDateTime, ToolsService } from '@/common';
import type { QqbotIntegrationPlugin } from '../../qqbot.types';
import { QqbotBangDreamClientService } from './qqbot-bangdream-client.service';

@Injectable()
export class QqbotBangDreamPluginService {
  constructor(
    private readonly bangDreamClientService: QqbotBangDreamClientService,
    private readonly toolsService: ToolsService,
  ) {}

  getPlugin(): QqbotIntegrationPlugin {
    return {
      description:
        '对接 Bestdori 公开数据，提供 BanG Dream! Girls Band Party 歌曲查询能力。',
      healthCheck: async () => {
        const checkedAt = formatKtDateTime(new Date());
        try {
          await this.bangDreamClientService.checkHealth();
          return {
            checkedAt,
            message: 'BangDream 插件可用',
            status: 'healthy',
          };
        } catch (err) {
          return {
            checkedAt,
            message: this.toolsService.getErrorMessage(
              err,
              'BangDream 插件不可用',
            ),
            status: 'degraded',
          };
        }
      },
      key: 'bangDream',
      name: 'BangDream 查询',
      operations: [
        {
          cacheTtlMs: 60_000,
          description: '按歌曲名或 Bestdori 歌曲 ID 查询 BanG Dream 歌曲信息。',
          inputSchema: {
            properties: {
              query: { description: '歌曲名或歌曲 ID', type: 'string' },
              text: { description: '命令原始文本', type: 'string' },
            },
            required: ['query'],
            type: 'object',
          },
          key: 'bangdream.song.search',
          name: '歌曲查询',
          outputSchema: {
            properties: {
              bandName: { type: 'string' },
              bpmText: { type: 'string' },
              difficultyText: { type: 'string' },
              id: { type: 'number' },
              lengthText: { type: 'string' },
              notesText: { type: 'string' },
              replyText: { type: 'string' },
              title: { type: 'string' },
              url: { type: 'string' },
            },
            type: 'object',
          },
          execute: async (input) =>
            await this.bangDreamClientService.searchSong(input),
        },
      ],
      version: '1.0.0',
    };
  }
}
