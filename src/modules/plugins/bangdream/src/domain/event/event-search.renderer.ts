import { Card } from '@/modules/plugins/bangdream/src/domain/card/card.model';
import {
  match,
  FuzzySearchResult,
} from '@/modules/plugins/bangdream/src/domain/search/fuzzy-search';
import { Canvas } from 'skia-canvas';
import {
  drawDataBlock,
  drawDataBlockHorizontal,
} from '@/modules/plugins/bangdream/src/theme/data-block.renderer';
import { line } from '@/modules/plugins/bangdream/src/theme/list-frame.renderer';
import {
  stackImage,
  stackImageHorizontal,
  resizeImage,
} from '@/modules/plugins/bangdream/src/theme/image-stack';
import { drawTitle } from '@/modules/plugins/bangdream/src/theme/title.renderer';
import { outputEasyImages } from '@/modules/plugins/bangdream/src/theme/canvas-output';
import {
  Server,
  getIcon,
  getServerByName,
} from '@/modules/plugins/bangdream/src/domain/catalog/server.model';
import {
  Event,
  getPresentEvent,
  sortEventList,
} from '@/modules/plugins/bangdream/src/domain/event/event.model';
import { drawCardListInList } from '@/modules/plugins/bangdream/src/domain/card/card-icon.renderer';
import {
  getProbableTimeDifference,
  formatTime,
} from '@/modules/plugins/bangdream/src/domain/event/event-time.renderer';
import { drawTextWithImages } from '@/modules/plugins/bangdream/src/theme/canvas-text';
import { getEventGachaAndCardList } from '@/modules/plugins/bangdream/src/domain/event/event-detail.renderer';
import { drawDottedLine } from '@/modules/plugins/bangdream/src/theme/canvas-dotted-line';
import { statConfig } from '@/modules/plugins/bangdream/src/domain/card/card-stat.renderer';
import { globalDefaultServer } from '@/modules/plugins/bangdream/src/config/runtime-config';
import { createBangDreamEntityMatcher } from '@/modules/plugins/bangdream/src/domain/search/entity-list-matcher';
import { eventRepository } from '@/modules/plugins/bangdream/src/domain/event/event.repository';
import { createVerticalSeparatorSpec } from '@/modules/plugins/bangdream/src/theme/layout';

const maxHeight = 7000;
const maxColumns = 7;

//表格用默认虚线
export const line2: Canvas = drawDottedLine(
  createVerticalSeparatorSpec(7000, { startX: 5 }),
);

/**
 * 根据`matches`、`displayedServerList`、`compress`绘制或格式化事件；当 `tempEventList.length == 0` 成立时返回 `['没有搜索到符合条件的活动']`。
 * @param matches - 决定事件内容、边界或目标的 `matches` 值。
 * @param displayedServerList - 决定事件内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
 * @param compress - 决定事件内容、边界或目标的 `compress` 值。
 * @returns 按输入顺序得到的事件列表；没有匹配项时为空数组。
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

const matchEventList = createBangDreamEntityMatcher<Event>({
  source: () => eventRepository.getSource(),
  createEntity: (eventId) => eventRepository.create(eventId),
  isReleased: (event, displayedServerList) =>
    displayedServerList.some((server) => event.startAt[server] != null),
  isMatched: (matches, event) => match(matches, event, []),
  relationValue: (event) => event.eventId,
});

/**
 * 根据`event`、`displayedServerList`绘制或格式化事件；从 `event.getTypeName` 读取事件。
 * @param event - 触发事件的领域事件，包含 `initFull`、`eventId`、`getTypeName`、`startAt` 字段。
 * @param displayedServerList - 用于事件的领域对象，包含 `length`、`i` 字段；省略时默认采用 `globalDefaultServer`。
 * @returns 事件。
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
