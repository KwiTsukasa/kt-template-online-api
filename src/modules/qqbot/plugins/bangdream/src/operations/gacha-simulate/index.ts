import {
  Gacha,
  getPresentGachaList,
} from '@/modules/qqbot/plugins/bangdream/src/domain/gacha/gacha.model';
import { drawRandomGacha } from '@/modules/qqbot/plugins/bangdream/src/domain/gacha/gacha-simulate.renderer';
import {
  BANGDREAM_GACHA_DEFAULT_SPIN_COUNT,
  isBirthdayGachaType,
} from '@/modules/qqbot/plugins/bangdream/src/domain/policy/gacha.policy';
import { BANGDREAM_GACHA_SIMULATE_CATALOG_KEYS } from '@/modules/qqbot/plugins/bangdream/src/operations/catalog-keys';
import type { BangDreamOperationModule } from '@/modules/qqbot/plugins/bangdream/src/operations/operation';

export const gachaSimulateOperation: BangDreamOperationModule = {
  catalogKeys: BANGDREAM_GACHA_SIMULATE_CATALOG_KEYS,
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
    const gacha = await (async () => {
      if (gachaId) {
        return new Gacha(gachaId);
      }
      return await pickPresentGacha(mainServer);
    })();

    return context.toImageReply(
      'bangdream.gacha.simulate',
      `${times}${(() => {
        if (gachaId) {
          return ` ${gachaId}`;
        }
        return '';
      })()}`,
      await drawRandomGacha(gacha, times, options.compress),
    );
  },
};

/**
 * 从`mainServer`筛选Present卡池，并保持保留项的原有顺序与键名；从 `getPresentGachaList` 读取Present卡池。
 * @param mainServer - 决定Present卡池内容、边界或目标的 `mainServer` 值。
 * @returns Present卡池。
 * @throws 当 `!gacha` 成立时拒绝当前输入并抛出 `Error`。
 */
async function pickPresentGacha(mainServer: number) {
  const gachaList = await getPresentGachaList(mainServer);
  const gacha = gachaList.find((item) => !isBirthdayGachaType(item.type));
  if (!gacha) throw new Error('错误: 该服务器没有正在进行的卡池');
  return gacha;
}
