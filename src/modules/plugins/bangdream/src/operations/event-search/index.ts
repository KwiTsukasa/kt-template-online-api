import { drawEventDetail } from '@/modules/plugins/bangdream/src/domain/event/event-detail.renderer';
import { drawEventList } from '@/modules/plugins/bangdream/src/domain/event/event-search.renderer';
import { BANGDREAM_EVENT_CATALOG_KEYS } from '@/modules/plugins/bangdream/src/operations/catalog-keys';
import type { BangDreamOperationModule } from '@/modules/plugins/bangdream/src/operations/operation';

export const eventSearchOperation: BangDreamOperationModule = {
  catalogKeys: BANGDREAM_EVENT_CATALOG_KEYS,
  handlerName: 'searchEvent',
  execute: async (input, context) => {
    const query = context.requireText(input, '请提供活动关键词或活动 ID');
    const options = context.getRenderOptions(input);
    const images = await (async () => {
      if (context.isInteger(query)) {
        return await drawEventDetail(
          Number(query),
          options.displayedServerList,
          options.useEasyBG,
          options.compress,
        );
      }
      return await context.drawFuzzyResult(query, (matches) =>
          drawEventList(matches, options.displayedServerList, options.compress),
        );
    })();

    return context.toImageReply('bangdream.event.search', query, images);
  },
};
