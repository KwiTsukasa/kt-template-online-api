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
 * 在QQBot 图片视图层中绘制档线全部。
 *
 * @param eventId - 活动 ID；定位本次读取、更新、删除或关联的活动。
 * @param mainServer - mainServer 输入；驱动 `all.push()`、`getCutoffTierList()`、`Cutoff()` 的 BangDream步骤。
 * @param compress - BangDream列表；影响 drawCutoffAll 的返回值。
 * @returns 异步处理结果。
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
