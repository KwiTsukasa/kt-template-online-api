import { Canvas } from 'skia-canvas';
import { drawText } from '@/qqbot/plugins/bangDream/tsugu/graphics/text';
import { drawList } from '@/qqbot/plugins/bangDream/tsugu/layout/list';
import { stackImage } from '@/qqbot/plugins/bangDream/tsugu/layout/utils';
import { drawRoundedRect } from '@/qqbot/plugins/bangDream/tsugu/graphics/draw-rect';
import {
  Card,
  Stat,
  limitBreakRankStat,
} from '@/qqbot/plugins/bangDream/tsugu/domain/card';
import { BANGDREAM_STAT_CONFIG } from '@/qqbot/plugins/bangDream/tsugu/domain/bangdream.enum';

export const statConfig: Record<string, { color: string; name: string }> =
  BANGDREAM_STAT_CONFIG;

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

async function drawCardStatDivided(
  stat: Stat,
  statTotal: number,
  limitBreakstat?: Stat,
): Promise<Canvas> {
  const widthMax = 800;

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
