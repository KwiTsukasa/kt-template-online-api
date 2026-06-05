import { Event } from '@/qqbot/plugins/bangDream/tsugu/domain/event';
import { Server } from '@/qqbot/plugins/bangDream/tsugu/domain/server';
import {
  EventStage,
  Stage,
} from '@/qqbot/plugins/bangDream/tsugu/domain/event-stage';
import { serverNameFullList } from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-config';
import { drawTitle } from '@/qqbot/plugins/bangDream/tsugu/layout/title';
import { Canvas } from 'skia-canvas';
import {
  drawEventStageTypeTop,
  drawEventStageSongHorizontal,
} from '@/qqbot/plugins/bangDream/tsugu/layout/list/event-stage';
import { outputEasyImages } from '@/qqbot/plugins/bangDream/tsugu/graphics/output';
import { drawDataBlock } from '@/qqbot/plugins/bangDream/tsugu/layout/data-block';
import {
  stackImage,
  stackImageHorizontal,
} from '@/qqbot/plugins/bangDream/tsugu/layout/utils';

export async function drawEventStage(
  eventId: number,
  mainServer: Server,
  meta: boolean = false,
  compress: boolean,
): Promise<Array<Buffer | string>> {
  const event = new Event(eventId);
  if (!event.isExist) {
    return [`错误: 活动不存在`];
  }
  if (event.eventType != 'festival') {
    return [`错误: 活动不是festival类型`];
  }
  if (event.startAt[mainServer] == null) {
    return [
      `错误: ${serverNameFullList[mainServer]} ID:${eventId} 活动没有时间数据`,
    ];
  }

  const eventStage = new EventStage(eventId);
  await eventStage.initFull();
  if (!eventStage.isExist) {
    return [`错误: 活动stage数据不足`];
  }

  const all = [];
  all.push(drawTitle('查试炼', `国服 ID:${eventId} 活动试炼`));

  //获得活动stage列表
  const stageList = eventStage.getStageList();

  const eventStagePromises = [];

  //绘制活动stage，每个stage一个图片
  async function drawStageSong(stage: Stage) {
    return stackImage([
      await drawEventStageTypeTop(stage),
      await drawEventStageSongHorizontal(stage, meta),
    ]);
  }

  for (let i = 0; i < stageList.length; i++) {
    const stage = stageList[i];
    eventStagePromises.push(drawStageSong(stage));
  }

  const eventStageResults = await Promise.all(eventStagePromises);

  //将活动stage图片纵向并横向合并
  let tempH = 0;
  const maxHeight = 6000;

  let tempEventStageImageList: Canvas[] = [];
  const eventStageImageListHorizontal: Canvas[] = [];

  for (let i = 0; i < eventStageResults.length; i++) {
    const tempImage = eventStageResults[i];
    tempH += tempImage.height;
    if (tempH > maxHeight) {
      if (tempEventStageImageList.length > 0) {
        eventStageImageListHorizontal.push(
          drawDataBlock({ list: tempEventStageImageList }),
        );
      }
      tempEventStageImageList = [];
      tempH = tempImage.height;
    }
    tempEventStageImageList.push(tempImage);

    if (i == eventStageResults.length - 1) {
      eventStageImageListHorizontal.push(
        drawDataBlock({ list: tempEventStageImageList }),
      );
    }
  }

  const eventStageListImage = stackImageHorizontal(
    eventStageImageListHorizontal,
  );

  all.push(eventStageListImage);

  return await outputEasyImages(all, { compress });
}
