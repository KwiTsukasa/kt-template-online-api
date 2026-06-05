import { drawRarityInList } from './rarity';
import { Gacha } from '@/qqbot/plugins/bangDream/tsugu/domain/gacha';
import { Server } from '@/qqbot/plugins/bangDream/tsugu/domain/server';
import { stackImage } from '@/qqbot/plugins/bangDream/tsugu/layout/utils';
import { Canvas } from 'skia-canvas';
import { drawList } from '../list';

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
    key = '概率分布';
    list.push(
      drawList({
        key,
        text: `未提供概率分布数据`,
      }),
    );
  } else {
    for (const i in rates) {
      if (rates[i].rate == 0) {
        continue;
      }
      if (times == 0) {
        key = '概率分布';
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
