import { Card } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card.model';
import type { BangDreamOperationModule } from '@/modules/qqbot/plugins/bangdream/src/operations/operation';

export const cardIllustrationOperation: BangDreamOperationModule = {
  handlerName: 'getCardIllustration',
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
