import { drawRarityInList } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-rarity.renderer';
import { Gacha } from '@/modules/qqbot/plugins/bangdream/src/domain/gacha/gacha.model';
import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { stackImage } from '@/modules/qqbot/plugins/bangdream/src/theme/image-stack';
import { Canvas } from 'skia-canvas';
import { drawList } from '@/modules/qqbot/plugins/bangdream/src/theme/list-frame.renderer';
import { BANGDREAM_GACHA_LIST_SPEC } from '@/modules/qqbot/plugins/bangdream/src/domain/gacha/gacha-list.layout';

/**
 * 在图片布局层中绘制卡池概率In列表。
 *
 * @param gacha - gacha 输入；使用 `rates` 字段生成结果。
 * @param server - server 输入；影响 drawGachaRateInList 的返回值。
 * @returns 异步处理结果。
 */
export async function drawGachaRateInList(
  gacha: Gacha,
  server: Server,
): Promise<Canvas> {
  const rates = gacha.rates[server];
  const list = [];
  let times = 0;
  let key = undefined;
  // 如果卡池数据没有提供概率数据，则不返回概率相关数据
  if (rates == null) {
    key = BANGDREAM_GACHA_LIST_SPEC.label.rateDistribution;
    list.push(
      drawList({
        key,
        text: BANGDREAM_GACHA_LIST_SPEC.label.rateMissing,
      }),
    );
  } else {
    for (const i in rates) {
      if (rates[i].rate == 0) {
        continue;
      }
      if (times == 0) {
        key = BANGDREAM_GACHA_LIST_SPEC.label.rateDistribution;
      }
      list.push(
        await drawRarityInList({
          key,
          rarity: parseInt(i),
          trainingStatus: false,
          text: ` ${rates[i].rate.toString()}%`,
        }),
      );
      times++;
    }
  }
  return stackImage(list);
}
