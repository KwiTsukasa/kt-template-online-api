import { drawCutoffListOfRecentEvent } from '@/modules/qqbot/plugins/bangdream/src/domain/cutoff/cutoff-recent.renderer';
import { getPresentEvent } from '@/modules/qqbot/plugins/bangdream/src/domain/event/event.model';
import { BANGDREAM_CUTOFF_BASE_CATALOG_KEYS } from '@/modules/qqbot/plugins/bangdream/src/operations/catalog-keys';
import type { BangDreamOperationModule } from '@/modules/qqbot/plugins/bangdream/src/operations/operation';

export const cutoffRecentOperation: BangDreamOperationModule = {
  catalogKeys: BANGDREAM_CUTOFF_BASE_CATALOG_KEYS,
  handlerName: 'getCutoffRecent',
  /**
   * 执行插件操作处理器。
   * @param input - input 输入；使用 `tier`、`eventId` 字段生成结果。
   * @param context - context 输入；执行 `context.getTokens()`、`context.requireNumber()`、`context.pickMainServer()`、`context.optionalNumber()` 对应的 BangDream步骤。
   * @returns 插件处理结果。
   */
  execute: async (input, context) => {
    const tokens = context.getTokens(input);
    const tier = context.requireNumber(input.tier, tokens[0], '请提供档位');
    const mainServer = context.pickMainServer(input, tokens.slice(1));
    const eventId =
      context.optionalNumber(input.eventId) ??
      context.firstNumber(tokens.slice(1)) ??
      getPresentEvent(mainServer).eventId;
    const options = context.getRenderOptions({ ...input, mainServer });

    return context.toImageReply(
      'bangdream.cutoff.recent',
      `${tier} ${eventId}`,
      await drawCutoffListOfRecentEvent(
        eventId,
        tier,
        mainServer,
        options.compress,
      ),
    );
  },
};
