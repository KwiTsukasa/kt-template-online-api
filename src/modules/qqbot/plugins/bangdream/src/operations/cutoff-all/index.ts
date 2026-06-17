import { drawCutoffAll } from '@/modules/qqbot/plugins/bangdream/src/domain/cutoff/cutoff-all.renderer';
import { getPresentEvent } from '@/modules/qqbot/plugins/bangdream/src/domain/event/event.model';
import { BANGDREAM_CUTOFF_BASE_CATALOG_KEYS } from '@/modules/qqbot/plugins/bangdream/src/operations/catalog-keys';
import type { BangDreamOperationModule } from '@/modules/qqbot/plugins/bangdream/src/operations/operation';

export const cutoffAllOperation: BangDreamOperationModule = {
  catalogKeys: BANGDREAM_CUTOFF_BASE_CATALOG_KEYS,
  handlerName: 'getCutoffAll',
  /**
   * 执行插件操作处理器。
   * @param input - input 输入；使用 `eventId` 字段生成结果。
   * @param context - context 输入；执行 `context.getTokens()`、`context.pickMainServer()`、`context.optionalNumber()`、`context.firstNumber()` 对应的 BangDream步骤。
   * @returns 插件处理结果。
   */
  execute: async (input, context) => {
    const tokens = context.getTokens(input);
    const mainServer = context.pickMainServer(input, tokens);
    const eventId =
      context.optionalNumber(input.eventId) ??
      context.firstNumber(tokens) ??
      getPresentEvent(mainServer).eventId;
    const options = context.getRenderOptions({ ...input, mainServer });

    return context.toImageReply(
      'bangdream.cutoff.all',
      `${eventId}`,
      await drawCutoffAll(eventId, mainServer, options.compress),
    );
  },
};
