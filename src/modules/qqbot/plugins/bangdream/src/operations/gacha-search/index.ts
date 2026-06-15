import { drawGachaDetail } from '@/modules/qqbot/plugins/bangdream/src/domain/gacha/gacha-detail.renderer';
import type { BangDreamOperationModule } from '@/modules/qqbot/plugins/bangdream/src/operations/operation';

export const gachaSearchOperation: BangDreamOperationModule = {
  handlerName: 'searchGacha',
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
