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
 * 根据`card`绘制或格式化卡牌统计值。
 * @param card - 用于卡牌统计值的领域对象，包含 `calcStat`、`rarity` 字段。
 * @returns 卡牌统计值。
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
 * 根据`stat`绘制或格式化统计值。
 * @param stat - 用于统计值的领域对象，包含 `performance`、`technique`、`visual` 字段。
 * @returns 统计值。
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
 * 根据`stat`、`statTotal`、`limitBreakstat`绘制或格式化卡牌统计值Divided。
 * @param stat - 用于卡牌统计值Divided的领域对象，包含 `key` 字段。
 * @param statTotal - 决定卡牌统计值Divided内容、边界或目标的 `statTotal` 值。
 * @param limitBreakstat - 用于卡牌统计值Divided的领域对象，包含 `key` 字段；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 卡牌统计值Divided。
 */
async function drawCardStatDivided(
  stat: Stat,
  statTotal: number,
  limitBreakstat?: Stat,
): Promise<Canvas> {
  /**
   * 根据`key`、`value`、`total`绘制或格式化统计值文本行；把图片、文本或图形按布局规格绘制到画布。
   * @param key - 用于读取或更新统计值文本行的稳定键。
   * @param value - 参与统计值文本行比较、格式化或输出的候选值。
   * @param total - 决定统计值文本行内容、边界或目标的 `total` 值。
   * @returns 统计值文本行。
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
