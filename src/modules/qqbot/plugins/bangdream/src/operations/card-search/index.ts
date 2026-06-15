import { drawCardDetail } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-detail.renderer';
import { drawCardList } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-search.renderer';
import type { BangDreamOperationModule } from '@/modules/qqbot/plugins/bangdream/src/operations/operation';

export const cardSearchOperation: BangDreamOperationModule = {
  handlerName: 'searchCard',
  execute: async (input, context) => {
    const query = context.requireText(input, '请提供卡牌关键词或卡牌 ID');
    const options = context.getRenderOptions(input);
    const images = context.isInteger(query)
      ? await drawCardDetail(
          Number(query),
          options.displayedServerList,
          options.useEasyBG,
          options.compress,
        )
      : await context.drawFuzzyResult(query, (matches) =>
          drawCardList(matches, options.displayedServerList, options.compress),
        );

    return context.toImageReply('bangdream.card.search', query, images);
  },
};
