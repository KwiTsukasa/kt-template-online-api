import { Canvas } from 'skia-canvas';
import { Cutoff } from '@/modules/qqbot/plugins/bangdream/src/domain/cutoff/cutoff.model';
import { drawTimeLineChart } from '@/modules/qqbot/plugins/bangdream/src/domain/cutoff/timeline-chart.renderer';
import { Event } from '@/modules/qqbot/plugins/bangdream/src/domain/event/event.model';
import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { CutoffEventTop } from '@/modules/qqbot/plugins/bangdream/src/domain/cutoff/cutoff-event-top.model';
import { getPresetColor } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/color.model';
import { drawList } from '@/modules/qqbot/plugins/bangdream/src/theme/list-frame.renderer';
import { stackImage } from '@/modules/qqbot/plugins/bangdream/src/theme/image-stack';
import { BangDreamEventStatus } from '@/modules/qqbot/plugins/bangdream/src/domain/common/bangdream-protocol';
import {
  BANGDREAM_CUTOFF_CHART_SPEC,
  stripCutoffChartLabelTags,
} from '@/modules/qqbot/plugins/bangdream/src/domain/cutoff/cutoff-chart.layout';
import type {
  TimelineChartDataset,
  TimelineChartPoint,
} from '@/modules/qqbot/plugins/bangdream/src/domain/cutoff/timeline-chart.layout';

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
  const datasets: TimelineChartDataset[] = [];
  const time = new Date().getTime();
  if (cutoffList.length == 0) {
    return new Canvas(
      BANGDREAM_CUTOFF_CHART_SPEC.emptyCanvas.width,
      BANGDREAM_CUTOFF_CHART_SPEC.emptyCanvas.height,
    );
  }

  const list = [];

  const onlyOne = cutoffList.length == 1;
  for (let i = 0; i < cutoffList.length; i++) {
    const tempColor = getPresetColor(i);

    const cutoff = cutoffList[i];
    const tempEvent = new Event(cutoff.eventId);

    let labelName: string;
    if (setStartToZero) {
      labelName = `[${tempEvent.eventId}] ${tempEvent.eventName[server]} T${cutoff.tier}`;
      list.push(
        drawList({
          content: [
            tempColor.generateColorBlock(
              BANGDREAM_CUTOFF_CHART_SPEC.legend.colorBlockOpacity,
            ),
            `[${tempEvent.eventId}] ${tempEvent.eventName[server]} T${cutoff.tier}`,
          ],
          textSize: BANGDREAM_CUTOFF_CHART_SPEC.legend.textSize,
        }),
      );
    } else {
      labelName = `T${cutoff.tier}`;
      list.push(
        drawList({
          content: [
            tempColor.generateColorBlock(
              BANGDREAM_CUTOFF_CHART_SPEC.legend.colorBlockOpacity,
            ),
            `T${cutoff.tier}`,
          ],
          textSize: BANGDREAM_CUTOFF_CHART_SPEC.legend.textSize,
        }),
      );
    }
    datasets.push({
      label: labelName,
      data: cutoff.getChartData(setStartToZero),
      borderWidth: BANGDREAM_CUTOFF_CHART_SPEC.lineDataset.borderWidth,
      borderColor: [tempColor.getRGBA(1)],
      backgroundColor: [
        tempColor.getRGBA(
          BANGDREAM_CUTOFF_CHART_SPEC.lineDataset.singleLineFillBackgroundAlpha,
        ),
      ],
      pointBackgroundColor: tempColor.getRGBA(1),
      pointBorderColor: tempColor.getRGBA(1),
      fill: onlyOne,
    });

    if (cutoff.status == BangDreamEventStatus.inProgress) {
      if (cutoff.predictEP != null && cutoff.predictEP != 0) {
        let data: TimelineChartPoint[] = [];
        const history = cutoff.getPredictionHistory();
        if (history.length > 0) {
          if (setStartToZero) {
            for (const p of history) {
              data.push({ x: p.time - cutoff.startAt, y: p.ep });
            }
            data.push({
              x: cutoff.endAt - cutoff.startAt,
              y: history[history.length - 1].ep,
            });
          } else {
            for (const p of history) {
              data.push({ x: p.time, y: p.ep });
            }
            data.push({
              x: cutoff.endAt,
              y: history[history.length - 1].ep,
            });
          }
        } else {
          if (setStartToZero) {
            data = [
              { x: 0, y: cutoff.predictEP },
              {
                x: cutoff.endAt - cutoff.startAt,
                y: cutoff.predictEP,
              },
            ];
          } else {
            data = [
              { x: cutoff.startAt, y: cutoff.predictEP },
              { x: cutoff.endAt, y: cutoff.predictEP },
            ];
          }
        }
        const tempColor = getPresetColor(i);
        datasets.push({
          label: `T${cutoff.tier} ${BANGDREAM_CUTOFF_CHART_SPEC.lineDataset.predictionSuffix}`,
          borderColor: [
            tempColor.getRGBA(
              BANGDREAM_CUTOFF_CHART_SPEC.lineDataset.predictionBorderAlpha,
            ),
          ],
          backgroundColor: [
            tempColor.getRGBA(
              BANGDREAM_CUTOFF_CHART_SPEC.lineDataset.predictionBackgroundAlpha,
            ),
          ],
          data: data,
          borderWidth: BANGDREAM_CUTOFF_CHART_SPEC.lineDataset.borderWidth,
          borderDash: [
            ...BANGDREAM_CUTOFF_CHART_SPEC.lineDataset.predictionDash,
          ],
          fill: false,
          pointRadius:
            BANGDREAM_CUTOFF_CHART_SPEC.lineDataset.predictionPointRadius,
          pointHoverRadius:
            BANGDREAM_CUTOFF_CHART_SPEC.lineDataset.predictionPointHoverRadius,
        });
      }
    }
  }
  if (!setStartToZero) {
    if (time < cutoffList[0].endAt) {
      const tempColor = getPresetColor(0);
      datasets.push({
        label: BANGDREAM_CUTOFF_CHART_SPEC.currentTimeDataset.label,
        borderColor: [tempColor.getRGBA(1)],
        backgroundColor: [tempColor.getRGBA(1)],
        data: [{ x: time, y: 0 }],
        fill: false,
        pointRadius: BANGDREAM_CUTOFF_CHART_SPEC.currentTimeDataset.pointRadius,
        pointHoverRadius:
          BANGDREAM_CUTOFF_CHART_SPEC.currentTimeDataset.pointHoverRadius,
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
 * @param cutoffEventTop - 档线活动排名参数。
 * @param setStartToZero - setStartToZero参数，未传入时使用默认值。
 */
export async function drawCutoffEventTopChart(
  cutoffEventTop: CutoffEventTop,
  setStartToZero = false,
) {
  const datasets: TimelineChartDataset[] = [];
  if (cutoffEventTop == undefined) {
    return new Canvas(
      BANGDREAM_CUTOFF_CHART_SPEC.emptyCanvas.width,
      BANGDREAM_CUTOFF_CHART_SPEC.emptyCanvas.height,
    );
  }
  const allData = cutoffEventTop.getChartData();
  let colorNumber = 0;
  for (const key in allData) {
    const tempColor = getPresetColor(colorNumber);
    datasets.push({
      label: stripCutoffChartLabelTags(
        cutoffEventTop.getUserNameById(Number(key)),
      ),
      data: allData[key],
      borderWidth: BANGDREAM_CUTOFF_CHART_SPEC.eventTopDataset.borderWidth,
      borderColor: [tempColor.getRGBA(1)],
      backgroundColor: [
        tempColor.getRGBA(
          BANGDREAM_CUTOFF_CHART_SPEC.lineDataset.singleLineFillBackgroundAlpha,
        ),
      ],
      pointBackgroundColor: tempColor.getRGBA(
        BANGDREAM_CUTOFF_CHART_SPEC.eventTopDataset.pointAlpha,
      ),
      pointBorderColor: tempColor.getRGBA(
        BANGDREAM_CUTOFF_CHART_SPEC.eventTopDataset.pointAlpha,
      ),
      pointStyle: false,
      fill: false,
    });
    colorNumber++;
  }
  const data = { datasets: datasets };
  return await drawTimeLineChart(
    {
      data,
      start: new Date(cutoffEventTop.startAt),
      end: new Date(cutoffEventTop.endAt),
      setStartToZero,
    },
    true,
  );
}
