import { drawRarityInList } from '@/modules/qqbot/plugins/bangDream/card/card-rarity.renderer';
import { Gacha } from '@/modules/qqbot/plugins/bangDream/gacha/gacha.model';
import { Server } from '@/modules/qqbot/plugins/bangDream/catalog/server.model';
import { stackImage } from '@/modules/qqbot/plugins/bangDream/shared/image-stack';
import { Canvas } from 'skia-canvas';
import { drawList } from '@/modules/qqbot/plugins/bangDream/shared/list-frame.renderer';
import { BANGDREAM_GACHA_LIST_SPEC } from '@/modules/qqbot/plugins/bangDream/gacha/gacha-list.layout';

/**
 * 在图片布局层中绘制卡池概率In列表。
 *
 * @param gacha - 卡池参数。
 * @param server - 目标服务器。
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
