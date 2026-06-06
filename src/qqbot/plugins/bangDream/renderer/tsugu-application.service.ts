import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ToolsService } from '@/common';
import type {
  QqbotBangDreamCommandInput,
  QqbotBangDreamCommandOutput,
  QqbotBangDreamOperationKey,
} from '../qqbot-bangdream.types';
import { waitForMainDataReady } from '../tsugu/models/main-data-store';
import {
  createTsuguHookContext,
  createTsuguLogHook,
  TsuguHookRegistry,
} from '../tsugu/runtime/hook-registry';
import { getBangDreamOperationDefinition } from '../tsugu/runtime/operation-registry';
import { QqbotBangDreamRendererService } from './qqbot-bangdream-renderer.service';

@Injectable()
export class TsuguApplicationService implements OnApplicationBootstrap {
  private readonly hookRegistry = new TsuguHookRegistry([createTsuguLogHook()]);

  constructor(
    private readonly rendererService: QqbotBangDreamRendererService,
    private readonly toolsService: ToolsService,
  ) {}

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
    const context = createTsuguHookContext(operationKey, input);
    await this.hookRegistry.beforeParse(context);

    try {
      context.stage = 'mainData';
      await waitForMainDataReady();

      context.stage = 'operation';
      const operation = getBangDreamOperationDefinition(operationKey);
      if (!operation) {
        throw new Error(`BangDream 插件能力不存在：${operationKey}`);
      }
      context.handlerName = operation.handlerName;
      await this.hookRegistry.afterResolve(context);

      context.stage = 'handler';
      await this.hookRegistry.beforeRender(context);
      const output = await this.rendererService.executeOperationHandler(
        operation.handlerName,
        input,
      );

      context.stage = 'output';
      context.imageCount = output.imageCount;
      context.query = output.query || context.query;
      await this.hookRegistry.afterOutput(context);
      return output;
    } catch (err) {
      const message = this.toolsService.getErrorMessage(
        err,
        'BangDream 命令执行失败',
      );
      await this.hookRegistry.onError(context, message);
      throw new Error(message);
    }
  }
}
