import { Canvas } from 'skia-canvas';
import { drawText } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-text';
import { drawList } from '@/modules/qqbot/plugins/bangdream/src/theme/list-frame.renderer';
import { stackImage } from '@/modules/qqbot/plugins/bangdream/src/theme/image-stack';
import { drawRoundedRect } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-rect';
import {
  Card,
  Stat,
  limitBreakRankStat,
} from '@/modules/qqbot/plugins/bangdream/src/domain/card/card.model';
import { BANGDREAM_STAT_CONFIG } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-options';
import {
  BANGDREAM_STAT_LIST_SPEC,
  createStatLineText,
  getStatLineBarLayout,
} from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-stat.layout';

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
  list.push(
    new Canvas(
      BANGDREAM_STAT_LIST_SPEC.spacer.width,
      BANGDREAM_STAT_LIST_SPEC.spacer.height,
    ),
  );
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
  list.push(
    new Canvas(
      BANGDREAM_STAT_LIST_SPEC.spacer.width,
      BANGDREAM_STAT_LIST_SPEC.spacer.height,
    ),
  );
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
  /**
   * 在图片布局层中绘制数值线条。
   *
   * @param key - 当前字段键名。
   * @param value - 当前处理的值。
   * @param total - total参数。
   * @returns 渲染或资源结果。
   */
  function drawStatLine(key: string, value: number, total: number): Canvas {
    const canvas = new Canvas(
      BANGDREAM_STAT_LIST_SPEC.line.canvas.width,
      BANGDREAM_STAT_LIST_SPEC.line.canvas.height,
    );
    const ctx = canvas.getContext('2d');
    const text = createStatLineText({
      label: statConfig[key].name,
      limitBreakValue: limitBreakstat?.[key],
      value,
    });
    const textSpec = BANGDREAM_STAT_LIST_SPEC.line.text;
    const textImage = drawText({
      text,
      maxWidth: textSpec.maxWidth,
      textSize: textSpec.textSize,
      lineHeight: textSpec.lineHeight,
    });
    const barLayout = getStatLineBarLayout(value, total);
    const roundedRect = drawRoundedRect({
      width: barLayout.width,
      height: barLayout.height,
      radius: barLayout.radius,
      color: statConfig[key].color,
      strokeWidth: barLayout.strokeWidth,
    });
    ctx.drawImage(textImage, textSpec.x, textSpec.y);
    ctx.drawImage(roundedRect, barLayout.x, barLayout.y);
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
