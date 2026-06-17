import { Card } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card.model';
import { Character } from '@/modules/qqbot/plugins/bangdream/src/domain/character/character.model';
import {
  match,
  FuzzySearchResult,
} from '@/modules/qqbot/plugins/bangdream/src/domain/search/fuzzy-search';
import { Canvas } from 'skia-canvas';
import { drawCardIcon } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-art.renderer';
import { drawDataBlockHorizontal } from '@/modules/qqbot/plugins/bangdream/src/theme/data-block.renderer';
import { stackImage } from '@/modules/qqbot/plugins/bangdream/src/theme/image-stack';
import { drawTitle } from '@/modules/qqbot/plugins/bangdream/src/theme/title.renderer';
import { outputEasyImages } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-output';
import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { globalDefaultServer } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import { createBangDreamEntityMatcher } from '@/modules/qqbot/plugins/bangdream/src/domain/search/entity-list-matcher';
import { cardRepository } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card.repository';

const maxWidth = 7000;
type CardAttribute = Card['attribute'];

/**
 * 在QQBot 图片视图层中绘制卡牌列表。
 *
 * @param matches - BangDream列表；驱动 `matchCardList()` 的 BangDream步骤。
 * @param displayedServerList - displayedServerList 输入；驱动 `matchCardList()` 的 BangDream步骤。
 * @param compress - BangDream列表；驱动 `outputCardListImage()` 的 BangDream步骤。
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
export const matchCardList = createBangDreamEntityMatcher<Card>({
  /**
   * 执行 BangDream回调。
   */
  source: () => cardRepository.getSource(),
  /**
   * 创建 BangDream 插件对象或配置。
   *
   * @param cardId - 卡牌 ID；定位本次读取、更新、删除或关联的卡牌。
   */
  createEntity: (cardId) => cardRepository.create(cardId),
  /**
   * 判断 BangDream 插件条件。
   *
   * @param card - card 输入；使用 `type` 字段计算判断结果。
   */
  isCandidate: (card) => card.type != 'others',
  /**
   * 判断 BangDream 插件条件。
   *
   * @param card - card 输入；使用 `releasedAt` 字段计算判断结果。
   * @param displayedServerList - displayedServerList 输入；计算 BangDream布尔判断。
   */
  isReleased: (card, displayedServerList) =>
    displayedServerList.some((server) => card.releasedAt[server] != null),
  /**
   * 判断 BangDream 插件条件。
   *
   * @param matches - BangDream列表；驱动 `match()` 的 BangDream步骤。
   * @param card - card 输入；驱动 `match()` 的 BangDream步骤。
   */
  isMatched: (matches, card) => match(matches, card, ['scoreUpMaxValue']),
  /**
   * 在QQBot 图片视图层中处理关系表达式值。
   *
   * @param card - card 输入；使用 `cardId` 字段生成结果。
   */
  relationValue: (card) => card.cardId,
});

/**
 * 在QQBot 图片视图层中获取卡牌列表Axes。
 *
 * @param cardList - cardList 输入；驱动 `for()` 的 BangDream步骤。
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
 * @param characterId - 角色 ID；定位本次读取、更新、删除或关联的角色。
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
 * @param cardList - cardList 输入；驱动 `getCardListByAttributeAndCharacterId()` 的 BangDream步骤。
 * @param characterIdList - 角色 ID 列表；限定本次批量读取、渲染或关联的角色范围。
 * @param attributeList - attributeList 输入；驱动 `for()` 的 BangDream步骤。
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
 * @param cardList - cardList 输入；驱动 `getCardListByAttributeAndCharacterId()` 的 BangDream步骤。
 * @param characterIdList - 角色 ID 列表；限定本次批量读取、渲染或关联的角色范围。
 * @param attributeList - attributeList 输入；驱动 `for()` 的 BangDream步骤。
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
 * @param cardListImage - cardListImage 输入；驱动 `outputEasyImages()` 的 BangDream步骤。
 * @param compress - BangDream列表；影响 outputCardListImage 的返回值。
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
 * @param cardFullList - cardFullList 输入；使用 `length` 字段生成结果。
 * @param attribute - attribute 输入；决定 BangDream条件分支。
 * @param characterId - 角色 ID；定位本次读取、更新、删除或关联的角色。
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
 * @param cardList - cardList 输入；使用 `length` 字段生成结果。
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
