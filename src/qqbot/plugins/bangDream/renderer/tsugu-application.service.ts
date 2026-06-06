import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ToolsService } from '@/common';
import type {
  QqbotBangDreamCommandInput,
  QqbotBangDreamCommandOutput,
  QqbotBangDreamOperationKey,
} from '../qqbot-bangdream.types';
import { waitForMainDataReady } from '../tsugu/models/main-data-store';
import {
  createTsuguLogHook,
  TsuguHookRegistry,
} from '../tsugu/runtime/hook-registry';
import { getBangDreamOperationDefinition } from '../tsugu/runtime/operation-registry';
import { TsuguOperationPipeline } from '../tsugu/runtime/operation-pipeline';
import { QqbotBangDreamRendererService } from './qqbot-bangdream-renderer.service';

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
