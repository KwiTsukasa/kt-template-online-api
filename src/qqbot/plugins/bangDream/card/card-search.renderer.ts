import { Card } from '@/qqbot/plugins/bangDream/card/card.model';
import { Character } from '@/qqbot/plugins/bangDream/character/character.model';
import {
  match,
  FuzzySearchResult,
} from '@/qqbot/plugins/bangDream/search/fuzzy-search';
import { Canvas } from 'skia-canvas';
import { drawCardIcon } from '@/qqbot/plugins/bangDream/card/card-art.renderer';
import { drawDataBlockHorizontal } from '@/qqbot/plugins/bangDream/shared/data-block.renderer';
import { stackImage } from '@/qqbot/plugins/bangDream/shared/image-stack';
import { drawTitle } from '@/qqbot/plugins/bangDream/shared/title.renderer';
import { outputEasyImages } from '@/qqbot/plugins/bangDream/theme/canvas-output';
import { Server } from '@/qqbot/plugins/bangDream/catalog/server.model';
import { globalDefaultServer } from '@/qqbot/plugins/bangDream/config/runtime-config';
import { createTsuguEntityMatcher } from '@/qqbot/plugins/bangDream/search/entity-list-matcher';
import { cardRepository } from '@/qqbot/plugins/bangDream/card/card.repository';

const maxWidth = 7000;
type CardAttribute = Card['attribute'];

/**
 * 在QQBot 图片视图层中绘制卡牌列表。
 *
 * @param matches - 模糊搜索命中结果。
 * @param displayedServerList - 允许展示或下载资源的服务器优先级列表，未传入时使用默认值。
 * @param compress - compress参数。
 * @returns 异步处理结果。
 */
export async function drawCardList(
  matches: FuzzySearchResult,
  displayedServerList: Server[] = globalDefaultServer,
  compress: boolean,
): Promise<Array<Buffer | string>> {
  //计算模糊搜索结果
  const tempCardList: Array<Card> = matchCardList(matches, displayedServerList);

  if (tempCardList.length == 0) {
    return ['没有搜索到符合条件的卡牌'];
  }

  //计算表格，X轴为颜色，Y轴为角色
  const { characterIdList, attributeList } = getCardListAxes(tempCardList);
  //如果角色数量大于5，则颜色作为X轴，角色作为Y轴
  if (characterIdList.length > 5) {
    const wideResult = await drawWideCardList(
      tempCardList,
      characterIdList,
      attributeList,
    );
    if (Array.isArray(wideResult)) {
      return wideResult;
    }
    return await outputCardListImage(wideResult, compress);
  }

  const compactImage = await drawCompactCardList(
    tempCardList,
    characterIdList,
    attributeList,
  );
  return await outputCardListImage(compactImage, compress);
}

//计算模糊搜索结果
export const matchCardList = createTsuguEntityMatcher<Card>({
  source: () => cardRepository.getSource(),
  /**
   * 在QQBot 图片视图层中创建Entity。
   *
   * @param cardId - 卡牌 ID。
   */
  createEntity: (cardId) => cardRepository.create(cardId),
  /**
   * 在QQBot 图片视图层中判断Candidate。
   *
   * @param card - 卡牌参数。
   */
  isCandidate: (card) => card.type != 'others',
  /**
   * 在QQBot 图片视图层中判断Released。
   *
   * @param card - 卡牌参数。
   * @param displayedServerList - 允许展示或下载资源的服务器优先级列表。
   */
  isReleased: (card, displayedServerList) =>
    displayedServerList.some((server) => card.releasedAt[server] != null),
  /**
   * 在QQBot 图片视图层中判断Matched。
   *
   * @param matches - 模糊搜索命中结果。
   * @param card - 卡牌参数。
   */
  isMatched: (matches, card) => match(matches, card, ['scoreUpMaxValue']),
  /**
   * 在QQBot 图片视图层中处理关系表达式值。
   *
   * @param card - 卡牌参数。
   */
  relationValue: (card) => card.cardId,
});

/**
 * 在QQBot 图片视图层中获取卡牌列表Axes。
 *
 * @param cardList - 卡牌列表参数。
 * @returns 计算后的数值。
 */
function getCardListAxes(cardList: Card[]): {
  characterIdList: number[];
  attributeList: CardAttribute[];
} {
  const characterIdSet = new Set<number>();
  const attributeSet = new Set<CardAttribute>();
  for (const card of cardList) {
    characterIdSet.add(card.characterId);
    attributeSet.add(card.attribute);
  }
  return {
    characterIdList: [...characterIdSet].sort((a, b) => a - b),
    attributeList: [...attributeSet],
  };
}

/**
 * 在QQBot 图片视图层中绘制角色图标。
 *
 * @param characterId - 角色 ID。
 * @returns 异步处理结果。
 */
async function drawCharacterIcon(characterId: number | null): Promise<Canvas> {
  const tempCanvas = new Canvas(100, 140);
  const ctx = tempCanvas.getContext('2d');
  if (characterId == null) {
    return tempCanvas;
  }
  const character = new Character(characterId);
  const characterIcon = await character.getIcon();
  ctx.drawImage(characterIcon, 0, 25, 75, 75);
  return tempCanvas;
}

/**
 * 在QQBot 图片视图层中绘制Wide卡牌列表。
 *
 * @param cardList - 卡牌列表参数。
 * @param characterIdList - 角色ID列表参数。
 * @param attributeList - 属性列表参数。
 * @returns 异步处理结果。
 */
async function drawWideCardList(
  cardList: Card[],
  characterIdList: number[],
  attributeList: CardAttribute[],
): Promise<Canvas | Array<Buffer | string>> {
  const characterIconImageList: Canvas[] = [];
  const attributeImageList: Canvas[] = [];

  for (const attribute of attributeList) {
    const attributeCardImageList: Canvas[] = [];
    for (const characterId of characterIdList) {
      const cards = getCardListByAttributeAndCharacterId(
        cardList,
        attribute,
        characterId,
      );
      attributeCardImageList.push(await drawCardListLine(cards));
      if (attributeImageList.length == 0) {
        characterIconImageList.push(await drawCharacterIcon(characterId));
      }
    }
    attributeImageList.push(stackImage(attributeCardImageList));
  }

  const characterIconImage = stackImage(characterIconImageList);
  const columns = [characterIconImage, ...attributeImageList];
  const cardListImage = drawDataBlockHorizontal({ list: columns });
  if (cardListImage.width <= maxWidth) {
    return cardListImage;
  }

  const imageList: Array<Buffer | string> = ['卡牌列表过长，已经拆分输出'];
  for (const column of attributeImageList) {
    const [buffer] = await outputEasyImages([
      drawDataBlockHorizontal({ list: [characterIconImage, column] }),
    ]);
    imageList.push(buffer);
  }
  return imageList;
}

/**
 * 在QQBot 图片视图层中绘制Compact卡牌列表。
 *
 * @param cardList - 卡牌列表参数。
 * @param characterIdList - 角色ID列表参数。
 * @param attributeList - 属性列表参数。
 * @returns 异步处理结果。
 */
async function drawCompactCardList(
  cardList: Card[],
  characterIdList: number[],
  attributeList: CardAttribute[],
): Promise<Canvas> {
  const cardImageList: Canvas[] = [];
  const characterIconImageList: Canvas[] = [];

  for (const characterId of characterIdList) {
    let shouldDrawIcon = true;
    for (const attribute of attributeList) {
      const cards = getCardListByAttributeAndCharacterId(
        cardList,
        attribute,
        characterId,
      );
      if (cards.length == 0) {
        continue;
      }
      cardImageList.push(await drawCardListLine(cards));
      characterIconImageList.push(
        await drawCharacterIcon(shouldDrawIcon ? characterId : null),
      );
      shouldDrawIcon = false;
    }
  }

  return drawDataBlockHorizontal({
    list: [stackImage(characterIconImageList), stackImage(cardImageList)],
  });
}

/**
 * 在QQBot 图片视图层中输出卡牌列表图片。
 *
 * @param cardListImage - 卡牌列表图片参数。
 * @param compress - compress参数。
 * @returns 异步处理结果。
 */
async function outputCardListImage(
  cardListImage: Canvas,
  compress: boolean,
): Promise<Array<Buffer | string>> {
  return await outputEasyImages(
    [drawTitle('查询', '卡牌列表'), cardListImage],
    { compress },
  );
}

/**
 * 在QQBot 图片视图层中获取卡牌列表By属性And角色ID。
 *
 * @param cardFullList - 卡牌完整数据列表参数。
 * @param attribute - 属性参数。
 * @param characterId - 角色 ID。
 */
function getCardListByAttributeAndCharacterId(
  cardFullList: Card[],
  attribute: CardAttribute,
  characterId: number,
) {
  const cardList: Card[] = [];
  for (let i = 0; i < cardFullList.length; i++) {
    const tempCard = cardFullList[i];
    if (
      tempCard.attribute == attribute &&
      tempCard.characterId == characterId
    ) {
      cardList.push(tempCard);
    }
  }
  return cardList;
}

//每个颜色和角色的一行
/**
 * 在QQBot 图片视图层中绘制卡牌列表线条。
 *
 * @param cardList - 卡牌列表参数。
 */
async function drawCardListLine(cardList: Card[]) {
  if (cardList.length == 0) {
    return new Canvas(1, 140);
  }
  const maxX = cardList.length * 140;
  const maxY = 140;
  const canvas = new Canvas(maxX, maxY);
  const ctx = canvas.getContext('2d');
  //排序，稀有度高的在前面，其中技能加成高的在前面
  cardList.sort((a, b) => {
    if (a.rarity > b.rarity) {
      return -1;
    } else if (a.rarity < b.rarity) {
      return 1;
    } else {
      if (a.scoreUpMaxValue > b.scoreUpMaxValue) {
        return -1;
      } else if (a.scoreUpMaxValue < b.scoreUpMaxValue) {
        return 1;
      } else {
        return 0;
      }
    }
  });
  //画卡牌，从左到右，宽度120，间隔20
  for (let i = 0; i < cardList.length; i++) {
    const tempCard = cardList[i];
    const cardIcon = await drawCardIcon({
      card: tempCard,
      trainingStatus: true,
      cardIdVisible: true,
      skillTypeVisible: true,
    });
    const ratio = 120 / cardIcon.width;
    ctx.drawImage(
      cardIcon,
      i * 140,
      0,
      cardIcon.width * ratio,
      cardIcon.height * ratio,
    );
  }
  return canvas;
}
