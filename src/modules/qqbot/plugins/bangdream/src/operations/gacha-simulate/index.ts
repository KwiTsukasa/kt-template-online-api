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
  /**
   * 执行插件操作处理器。
   * @param input - input 输入；使用 `times`、`gachaId` 字段生成结果。
   * @param context - context 输入；执行 `context.getTokens()`、`context.pickMainServer()`、`context.optionalNumber()`、`context.firstNumber()` 对应的 BangDream步骤。
   * @returns 插件处理结果。
   */
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

/**
 * 执行 BangDream 插件流程。
 * @param mainServer - mainServer 输入；驱动 `getPresentGachaList()` 的 BangDream步骤。
 */
async function pickPresentGacha(mainServer: number) {
  const gachaList = await getPresentGachaList(mainServer);
  const gacha = gachaList.find((item) => !isBirthdayGachaType(item.type));
  if (!gacha) throw new Error('错误: 该服务器没有正在进行的卡池');
  return gacha;
}
