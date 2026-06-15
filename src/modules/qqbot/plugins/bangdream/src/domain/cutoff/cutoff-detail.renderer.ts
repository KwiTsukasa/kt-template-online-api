import { Event } from '@/modules/qqbot/plugins/bangdream/src/domain/event/event.model';
import {
  drawList,
  line,
  drawListMerge,
} from '@/modules/qqbot/plugins/bangdream/src/theme/list-frame.renderer';
import { drawDataBlock } from '@/modules/qqbot/plugins/bangdream/src/theme/data-block.renderer';
import { Image, Canvas } from 'skia-canvas';
import { formatTimePeriod } from '@/modules/qqbot/plugins/bangdream/src/domain/event/event-time.renderer';
import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { drawTitle } from '@/modules/qqbot/plugins/bangdream/src/theme/title.renderer';
import { outputEasyImages } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-output';
import { Cutoff } from '@/modules/qqbot/plugins/bangdream/src/domain/cutoff/cutoff.model';
import { drawCutoffChart } from '@/modules/qqbot/plugins/bangdream/src/domain/cutoff/cutoff-chart.renderer';
import { serverNameFullList } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import { drawEventDataBlock } from '@/modules/qqbot/plugins/bangdream/src/theme/detail-block.renderer';
import { statusName } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import { bangdreamCatalogRepository } from '@/modules/qqbot/plugins/bangdream/src/application/catalog/bangdream-catalog-repository';
import { BangDreamEventStatus } from '@/modules/qqbot/plugins/bangdream/src/domain/common/bangdream-protocol';

/**
 * 在QQBot 图片视图层中绘制档线详情。
 *
 * @param eventId - 活动 ID。
 * @param tier - tier参数。
 * @param mainServer - 主数据服务器参数。
 * @param compress - compress参数。
 * @returns 异步处理结果。
 */
export async function drawCutoffDetail(
  eventId: number,
  tier: number,
  mainServer: Server,
  compress: boolean,
): Promise<Array<Buffer | string>> {
  const eventData = bangdreamCatalogRepository.getEntity<Record<string, any>>(
    'events',
    eventId,
  );
  if (!eventData?.['endAt']?.[mainServer])
    return [`错误: ${serverNameFullList[mainServer]} 活动不存在或未举办`];
  const event = new Event(eventId);
  const cutoff = new Cutoff(eventId, mainServer, tier);
  if (cutoff.isExist == false) {
    return [`错误: ${serverNameFullList[mainServer]} 活动或档线不存在`];
  }
  await cutoff.initFull();
  if (!cutoff.latestCutoff)
    return [`错误: ${serverNameFullList[mainServer]} 活动或档线暂不存在`];
  /*
    if (cutoff.isExist == false) {
        return '错误: 活动或档线数据错误'
    }
    */

  const all = [];
  all.push(
    drawTitle('预测线', `${serverNameFullList[mainServer]} ${cutoff.tier}档线`),
  );
  const list: Array<Image | Canvas> = [];
  all.push(await drawEventDataBlock(event, [mainServer]));

  //状态
  const time = new Date().getTime();

  //如果活动在进行中
  if (cutoff.status == BangDreamEventStatus.inProgress) {
    cutoff.predict();
    const predictText =
      cutoff.predictEP == null || cutoff.predictEP == 0
        ? '?'
        : cutoff.predictEP.toString();

    //预测线和时速
    const cutoffs = cutoff.cutoffs;
    const lastEp = cutoffs.length > 1 ? cutoffs[cutoffs.length - 2].ep : 0;
    const timeSpan =
      (cutoffs.length > 1
        ? cutoff.latestCutoff.time - cutoffs[cutoffs.length - 2].time
        : cutoff.latestCutoff.time - cutoff.startAt) /
      (1000 * 3600);
    list.push(
      drawListMerge([
        drawList({
          key: '预测线',
          text: predictText,
        }),

        drawList({
          key: '当前时速',
          text: `${Math.round((cutoff.latestCutoff.ep - lastEp) / timeSpan)} pt/h`,
        }),
      ]),
    );
    list.push(line);

    const tempImageList = [];
    //最新分数线
    const finalCutoffImage = drawList({
      key: '最新分数线',
      text: cutoff.latestCutoff.ep.toString(),
    });
    tempImageList.push(finalCutoffImage);

    //更新时间
    const finalTimeImage = drawList({
      key: `更新时间 / ${cutoff.useHHWX ? 'HHWX' : 'Bestdori'}`,
      text: `${formatTimePeriod(new Date().getTime() - cutoff.latestCutoff.time)}前`,
    });
    tempImageList.push(finalTimeImage);

    list.push(drawListMerge(tempImageList)); //合并两个list
    list.push(line);
    const tempList = [];
    //活动剩余时间

    tempList.push(
      drawList({
        key: '活动剩余时间',
        text: `${formatTimePeriod(cutoff.endAt - time)}`,
      }),
    );
    tempList.push(
      drawList({
        key: '线性外推',
        text: cutoffs[cutoffs.length - 1]
          ? Math.round(
              ((cutoff.latestCutoff.ep - lastEp) / timeSpan) *
                ((event.endAt[mainServer] - cutoffs[cutoffs.length - 1].time) /
                  3600000) +
                cutoffs[cutoffs.length - 1].ep,
            ).toString()
          : '无数据',
      }),
    );
    list.push(drawListMerge(tempList));
    list.push(line);
    list.push(
      drawList({
        key: '日增速',
        text: `${cutoff.dailyIncrement.join('/')}\n${cutoff.getYesterdayIncrementRate()}`,
      }),
    );
    list.push(line); // 下面有一个pop
  } else if (cutoff.status == BangDreamEventStatus.ended) {
    list.push(
      drawList({
        key: '状态',
        text: statusName[cutoff.status],
      }),
    );
    list.push(line);

    //最新分数线
    list.push(
      drawList({
        key: '最终分数线',
        text: cutoff.latestCutoff.ep.toString(),
      }),
    );
    list.push(line);
    const tempList = [];
    tempList.push(
      await drawList({
        key: '日增速',
        text: `${cutoff.dailyIncrement.join('/')}`,
      }),
    );
    list.push(drawListMerge(tempList));
    list.push(line);
  }
  list.pop();
  list.push(new Canvas(800, 50));

  //折线图
  list.push(await drawCutoffChart([cutoff]));

  //创建最终输出数组
  const listImage = drawDataBlock({ list });

  all.push(listImage);
  return await outputEasyImages(all, { compress });
}
