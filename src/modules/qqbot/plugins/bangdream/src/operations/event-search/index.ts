import { drawEventDetail } from '@/modules/qqbot/plugins/bangdream/src/domain/event/event-detail.renderer';
import { drawEventList } from '@/modules/qqbot/plugins/bangdream/src/domain/event/event-search.renderer';
import type { BangDreamOperationModule } from '@/modules/qqbot/plugins/bangdream/src/operations/operation';

export const eventSearchOperation: BangDreamOperationModule = {
  handlerName: 'searchEvent',
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
