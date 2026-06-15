import {
  Gacha,
  getPresentGachaList,
} from '@/modules/qqbot/plugins/bangdream/src/domain/gacha/gacha.model';
import { drawRandomGacha } from '@/modules/qqbot/plugins/bangdream/src/domain/gacha/gacha-simulate.renderer';
import {
  BANGDREAM_GACHA_DEFAULT_SPIN_COUNT,
  isBirthdayGachaType,
} from '@/modules/qqbot/plugins/bangdream/src/domain/policy/gacha.policy';
import type { BangDreamOperationModule } from '@/modules/qqbot/plugins/bangdream/src/operations/operation';

export const gachaSimulateOperation: BangDreamOperationModule = {
  handlerName: 'simulateGacha',
  execute: async (input, context) => {
    const tokens = context.getTokens(input);
    const mainServer = context.pickMainServer(input, tokens);
    const times =
      context.optionalNumber(input.times) ??
      context.firstNumber(tokens) ??
      BANGDREAM_GACHA_DEFAULT_SPIN_COUNT;
    const gachaId =
      context.optionalNumber(input.gachaId) ?? context.secondNumber(tokens);
    const options = context.getRenderOptions({ ...input, mainServer });
    const gacha = gachaId
      ? new Gacha(gachaId)
      : await pickPresentGacha(mainServer);

    return context.toImageReply(
      'bangdream.gacha.simulate',
      `${times}${gachaId ? ` ${gachaId}` : ''}`,
      await drawRandomGacha(gacha, times, options.compress),
    );
  },
};

async function pickPresentGacha(mainServer: number) {
  const gachaList = await getPresentGachaList(mainServer);
  const gacha = gachaList.find((item) => !isBirthdayGachaType(item.type));
  if (!gacha) throw new Error('错误: 该服务器没有正在进行的卡池');
  return gacha;
}
