import { drawCardDetail } from '@/modules/plugins/bangdream/src/domain/card/card-detail.renderer';
import { drawCardList } from '@/modules/plugins/bangdream/src/domain/card/card-search.renderer';
import { BANGDREAM_CARD_CATALOG_KEYS } from '@/modules/plugins/bangdream/src/operations/catalog-keys';
import type { BangDreamOperationModule } from '@/modules/plugins/bangdream/src/operations/operation';

export const cardSearchOperation: BangDreamOperationModule = {
  catalogKeys: BANGDREAM_CARD_CATALOG_KEYS,
  handlerName: 'searchCard',
  execute: async (input, context) => {
    const query = context.requireText(input, '请提供卡牌关键词或卡牌 ID');
    const options = context.getRenderOptions(input);
    const images = await (async () => {
      if (context.isInteger(query)) {
        return await drawCardDetail(
          Number(query),
          options.displayedServerList,
          options.useEasyBG,
          options.compress,
        );
      }
      return await context.drawFuzzyResult(query, (matches) =>
          drawCardList(matches, options.displayedServerList, options.compress),
        );
    })();

    return context.toImageReply('bangdream.card.search', query, images);
  },
};
