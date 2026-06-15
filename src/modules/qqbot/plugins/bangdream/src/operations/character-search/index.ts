import { drawCharacterDetail } from '@/modules/qqbot/plugins/bangdream/src/domain/character/character-detail.renderer';
import { drawCharacterList } from '@/modules/qqbot/plugins/bangdream/src/domain/character/character-search.renderer';
import { BANGDREAM_CHARACTER_CATALOG_KEYS } from '@/modules/qqbot/plugins/bangdream/src/operations/catalog-keys';
import type { BangDreamOperationModule } from '@/modules/qqbot/plugins/bangdream/src/operations/operation';

export const characterSearchOperation: BangDreamOperationModule = {
  catalogKeys: BANGDREAM_CHARACTER_CATALOG_KEYS,
  handlerName: 'searchCharacter',
  execute: async (input, context) => {
    const query = context.requireText(input, '请提供角色关键词或角色 ID');
    const options = context.getRenderOptions(input);
    const images = context.isInteger(query)
      ? await drawCharacterDetail(
          Number(query),
          options.displayedServerList,
          options.compress,
        )
      : await context.drawFuzzyResult(query, (matches) =>
          drawCharacterList(
            matches,
            options.displayedServerList,
            options.compress,
          ),
        );

    return context.toImageReply('bangdream.character.search', query, images);
  },
};
