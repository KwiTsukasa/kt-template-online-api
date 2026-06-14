import { Injectable } from '@nestjs/common';
import { formatKtDateTime, ToolsService } from '@/common';
import type { QqbotIntegrationPlugin } from '@/qqbot/qqbot.types';
import {
  BANGDREAM_INPUT_SCHEMA,
  BANGDREAM_OUTPUT_SCHEMA,
} from '@/modules/qqbot/plugins/bangDream/commands/qqbot-bangdream-command.definitions';
import { QqbotBangDreamClientService } from '@/modules/qqbot/plugins/bangDream/application/bangdream-client.service';
import { BANGDREAM_OPERATION_REGISTRY } from '@/modules/qqbot/plugins/bangDream/registry/operation-registry';

@Injectable()
export class QqbotBangDreamPluginService {
  constructor(
    private readonly bangDreamClientService: QqbotBangDreamClientService,
    private readonly toolsService: ToolsService,
  ) {}

  getPlugin(): QqbotIntegrationPlugin {
    return {
      description:
        '合入 Tsugu BangDream Bot 后端开源源码，提供 BanG Dream! Girls Band Party 公开查询出图能力。',
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
      key: 'bangdream',
      legacyKeys: ['bangDream'],
      name: 'BangDream 查询',
      operations: BANGDREAM_OPERATION_REGISTRY.map((operation) => ({
        cacheTtlMs: 60_000,
        description: operation.description,
        inputSchema: BANGDREAM_INPUT_SCHEMA,
        key: operation.key,
        name: operation.name,
        outputSchema: BANGDREAM_OUTPUT_SCHEMA,
        execute: async (input) =>
          await this.bangDreamClientService.execute(operation.key, input),
      })),
      version: '2.0.0',
    };
  }
}
