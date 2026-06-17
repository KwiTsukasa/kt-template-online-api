import { drawCharacterDetail } from '@/modules/qqbot/plugins/bangdream/src/domain/character/character-detail.renderer';
import { drawCharacterList } from '@/modules/qqbot/plugins/bangdream/src/domain/character/character-search.renderer';
import { BANGDREAM_CHARACTER_CATALOG_KEYS } from '@/modules/qqbot/plugins/bangdream/src/operations/catalog-keys';
import type { BangDreamOperationModule } from '@/modules/qqbot/plugins/bangdream/src/operations/operation';

export const characterSearchOperation: BangDreamOperationModule = {
  catalogKeys: BANGDREAM_CHARACTER_CATALOG_KEYS,
  handlerName: 'searchCharacter',
  /**
   * 执行插件操作处理器。
   * @param input - input 输入；驱动 `context.requireText()`、`context.getRenderOptions()` 的 BangDream步骤。
   * @param context - context 输入；执行 `context.requireText()`、`context.getRenderOptions()`、`context.isInteger()`、`context.drawFuzzyResult()` 对应的 BangDream步骤。
   * @returns 插件处理结果。
   */
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
