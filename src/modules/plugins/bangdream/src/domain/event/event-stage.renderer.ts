import { Event } from '@/modules/plugins/bangdream/src/domain/event/event.model';
import { Server } from '@/modules/plugins/bangdream/src/domain/catalog/server.model';
import {
  EventStage,
  Stage,
} from '@/modules/plugins/bangdream/src/domain/event/event-stage.model';
import { serverNameFullList } from '@/modules/plugins/bangdream/src/config/runtime-config';
import { drawTitle } from '@/modules/plugins/bangdream/src/theme/title.renderer';
import {
  drawEventStageTypeTop,
  drawEventStageSongHorizontal,
} from '@/modules/plugins/bangdream/src/domain/event/event-stage-list.renderer';
import { outputEasyImages } from '@/modules/plugins/bangdream/src/theme/canvas-output';
import { drawDataBlock } from '@/modules/plugins/bangdream/src/theme/data-block.renderer';
import { stackImage } from '@/modules/plugins/bangdream/src/theme/image-stack';
import {
  getEventStageStageBatchSize,
  shouldStartNewEventStageColumn,
} from '@/modules/plugins/bangdream/src/domain/event/event-stage.layout';
import { Canvas } from 'skia-canvas';

/**
 * 根据`eventId`、`mainServer`、`meta`绘制或格式化事件阶段；当 `!event.isExist` 成立时返回 `[`错误: 活动不存在`]`。
 * @param eventId - 用于精确定位事件的标识。
 * @param mainServer - 决定事件阶段内容、边界或目标的 `mainServer` 值。
 * @param meta - 决定事件阶段内容、边界或目标的 `meta` 值；省略时默认采用 `false`。
 * @param compress - 决定事件阶段内容、边界或目标的 `compress` 值。
 * @returns 按输入顺序得到的事件阶段列表；没有匹配项时为空数组。
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
   * 根据`stage`绘制或格式化阶段歌曲。
   * @param stage - 决定阶段歌曲内容、边界或目标的 `stage` 值。
   * @returns 阶段歌曲。
   */
  async function drawStageSong(stage: Stage) {
    return stackImage([
      await drawEventStageTypeTop(stage),
      await drawEventStageSongHorizontal(stage, meta),
    ]);
  }

  /**
   * 根据当前运行态处理flush数据库列；把图片、文本或图形按布局规格绘制到画布。
   */
  async function flushColumn() {
    if (currentColumn.length === 0) return;
    const columnBlock = drawDataBlock({ list: currentColumn });
    const pageImages =
      (() => {
        if (pageIndex === 0) {
          return [titleImage, columnBlock];
        }
        return [columnBlock];
      })();
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
