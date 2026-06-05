import { Event } from '@/qqbot/plugins/bangDream/tsugu/domain/event';
import { drawList, line } from '@/qqbot/plugins/bangDream/tsugu/layout/list';
import { drawDataBlock } from '@/qqbot/plugins/bangDream/tsugu/layout/data-block';
import { Image, Canvas } from 'skia-canvas';
import { formatTime } from '@/qqbot/plugins/bangDream/tsugu/layout/list/time';
import { Server } from '@/qqbot/plugins/bangDream/tsugu/domain/server';
import { drawTitle } from '@/qqbot/plugins/bangDream/tsugu/layout/title';
import { outputEasyImages } from '@/qqbot/plugins/bangDream/tsugu/graphics/output';
import { Cutoff } from '@/qqbot/plugins/bangDream/tsugu/domain/cutoff';
import { drawCutoffChart } from '@/qqbot/plugins/bangDream/tsugu/layout/cutoff-chart';
import {
  serverNameFullList,
  tierListOfServer,
} from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-config';
import { drawEventDataBlock } from '@/qqbot/plugins/bangDream/tsugu/layout/detail-blocks';
import { statusName } from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-config';
import { BangDreamEventStatus } from '@/qqbot/plugins/bangDream/tsugu/domain/bangdream.enum';

export async function drawCutoffAll(
  eventId: number,
  mainServer: Server,
  compress: boolean,
): Promise<Array<Buffer | string>> {
  const event = new Event(eventId);
  if (!event.isExist) {
    return ['活动不存在'];
  }
  if (event.startAt[mainServer] == undefined) {
    return ['活动在该服务器不存在'];
  }
  const all = [];
  all.push(drawTitle('档线列表', `${serverNameFullList[mainServer]}`));
  all.push(await drawEventDataBlock(event, [mainServer]));

  const list: Array<Image | Canvas> = [];

  //初始化档线列表
  const tierList = tierListOfServer[Server[mainServer]];
  const cutoffList: Array<Cutoff> = [];
  for (const i in tierList) {
    const tempCutoff = new Cutoff(eventId, mainServer, tierList[i]);
    await tempCutoff.initFull();
    if (tempCutoff.status == BangDreamEventStatus.inProgress) {
      tempCutoff.predict();
    }
    cutoffList.push(tempCutoff);
  }

  //状态
  list.push(
    drawList({
      key: '状态',
      text: statusName[cutoffList[0].status],
    }),
  );

  list.push(line);
  //每个档线详细数据
  for (const i in cutoffList) {
    const cutoff = cutoffList[i];
    if (!cutoff.latestCutoff) continue;
    const cutoffContent: string[] = [];
    if (cutoff.status == BangDreamEventStatus.inProgress) {
      let predictText: string;
      if (cutoff.predictEP == null || cutoff.predictEP == 0) {
        predictText = '?';
      } else {
        predictText = cutoff.predictEP.toString();
      }
      cutoffContent.push(`当前预测线: ${predictText}\n`);
      cutoffContent.push(`最新分数线: ${cutoff.latestCutoff.ep.toString()}\n`);
      cutoffContent.push(`更新时间:${formatTime(cutoff.latestCutoff.time)}\n`);
      cutoffContent.push(`日增：${cutoff.dailyIncrement.join('/')}`);
    } else if (cutoff.status == BangDreamEventStatus.ended) {
      cutoffContent.push(`最终分数线:${cutoff.latestCutoff.ep.toString()}\n`);
      cutoffContent.push(`日增：${cutoff.dailyIncrement.join('/')}`);
    }

    list.push(
      drawList({
        key: `T${cutoff.tier}`,
        content: cutoffContent,
      }),
    );
    list.push(line);
  }
  list.pop();
  list.push(new Canvas(800, 50));

  //折线图
  list.push(await drawCutoffChart(cutoffList));

  //创建最终输出数组
  const listImage = drawDataBlock({ list });

  all.push(listImage);
  return await outputEasyImages(all, { compress });
}
