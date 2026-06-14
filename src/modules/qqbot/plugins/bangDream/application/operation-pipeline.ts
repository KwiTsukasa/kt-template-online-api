import type {
  QqbotBangDreamCommandInput,
  QqbotBangDreamCommandOutput,
  QqbotBangDreamOperationKey,
} from '@/modules/qqbot/plugins/bangDream/qqbot-bangdream.types';
import type {
  QqbotBangDreamOperationHandlerName,
  TsuguOperationDefinition,
} from '@/modules/qqbot/plugins/bangDream/registry/operation-registry';
import {
  createTsuguHookContext,
  type TsuguHookRegistry,
} from '@/modules/qqbot/plugins/bangDream/hook/hook-registry';

export type TsuguOperationPipelineOptions = {
  executeHandler: (
    handlerName: QqbotBangDreamOperationHandlerName,
    input: QqbotBangDreamCommandInput,
  ) => Promise<QqbotBangDreamCommandOutput>;
  hookRegistry: TsuguHookRegistry;
  normalizeError: (error: unknown) => string;
  resolveOperation: (
    operationKey: QqbotBangDreamOperationKey,
  ) => TsuguOperationDefinition | undefined;
  waitForReady: () => Promise<void>;
};

/**
 * 串联 Tsugu 命令执行阶段：准备主数据、解析 operation、调用渲染 handler、输出 hook。
 */
export class TsuguOperationPipeline {
  constructor(private readonly options: TsuguOperationPipelineOptions) {}

  async run(
    operationKey: QqbotBangDreamOperationKey,
    input: QqbotBangDreamCommandInput,
  ) {
    const context = createTsuguHookContext(operationKey, input);
    await this.options.hookRegistry.beforeParse(context);

    try {
      context.stage = 'mainData';
      await this.options.waitForReady();

      context.stage = 'operation';
      const operation = this.options.resolveOperation(operationKey);
      if (!operation) {
        throw new Error(`BangDream 插件能力不存在：${operationKey}`);
      }
      context.handlerName = operation.handlerName;
      await this.options.hookRegistry.afterResolve(context);

      context.stage = 'handler';
      await this.options.hookRegistry.beforeRender(context);
      const output = await this.options.executeHandler(
        operation.handlerName,
        input,
      );

      context.stage = 'output';
      context.imageCount = output.imageCount;
      context.query = output.query || context.query;
      await this.options.hookRegistry.afterOutput(context);
      return output;
    } catch (error) {
      const message = this.options.normalizeError(error);
      await this.options.hookRegistry.onError(context, message);
      throw new Error(message);
    }
  }
}
