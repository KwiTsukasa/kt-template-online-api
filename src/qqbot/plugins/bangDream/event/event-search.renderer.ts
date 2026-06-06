import { Card } from '@/qqbot/plugins/bangDream/card/card.model';
import {
  match,
  FuzzySearchResult,
} from '@/qqbot/plugins/bangDream/search/fuzzy-search';
import { Canvas } from 'skia-canvas';
import {
  drawDataBlock,
  drawDataBlockHorizontal,
} from '@/qqbot/plugins/bangDream/shared/data-block.renderer';
import { line } from '@/qqbot/plugins/bangDream/shared/list-frame.renderer';
import {
  stackImage,
  stackImageHorizontal,
  resizeImage,
} from '@/qqbot/plugins/bangDream/shared/image-stack';
import { drawTitle } from '@/qqbot/plugins/bangDream/shared/title.renderer';
import { outputEasyImages } from '@/qqbot/plugins/bangDream/theme/canvas-output';
import {
  Server,
  getIcon,
  getServerByName,
} from '@/qqbot/plugins/bangDream/catalog/server.model';
import {
  Event,
  getPresentEvent,
  sortEventList,
} from '@/qqbot/plugins/bangDream/event/event.model';
import { drawCardListInList } from '@/qqbot/plugins/bangDream/card/card-icon.renderer';
import {
  getProbableTimeDifference,
  formatTime,
} from '@/qqbot/plugins/bangDream/event/event-time.renderer';
import { drawTextWithImages } from '@/qqbot/plugins/bangDream/theme/canvas-text';
import { getEventGachaAndCardList } from '@/qqbot/plugins/bangDream/event/event-detail.renderer';
import { drawDottedLine } from '@/qqbot/plugins/bangDream/theme/canvas-dotted-line';
import { statConfig } from '@/qqbot/plugins/bangDream/card/card-stat.renderer';
import { globalDefaultServer } from '@/qqbot/plugins/bangDream/config/runtime-config';
import { createTsuguEntityMatcher } from '@/qqbot/plugins/bangDream/search/entity-list-matcher';
import { eventRepository } from '@/qqbot/plugins/bangDream/event/event.repository';
import { createVerticalSeparatorSpec } from '@/qqbot/plugins/bangDream/theme/layout';

const maxHeight = 7000;
const maxColumns = 7;

//表格用默认虚线
export const line2: Canvas = drawDottedLine(
  createVerticalSeparatorSpec(7000, { startX: 5 }),
);

/**
 * 在QQBot 图片视图层中绘制活动列表。
 *
 * @param matches - 模糊搜索命中结果。
 * @param displayedServerList - 允许展示或下载资源的服务器优先级列表，未传入时使用默认值。
 * @param compress - compress参数。
 * @returns 异步处理结果。
 */
export async function drawEventList(
  matches: FuzzySearchResult,
  displayedServerList: Server[] = globalDefaultServer,
  compress: boolean,
): Promise<Array<Buffer | string>> {
  //计算模糊搜索结果
  const tempEventList = matchEventList(matches, displayedServerList);
  if (tempEventList.length == 0) {
    return ['没有搜索到符合条件的活动'];
  }

  // 按照开始时间排序
  sortEventList(tempEventList, displayedServerList);

  const eventPromises: Promise<{ index: number; image: Canvas }>[] = [];
  let tempH = 0;

  for (let i = 0; i < tempEventList.length; i++) {
    eventPromises.push(
      drawEventInList(tempEventList[i], displayedServerList).then((image) => ({
        index: i,
        image: image,
      })),
    );
  }

  const eventResults = await Promise.all(eventPromises);

  eventResults.sort((a, b) => a.index - b.index);

  let tempEventImageList: Canvas[] = [];
  const eventImageListHorizontal: Canvas[] = [];

  for (let i = 0; i < eventResults.length; i++) {
    const tempImage = eventResults[i].image;
    tempH += tempImage.height;
    if (tempH > maxHeight) {
      if (tempEventImageList.length > 0) {
        eventImageListHorizontal.push(stackImage(tempEventImageList));
        eventImageListHorizontal.push(line2);
      }
      tempEventImageList = [];
      tempH = tempImage.height;
    }
    tempEventImageList.push(tempImage);
    tempEventImageList.push(line);
    //最后一张图
    if (i == eventResults.length - 1) {
      eventImageListHorizontal.push(stackImage(tempEventImageList));
      eventImageListHorizontal.push(line2);
    }
  }

  eventImageListHorizontal.pop();

  if (eventImageListHorizontal.length > maxColumns) {
    const tempImageList: Array<string | Buffer> = [];
    tempImageList.push('活动列表过长，已经拆分输出');
    for (let i = 0; i < eventImageListHorizontal.length; i++) {
      const tempCanvas = eventImageListHorizontal[i];
      if (tempCanvas == line2) {
        continue;
      }
      const all = [];
      all.push(drawDataBlock({ list: [tempCanvas] }));
      const [buffer] = await outputEasyImages(all);
      tempImageList.push(buffer);
    }
    return tempImageList;
  } else {
    const all = [];
    const eventListImage = drawDataBlockHorizontal({
      list: eventImageListHorizontal,
    });
    all.push(drawTitle('查询', '活动列表'));
    all.push(eventListImage);
    return await outputEasyImages(all, { compress });
  }
}

const matchEventList = createTsuguEntityMatcher<Event>({
  source: () => eventRepository.getSource(),
  /**
   * 在QQBot 图片视图层中创建Entity。
   *
   * @param eventId - 活动 ID。
   */
  createEntity: (eventId) => eventRepository.create(eventId),
  /**
   * 在QQBot 图片视图层中判断Released。
   *
   * @param event - 活动参数。
   * @param displayedServerList - 允许展示或下载资源的服务器优先级列表。
   */
  isReleased: (event, displayedServerList) =>
    displayedServerList.some((server) => event.startAt[server] != null),
  /**
   * 在QQBot 图片视图层中判断Matched。
   *
   * @param matches - 模糊搜索命中结果。
   * @param event - 活动参数。
   */
  isMatched: (matches, event) => match(matches, event, []),
  /**
   * 在QQBot 图片视图层中处理关系表达式值。
   *
   * @param event - 活动参数。
   */
  relationValue: (event) => event.eventId,
});

/**
 * 在QQBot 图片视图层中绘制活动In列表。
 *
 * @param event - 活动参数。
 * @param displayedServerList - 允许展示或下载资源的服务器优先级列表，未传入时使用默认值。
 * @returns 异步处理结果。
 */
async function drawEventInList(
  event: Event,
  displayedServerList: Server[] = globalDefaultServer,
): Promise<Canvas> {
  await event.initFull(false);
  const textSize = (25 * 3) / 4;
  const content = [];
  //活动类型
  content.push(
    `ID: ${event.eventId.toString()}  ${await event.getTypeName()}\n`,
  );
  //活动时间
  const numberOfServer = Math.min(displayedServerList.length, 2);
  const currentEvent = getPresentEvent(getServerByName('cn'));
  for (let i = 0; i < numberOfServer; i++) {
    const server = displayedServerList[i];
    if (server == getServerByName('cn') && event.startAt[server] == null) {
      // && event.eventId > currentEvent.eventId
      content.push(
        await getIcon(server),
        `${formatTime(getProbableTimeDifference(event.eventId, currentEvent))} (预计开放时间)\n`,
      );
    } else {
      content.push(
        await getIcon(server),
        `${formatTime(event.startAt[server])} - ${formatTime(event.endAt[server])}\n`,
      );
    }
  }
  //活动加成
  //属性
  const attributeList = event.getAttributeList();
  for (const percent in attributeList) {
    for (let i = 0; i < attributeList[percent].length; i++) {
      content.push(await attributeList[percent][i].getIcon());
    }
    content.push(`+${percent}% `);
  }

  //角色
  const characterList = event.getCharacterList();
  for (const percent in characterList) {
    for (let i = 0; i < characterList[percent].length; i++) {
      content.push(await characterList[percent][i].getIcon());
    }
    content.push(`+${percent}% `);
  }

  //偏科，如果有的话
  if (Object.keys(event.eventCharacterParameterBonus).length != 0) {
    let statText = '';
    for (const i in event.eventCharacterParameterBonus) {
      if (i == 'eventId') {
        continue;
      }
      if (
        Object.prototype.hasOwnProperty.call(
          event.eventCharacterParameterBonus,
          i,
        )
      ) {
        const element = event.eventCharacterParameterBonus[i];
        if (element == 0) {
          continue;
        }
        statText += ` ${statConfig[i].name} +${element}%`;
      }
    }
    content.push(statText);
  }

  const textImage = drawTextWithImages({
    content: content,
    textSize,
    maxWidth: 500,
  });
  const eventBannerImage = resizeImage({
    image: await event.getBannerImage(),
    heightMax: 100,
  });
  const imageUp = stackImageHorizontal([
    eventBannerImage,
    new Canvas(20, 1),
    textImage,
  ]);

  //活动期间卡池卡牌
  const cardList: Card[] = [];
  const cardIdList: number[] = []; //用于去重
  for (let i = 0; i < displayedServerList.length; i++) {
    const server = displayedServerList[i];
    const EventGachaAndCardList = await getEventGachaAndCardList(
      event,
      server,
      true,
    );
    const tempGachaCardList = EventGachaAndCardList.gachaCardList;
    for (let i = 0; i < tempGachaCardList.length; i++) {
      const tempCard = tempGachaCardList[i];
      if (cardIdList.indexOf(tempCard.cardId) != -1) {
        continue;
      }
      cardIdList.push(tempCard.cardId);
      cardList.push(tempCard);
    }
  }
  const rewardCards = event.rewardCards;
  for (let i = 0; i < rewardCards.length; i++) {
    cardList.push(new Card(rewardCards[i]));
  }
  const imageDown = await drawCardListInList({
    cardList: cardList,
    lineHeight: 120,
    trainingStatus: false,
    cardIdVisible: true,
  });
  return stackImage([imageUp, imageDown]);
}
