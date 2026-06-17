import { drawEventDetail } from '@/modules/qqbot/plugins/bangdream/src/domain/event/event-detail.renderer';
import { drawEventList } from '@/modules/qqbot/plugins/bangdream/src/domain/event/event-search.renderer';
import { BANGDREAM_EVENT_CATALOG_KEYS } from '@/modules/qqbot/plugins/bangdream/src/operations/catalog-keys';
import type { BangDreamOperationModule } from '@/modules/qqbot/plugins/bangdream/src/operations/operation';

export const eventSearchOperation: BangDreamOperationModule = {
  catalogKeys: BANGDREAM_EVENT_CATALOG_KEYS,
  handlerName: 'searchEvent',
  /**
   * 执行插件操作处理器。
   * @param input - input 输入；驱动 `context.requireText()`、`context.getRenderOptions()` 的 BangDream步骤。
   * @param context - context 输入；执行 `context.requireText()`、`context.getRenderOptions()`、`context.isInteger()`、`context.drawFuzzyResult()` 对应的 BangDream步骤。
   * @returns 插件处理结果。
   */
  execute: async (input, context) => {
    const query = context.requireText(input, '请提供活动关键词或活动 ID');
    const options = context.getRenderOptions(input);
    const images = context.isInteger(query)
      ? await drawEventDetail(
          Number(query),
          options.displayedServerList,
          options.useEasyBG,
          options.compress,
        )
      : await context.drawFuzzyResult(query, (matches) =>
          drawEventList(matches, options.displayedServerList, options.compress),
        );

    return context.toImageReply('bangdream.event.search', query, images);
  },
};
