import { drawRarityInList } from '@/modules/plugins/bangdream/src/domain/card/card-rarity.renderer';
import { Gacha } from '@/modules/plugins/bangdream/src/domain/gacha/gacha.model';
import { Server } from '@/modules/plugins/bangdream/src/domain/catalog/server.model';
import { stackImage } from '@/modules/plugins/bangdream/src/theme/image-stack';
import { Canvas } from 'skia-canvas';
import { drawList } from '@/modules/plugins/bangdream/src/theme/list-frame.renderer';
import { BANGDREAM_GACHA_LIST_SPEC } from '@/modules/plugins/bangdream/src/domain/gacha/gacha-list.layout';

/**
 * 根据`gacha`、`server`绘制或格式化卡池Rate。
 * @param gacha - 用于卡池Rate的领域对象，包含 `rates` 字段。
 * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
 * @returns 卡池Rate。
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
