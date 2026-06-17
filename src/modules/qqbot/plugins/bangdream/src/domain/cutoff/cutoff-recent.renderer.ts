import {
  Event,
  getRecentEventListByEventAndServer,
} from '@/modules/qqbot/plugins/bangdream/src/domain/event/event.model';
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
import { drawAttributeInList } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/attribute-list.renderer';
import { drawCharacterInList } from '@/modules/qqbot/plugins/bangdream/src/domain/character/character-list.renderer';
import { BangDreamEventStatus } from '@/modules/qqbot/plugins/bangdream/src/domain/common/bangdream-protocol';

/**
 * 在QQBot 图片视图层中绘制档线列表Of最近活动。
 *
 * @param eventId - 活动 ID；定位本次读取、更新、删除或关联的活动。
 * @param tier - tier 输入；驱动 `Cutoff()` 的 BangDream步骤。
 * @param mainServer - mainServer 输入；驱动 `Cutoff()`、`all.push()`、`getRecentEventListByEventAndServer()`、`list.push()` 的 BangDream步骤。
 * @param compress - BangDream列表；影响 drawCutoffListOfRecentEvent 的返回值。
 * @returns 异步处理结果。
 */
export async function drawCutoffListOfRecentEvent(
  eventId: number,
  tier: number,
  mainServer: Server,
  compress: boolean,
): Promise<Array<Buffer | string>> {
  //检查
  const event = new Event(eventId);
  if (!event.isExist) {
    return ['活动不存在'];
  }
  if (event.startAt[mainServer] == undefined) {
    return ['活动在该服务器不存在'];
  }
  const tempcutoff = new Cutoff(eventId, mainServer, tier);
  if (tempcutoff.isExist == false) {
    return [`错误: ${serverNameFullList[mainServer]} 活动或档线不存在`];
  }

  const all = [];
  all.push(
    drawTitle(
      '历史的档线对比',
      `${serverNameFullList[mainServer]} ${tier}档线`,
    ),
  );
  all.push(await drawEventDataBlock(event, [mainServer]));

  const list: Array<Image | Canvas> = [];

  //初始化档线列表
  const cutoffList: Array<Cutoff> = [];
  const eventList = getRecentEventListByEventAndServer(
    event,
    mainServer,
    5,
    true,
  );
  for (let i = eventList.length - 1; i >= 0; i--) {
    const cutoff = new Cutoff(eventList[i].eventId, mainServer, tier);
    await cutoff.initFull();
    cutoffList.push(cutoff);
  }
  //每个档线详细数据
  for (const i in cutoffList) {
    const cutoff = cutoffList[i];
    if (!cutoff.latestCutoff) continue;
    const tempEvent = new Event(cutoff.eventId);
    list.push(
      drawList({
        key: `ID:${cutoff.eventId} ${tempEvent.eventName[mainServer]}`,
      }),
    );
    //添加活动粗略信息，包括Attribute，Charactor
    //attribute
    const attributeList = tempEvent.getAttributeList();
    for (const i in attributeList) {
      if (Object.prototype.hasOwnProperty.call(attributeList, i)) {
        const element = attributeList[i];
        list.push(
          await drawAttributeInList({
            content: element,
            text: ` +${i}%`,
          }),
        );
      }
    }
    //charactor
    const characterList = tempEvent.getCharacterList();
    for (const i in characterList) {
      if (Object.prototype.hasOwnProperty.call(characterList, i)) {
        const element = characterList[i];
        list.push(
          await drawCharacterInList({
            content: element,
            text: ` +${i}%`,
          }),
        );
      }
    }
    const cutoffContent: Array<Canvas | Image | string> = [];

    //状态
    if (cutoff.status == BangDreamEventStatus.inProgress) {
      cutoff.predict();
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
      cutoffContent.push(`最终分数线: ${cutoff.latestCutoff.ep.toString()}\n`);
      cutoffContent.push(`日增：${cutoff.dailyIncrement.join('/')}`);
    }

    list.push(
      drawList({
        content: cutoffContent,
      }),
    );
    list.push(line);
  }
  list.pop();
  list.push(new Canvas(800, 50));

  //折线图
  list.push(await drawCutoffChart(cutoffList, true, mainServer));

  //创建最终输出数组
  const listImage = drawDataBlock({ list });

  all.push(listImage);
  return await outputEasyImages(all, { compress });
}
