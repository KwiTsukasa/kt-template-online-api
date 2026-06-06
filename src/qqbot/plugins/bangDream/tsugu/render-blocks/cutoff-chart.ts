import { Canvas } from 'skia-canvas';
import { Cutoff } from '@/qqbot/plugins/bangDream/tsugu/models/cutoff';
import { drawTimeLineChart } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/timeline-chart';
import { Event } from '@/qqbot/plugins/bangDream/tsugu/models/event';
import { Server } from '@/qqbot/plugins/bangDream/tsugu/models/server';
import { CutoffEventTop } from '@/qqbot/plugins/bangDream/tsugu/models/cutoff-event-top';
import { getPresetColor } from '@/qqbot/plugins/bangDream/tsugu/models/color';
import { drawList } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/list-frame';
import { stackImage } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/image-stack';
import { BangDreamEventStatus } from '@/qqbot/plugins/bangDream/tsugu/models/bangdream-constants';

/**
 * 在图片布局层中绘制档线谱面。
 *
 * @param cutoffList - 档线列表参数。
 * @param setStartToZero - setStartToZero参数，未传入时使用默认值。
 * @param server - 目标服务器，未传入时使用默认值。
 */
export async function drawCutoffChart(
  cutoffList: Cutoff[],
  setStartToZero = false,
  server: Server = Server['jp'],
) {
  //setStartToZero:是否将开始时间设置为0
  const datasets = [];
  const time = new Date().getTime();
  if (cutoffList.length == 0) {
    return new Canvas(1, 1);
  }

  const list = [];

  const onlyOne = cutoffList.length == 1;
  for (let i = 0; i < cutoffList.length; i++) {
    const tempColor = getPresetColor(i);

    const cutoff = cutoffList[i];
    const tempEvent = new Event(cutoff.eventId);

    let lableName: string;
    if (setStartToZero) {
      lableName = `[${tempEvent.eventId}] ${tempEvent.eventName[server]} T${cutoff.tier}`;
      list.push(
        drawList({
          content: [
            tempColor.generateColorBlock(0.8),
            `[${tempEvent.eventId}] ${tempEvent.eventName[server]} T${cutoff.tier}`,
          ],
          textSize: 20,
        }),
      );
    } else {
      lableName = `T${cutoff.tier}`;
      list.push(
        drawList({
          content: [tempColor.generateColorBlock(0.8), `T${cutoff.tier}`],
          textSize: 20,
        }),
      );
    }
    datasets.push({
      label: lableName,
      data: cutoff.getChartData(setStartToZero),
      borderWidth: 5,
      borderColor: [tempColor.getRGBA(1)],
      backgroundColor: [tempColor.getRGBA(0.2)],
      pointBackgroundColor: tempColor.getRGBA(1),
      pointBorderColor: tempColor.getRGBA(1),
      fill: onlyOne,
    });

    if (cutoff.status == BangDreamEventStatus.inProgress) {
      if (cutoff.predictEP != null && cutoff.predictEP != 0) {
        let data = [];
        const history = cutoff.getPredictionHistory();
        if (history.length > 0) {
          if (setStartToZero) {
            for (const p of history) {
              data.push({ x: new Date(p.time - cutoff.startAt), y: p.ep });
            }
            data.push({
              x: new Date(cutoff.endAt - cutoff.startAt),
              y: history[history.length - 1].ep,
            });
          } else {
            for (const p of history) {
              data.push({ x: new Date(p.time), y: p.ep });
            }
            data.push({
              x: new Date(cutoff.endAt),
              y: history[history.length - 1].ep,
            });
          }
        } else {
          if (setStartToZero) {
            data = [
              { x: new Date(0), y: cutoff.predictEP },
              {
                x: new Date(cutoff.endAt - cutoff.startAt),
                y: cutoff.predictEP,
              },
            ];
          } else {
            data = [
              { x: new Date(cutoff.startAt), y: cutoff.predictEP },
              { x: new Date(cutoff.endAt), y: cutoff.predictEP },
            ];
          }
        }
        const tempColor = getPresetColor(i);
        datasets.push({
          label: `T${cutoff.tier} 预测线`,
          borderColor: [tempColor.getRGBA(1)],
          backgroundColor: [tempColor.getRGBA(1)],
          data: data,
          borderWidth: 5,
          borderDash: [20, 10],
          fill: false,
          pointRadius: 0,
          pointHoverRadius: 0,
        });
      }
    }
  }
  if (!setStartToZero) {
    if (time < cutoffList[0].endAt) {
      const tempColor = getPresetColor(0);
      datasets.push({
        label: '当前时间',
        borderColor: [tempColor.getRGBA(1)],
        backgroundColor: [tempColor.getRGBA(1)],
        data: [{ x: new Date(time), y: 0 }],
        fill: false,
        pointRadius: 10,
        pointHoverRadius: 15,
        showLine: false,
      });
    }
  }
  const all = [];
  all.push(stackImage(list));

  const data = {
    datasets: datasets,
  };
  if (setStartToZero) {
    let longestTime = 0;
    for (let i = 0; i < cutoffList.length; i++) {
      const cutoff = cutoffList[i];
      if (cutoff.endAt - cutoff.startAt > longestTime) {
        longestTime = cutoff.endAt - cutoff.startAt;
      }
    }
    all.push(
      await drawTimeLineChart({
        data,
        start: new Date(0),
        end: new Date(longestTime),
        setStartToZero,
      }),
    );
    return stackImage(all);
  } else {
    all.push(
      await drawTimeLineChart({
        data,
        start: new Date(cutoffList[0].startAt),
        end: new Date(cutoffList[0].endAt),
        setStartToZero,
      }),
    );
    return stackImage(all);
  }
}
/**
 * 在图片布局层中绘制档线活动排名谱面。
 *
 * @param CutoffEventTop - 档线活动排名参数。
 * @param setStartToZero - setStartToZero参数，未传入时使用默认值。
 */
export async function drawCutoffEventTopChart(
  CutoffEventTop: CutoffEventTop,
  setStartToZero = false,
) {
  const datasets = [];
  if (CutoffEventTop == undefined) {
    return new Canvas(1, 1);
  }
  const allData = CutoffEventTop.getChartData();
  /**
   * 在图片布局层中移除Braces。
   *
   * @param text - 待绘制文本。
   * @returns 格式化后的文本。
   */
  function removeBraces(text: string): string {
    const newText = text.replace(/\[[^\]]*\]/g, '');
    return newText;
  }
  let colorNumber = 0;
  for (const key in allData) {
    const tempColor = getPresetColor(colorNumber);
    datasets.push({
      label: removeBraces(CutoffEventTop.getUserNameById(Number(key))),
      data: allData[key],
      borderWidth: 4,
      borderColor: [tempColor.getRGBA(1)],
      backgroundColor: [tempColor.getRGBA(0.2)],
      pointBackgroundColor: tempColor.getRGBA(0),
      pointBorderColor: tempColor.getRGBA(0),
      pointStyle: false,
      fill: false,
    });
    colorNumber++;
  }
  const data = { datasets: datasets };
  return await drawTimeLineChart(
    {
      data,
      start: new Date(CutoffEventTop.startAt),
      end: new Date(CutoffEventTop.endAt),
      setStartToZero,
    },
    true,
  );
}
