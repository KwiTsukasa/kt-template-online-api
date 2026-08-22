import { Card } from '@/modules/plugins/bangdream/src/domain/card/card.model';
import { Character } from '@/modules/plugins/bangdream/src/domain/character/character.model';
import {
  match,
  FuzzySearchResult,
} from '@/modules/plugins/bangdream/src/domain/search/fuzzy-search';
import { Canvas } from 'skia-canvas';
import { drawCardIcon } from '@/modules/plugins/bangdream/src/domain/card/card-art.renderer';
import { drawDataBlockHorizontal } from '@/modules/plugins/bangdream/src/theme/data-block.renderer';
import { stackImage } from '@/modules/plugins/bangdream/src/theme/image-stack';
import { drawTitle } from '@/modules/plugins/bangdream/src/theme/title.renderer';
import { outputEasyImages } from '@/modules/plugins/bangdream/src/theme/canvas-output';
import { Server } from '@/modules/plugins/bangdream/src/domain/catalog/server.model';
import { globalDefaultServer } from '@/modules/plugins/bangdream/src/config/runtime-config';
import { createBangDreamEntityMatcher } from '@/modules/plugins/bangdream/src/domain/search/entity-list-matcher';
import { cardRepository } from '@/modules/plugins/bangdream/src/domain/card/card.repository';

const maxWidth = 7000;
type CardAttribute = Card['attribute'];

/**
 * 通过 `matchCardList` 执行模式匹配。
 * @param matches - 决定卡牌内容、边界或目标的 `matches` 值。
 * @param displayedServerList - 决定卡牌内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
 * @param compress - 决定卡牌内容、边界或目标的 `compress` 值。
 * @returns 按输入顺序得到的卡牌列表；没有匹配项时为空数组。
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
  source: () => cardRepository.getSource(),
  createEntity: (cardId) => cardRepository.create(cardId),
  isCandidate: (card) => card.type != 'others',
  isReleased: (card, displayedServerList) =>
    displayedServerList.some((server) => card.releasedAt[server] != null),
  isMatched: (matches, card) => match(matches, card, ['scoreUpMaxValue']),
  relationValue: (card) => card.cardId,
});

/**
 * 按`cardList`读取卡牌布局坐标轴。
 * @param cardList - 决定卡牌布局坐标轴内容、边界或目标的 `cardList` 值。
 * @returns 包含 `characterIdList`、`attributeList` 字段的卡牌布局坐标轴；没有匹配项时为空数组。
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
 * 根据`characterId`绘制或格式化角色图标；当 `characterId == null` 成立时返回 `tempCanvas`。
 * @param characterId - 用于精确定位角色的标识。
 * @returns 角色图标。
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
 * 根据`cardList`、`characterIdList`、`attributeList`绘制或格式化Wide卡牌；当 `cardListImage.width <= maxWidth` 成立时返回 `cardListImage`。
 * @param cardList - 决定Wide卡牌内容、边界或目标的 `cardList` 值。
 * @param characterIdList - 决定Wide卡牌内容、边界或目标的 `characterIdList` 值。
 * @param attributeList - 决定Wide卡牌内容、边界或目标的 `attributeList` 值。
 * @returns 按输入顺序得到的Wide卡牌列表；没有匹配项时为空数组。
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
 * 根据`cardList`、`characterIdList`、`attributeList`绘制或格式化Compact卡牌；从 `getCardListByAttributeAndCharacterId` 读取Compact卡牌。
 * @param cardList - 决定Compact卡牌内容、边界或目标的 `cardList` 值。
 * @param characterIdList - 决定Compact卡牌内容、边界或目标的 `characterIdList` 值。
 * @param attributeList - 决定Compact卡牌内容、边界或目标的 `attributeList` 值。
 * @returns Compact卡牌。
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
        await drawCharacterIcon((() => {
          if (shouldDrawIcon) {
            return characterId;
          }
          return null;
        })()),
      );
      shouldDrawIcon = false;
    }
  }

  return drawDataBlockHorizontal({
    list: [stackImage(characterIconImageList), stackImage(cardImageList)],
  });
}

/**
 * 根据`cardListImage`、`compress`绘制或格式化output卡牌图片；把图片、文本或图形按布局规格绘制到画布。
 * @param cardListImage - 决定output卡牌图片内容、边界或目标的 `cardListImage` 值。
 * @param compress - 决定output卡牌图片内容、边界或目标的 `compress` 值。
 * @returns 按输入顺序得到的output卡牌图片列表；没有匹配项时为空数组。
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
 * 按`cardFullList`、`attribute`、`characterId`读取卡牌属性角色标识。
 * @param cardFullList - 用于卡牌属性角色标识的领域对象，包含 `length`、`i` 字段。
 * @param attribute - 决定卡牌属性图标与边框资源的属性。
 * @param characterId - 用于精确定位角色的标识。
 * @returns 卡牌属性角色标识。
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
 * 根据`cardList`绘制或格式化卡牌文本行；当 `cardList.length == 0` 成立时返回 `new Canvas(1, 140)`。
 * @param cardList - 用于卡牌文本行的领域对象，包含 `length`、`i` 字段。
 * @returns 卡牌文本行。
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
