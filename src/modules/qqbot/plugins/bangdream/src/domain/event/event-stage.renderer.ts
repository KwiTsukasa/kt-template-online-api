import { Event } from '@/modules/qqbot/plugins/bangdream/src/domain/event/event.model';
import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import {
  EventStage,
  Stage,
} from '@/modules/qqbot/plugins/bangdream/src/domain/event/event-stage.model';
import { serverNameFullList } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import { drawTitle } from '@/modules/qqbot/plugins/bangdream/src/theme/title.renderer';
import {
  drawEventStageTypeTop,
  drawEventStageSongHorizontal,
} from '@/modules/qqbot/plugins/bangdream/src/domain/event/event-stage-list.renderer';
import { outputEasyImages } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-output';
import { drawDataBlock } from '@/modules/qqbot/plugins/bangdream/src/theme/data-block.renderer';
import { stackImage } from '@/modules/qqbot/plugins/bangdream/src/theme/image-stack';
import {
  getEventStageStageBatchSize,
  shouldStartNewEventStageColumn,
} from '@/modules/qqbot/plugins/bangdream/src/domain/event/event-stage.layout';
import { Canvas } from 'skia-canvas';

/**
 * 在QQBot 图片视图层中绘制活动试炼。
 *
 * @param eventId - 活动 ID；定位本次读取、更新、删除或关联的活动。
 * @param mainServer - mainServer 输入；决定 BangDream条件分支。
 * @param meta - meta 输入；驱动 `stackImage()` 的 BangDream步骤。
 * @param compress - BangDream列表；影响 drawEventStage 的返回值。
 * @returns 异步处理结果。
 */
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

  const titleImage = drawTitle('查试炼', `国服 ID:${eventId} 活动试炼`);

  //获得活动stage列表
  const stageList = eventStage.getStageList();
  const outputImages: Array<Buffer | string> = [];
  let currentColumn: Canvas[] = [];
  let currentHeight = 0;
  let pageIndex = 0;
  const stageBatchSize = getEventStageStageBatchSize();

  //绘制活动stage，每个stage一个图片
  /**
   * 在QQBot 图片视图层中绘制试炼歌曲。
   *
   * @param stage - stage 输入；驱动 `stackImage()` 的 BangDream步骤。
   */
  async function drawStageSong(stage: Stage) {
    return stackImage([
      await drawEventStageTypeTop(stage),
      await drawEventStageSongHorizontal(stage, meta),
    ]);
  }

  /**
   * 执行 BangDream 插件流程。
   */
  async function flushColumn() {
    if (currentColumn.length === 0) return;
    const columnBlock = drawDataBlock({ list: currentColumn });
    const pageImages =
      pageIndex === 0 ? [titleImage, columnBlock] : [columnBlock];
    outputImages.push(...(await outputEasyImages(pageImages, { compress })));
    currentColumn = [];
    currentHeight = 0;
    pageIndex += 1;
  }

  for (let start = 0; start < stageList.length; start += stageBatchSize) {
    const stageImages = await Promise.all(
      stageList.slice(start, start + stageBatchSize).map(drawStageSong),
    );
    for (const stageImage of stageImages) {
      if (
        shouldStartNewEventStageColumn(
          currentHeight,
          stageImage.height,
          currentColumn.length,
        )
      ) {
        await flushColumn();
      }
      currentColumn.push(stageImage);
      currentHeight += stageImage.height;
    }
  }

  await flushColumn();
  return outputImages;
}
