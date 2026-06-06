import { Canvas } from 'skia-canvas';
import { drawText } from '@/qqbot/plugins/bangDream/tsugu/canvas/text';
import { drawList } from './list-frame';
import { stackImage } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/image-stack';
import { drawRoundedRect } from '@/qqbot/plugins/bangDream/tsugu/canvas/rect';
import {
  Card,
  Stat,
  limitBreakRankStat,
} from '@/qqbot/plugins/bangDream/tsugu/models/card';
import { BANGDREAM_STAT_CONFIG } from '@/qqbot/plugins/bangDream/tsugu/models/bangdream-constants';

export const statConfig: Record<string, { color: string; name: string }> =
  BANGDREAM_STAT_CONFIG;

/**
 * 在图片布局层中绘制卡牌数值In列表。
 *
 * @param card - 卡牌参数。
 */
export async function drawCardStatInList(card: Card) {
  const stat = await card.calcStat();
  const limitBreakstat = limitBreakRankStat(card.rarity);
  const limitBreakstatTotal =
    limitBreakstat.performance +
    limitBreakstat.technique +
    limitBreakstat.visual;
  const statTotal = stat.performance + stat.technique + stat.visual;
  const statImage = await drawCardStatDivided(stat, statTotal, limitBreakstat);
  const list = [];
  list.push(
    drawList({
      key: '综合力',
      content: [`综合力: ${statTotal} + (${limitBreakstatTotal * 4})`],
    }),
  );
  list.push(new Canvas(1, 5));
  list.push(statImage);
  return stackImage(list);
}

/**
 * 在图片布局层中绘制数值In列表。
 *
 * @param stat - 数值参数。
 */
export async function drawStatInList(stat: Stat) {
  const statTotal = Math.floor(stat.performance + stat.technique + stat.visual);
  const statImage = await drawCardStatDivided(stat, statTotal);
  const list = [];
  list.push(
    drawList({
      key: '综合力',
      content: [`综合力: ${statTotal}`],
    }),
  );
  list.push(new Canvas(1, 5));
  list.push(statImage);
  return stackImage(list);
}

/**
 * 在图片布局层中绘制卡牌数值Divided。
 *
 * @param stat - 数值参数。
 * @param statTotal - 数值Total参数。
 * @param limitBreakstat - limitBreakstat参数，未传入时使用默认值。
 * @returns 异步处理结果。
 */
async function drawCardStatDivided(
  stat: Stat,
  statTotal: number,
  limitBreakstat?: Stat,
): Promise<Canvas> {
  const widthMax = 800;

  /**
   * 在图片布局层中绘制数值线条。
   *
   * @param key - 当前字段键名。
   * @param value - 当前处理的值。
   * @param total - total参数。
   * @returns 渲染或资源结果。
   */
  function drawStatLine(key: string, value: number, total: number): Canvas {
    const canvas = new Canvas(800, 70);
    const ctx = canvas.getContext('2d');
    let text = `${statConfig[key].name}: ${Math.floor(value)}`;
    if (limitBreakstat) {
      text += ` + (${limitBreakstat[key] * 4})`;
    }
    const textImage = drawText({
      text,
      maxWidth: widthMax,
      textSize: 30,
      lineHeight: 30,
    });
    const roundedRect = drawRoundedRect({
      width: ((widthMax * value) / total) * 2,
      height: 30,
      radius: 15,
      color: statConfig[key].color,
      strokeWidth: 0,
    });
    ctx.drawImage(textImage, 20, 0);
    ctx.drawImage(roundedRect, 20, 35);
    return canvas;
  }
  const list = [];
  for (const key in stat) {
    if (Object.prototype.hasOwnProperty.call(stat, key)) {
      const element = stat[key];
      list.push(drawStatLine(key, element, statTotal));
    }
  }
  return stackImage(list);
}
