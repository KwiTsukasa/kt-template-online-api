import { Event } from '@/modules/qqbot/plugins/bangdream/src/domain/event/event.model';
import {
  drawList,
  line,
} from '@/modules/qqbot/plugins/bangdream/src/theme/list-frame.renderer';
import { drawDataBlock } from '@/modules/qqbot/plugins/bangdream/src/theme/data-block.renderer';
import { Image, Canvas } from 'skia-canvas';
import { formatTime } from '@/modules/qqbot/plugins/bangdream/src/domain/event/event-time.renderer';
import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { drawTitle } from '@/modules/qqbot/plugins/bangdream/src/theme/title.renderer';
import { outputEasyImages } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-output';
import { Cutoff } from '@/modules/qqbot/plugins/bangdream/src/domain/cutoff/cutoff.model';
import { drawCutoffChart } from '@/modules/qqbot/plugins/bangdream/src/domain/cutoff/cutoff-chart.renderer';
import { serverNameFullList } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import { drawEventDataBlock } from '@/modules/qqbot/plugins/bangdream/src/theme/detail-block.renderer';
import { statusName } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import { BangDreamEventStatus } from '@/modules/qqbot/plugins/bangdream/src/domain/common/bangdream-protocol';
import { getCutoffTierList } from '@/modules/qqbot/plugins/bangdream/src/domain/policy/cutoff.policy';

/**
 * 根据`eventId`、`mainServer`、`compress`绘制或格式化档线；当 `!event.isExist` 成立时返回 `['活动不存在']`。
 * @param eventId - 用于精确定位事件的标识。
 * @param mainServer - 决定档线内容、边界或目标的 `mainServer` 值。
 * @param compress - 决定档线内容、边界或目标的 `compress` 值。
 * @returns 按输入顺序得到的档线列表；没有匹配项时为空数组。
 */
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
  const tierList = getCutoffTierList(mainServer);
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
