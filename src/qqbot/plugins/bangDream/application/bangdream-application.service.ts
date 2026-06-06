import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ToolsService } from '@/common';
import type {
  QqbotBangDreamCommandInput,
  QqbotBangDreamCommandOutput,
  QqbotBangDreamOperationKey,
} from '@/qqbot/plugins/bangDream/qqbot-bangdream.types';
import { waitForMainDataReady } from '@/qqbot/plugins/bangDream/shared/main-data-store';
import {
  createTsuguLogHook,
  TsuguHookRegistry,
} from '@/qqbot/plugins/bangDream/hook/hook-registry';
import { getBangDreamOperationDefinition } from '@/qqbot/plugins/bangDream/registry/operation-registry';
import { TsuguOperationPipeline } from '@/qqbot/plugins/bangDream/application/operation-pipeline';
import { QqbotBangDreamRendererService } from '@/qqbot/plugins/bangDream/application/bangdream-renderer.facade';

@Injectable()
export class TsuguApplicationService implements OnApplicationBootstrap {
  private readonly hookRegistry = new TsuguHookRegistry([createTsuguLogHook()]);
  private readonly operationPipeline: TsuguOperationPipeline;

  constructor(
    private readonly rendererService: QqbotBangDreamRendererService,
    private readonly toolsService: ToolsService,
  ) {
    this.operationPipeline = new TsuguOperationPipeline({
      executeHandler: async (handlerName, input) =>
        await this.rendererService.executeOperationHandler(handlerName, input),
      hookRegistry: this.hookRegistry,
      normalizeError: (error) =>
        this.toolsService.getErrorMessage(error, 'BangDream 命令执行失败'),
      resolveOperation: (operationKey) =>
        getBangDreamOperationDefinition(operationKey),
      waitForReady: async () => await waitForMainDataReady(),
    });
  }

  async onApplicationBootstrap() {
    await this.rendererService.refreshDictionaryCache();
  }

  async checkHealth() {
    return await this.rendererService.checkHealth();
  }

  async execute(
    operationKey: QqbotBangDreamOperationKey,
    input: QqbotBangDreamCommandInput,
  ): Promise<QqbotBangDreamCommandOutput> {
    return await this.operationPipeline.run(operationKey, input);
  }
}
