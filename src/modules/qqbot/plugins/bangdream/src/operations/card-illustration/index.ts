import { Card } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card.model';
import { BANGDREAM_CARD_ILLUSTRATION_CATALOG_KEYS } from '@/modules/qqbot/plugins/bangdream/src/operations/catalog-keys';
import type { BangDreamOperationModule } from '@/modules/qqbot/plugins/bangdream/src/operations/operation';

export const cardIllustrationOperation: BangDreamOperationModule = {
  catalogKeys: BANGDREAM_CARD_ILLUSTRATION_CATALOG_KEYS,
  handlerName: 'getCardIllustration',
  /**
   * 执行插件操作处理器。
   * @param input - input 输入；使用 `cardId` 字段生成结果。
   * @param context - context 输入；执行 `context.requireNumber()`、`context.firstToken()`、`context.toImageReply()` 对应的 BangDream步骤。
   * @returns 插件处理结果。
   */
  execute: async (input, context) => {
    const cardId = context.requireNumber(
      input.cardId,
      context.firstToken(input),
      '请提供卡牌 ID',
    );
    const card = new Card(cardId);
    if (!card.isExist) {
      return context.toImageReply('bangdream.card.illustration', `${cardId}`, [
        '错误: 该卡不存在',
      ]);
    }

    const images: Array<Buffer | string> = [];
    for (const trainingStatus of card.getTrainingStatusList()) {
      images.push(await card.getCardIllustrationImageBuffer(trainingStatus));
    }
    return context.toImageReply(
      'bangdream.card.illustration',
      `${cardId}`,
      images,
    );
  },
};
