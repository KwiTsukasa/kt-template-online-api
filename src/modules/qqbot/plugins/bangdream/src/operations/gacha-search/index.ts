import { drawGachaDetail } from '@/modules/qqbot/plugins/bangdream/src/domain/gacha/gacha-detail.renderer';
import { BANGDREAM_GACHA_CATALOG_KEYS } from '@/modules/qqbot/plugins/bangdream/src/operations/catalog-keys';
import type { BangDreamOperationModule } from '@/modules/qqbot/plugins/bangdream/src/operations/operation';

export const gachaSearchOperation: BangDreamOperationModule = {
  catalogKeys: BANGDREAM_GACHA_CATALOG_KEYS,
  handlerName: 'searchGacha',
  /**
   * 执行插件操作处理器。
   * @param input - input 输入；使用 `gachaId` 字段生成结果。
   * @param context - context 输入；执行 `context.requireNumber()`、`context.firstToken()`、`context.getRenderOptions()`、`context.toImageReply()` 对应的 BangDream步骤。
   * @returns 插件处理结果。
   */
  execute: async (input, context) => {
    const gachaId = context.requireNumber(
      input.gachaId,
      context.firstToken(input),
      '请提供卡池 ID',
    );
    const options = context.getRenderOptions(input);

    return context.toImageReply(
      'bangdream.gacha.search',
      `${gachaId}`,
      await drawGachaDetail(
        gachaId,
        options.displayedServerList,
        options.useEasyBG,
        options.compress,
      ),
    );
  },
};
