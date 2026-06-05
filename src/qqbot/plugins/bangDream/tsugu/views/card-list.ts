import { Card } from '@/qqbot/plugins/bangDream/tsugu/domain/card';
import { Character } from '@/qqbot/plugins/bangDream/tsugu/domain/character';
import mainAPI from '@/qqbot/plugins/bangDream/tsugu/domain/main-api';
import {
  match,
  checkRelationList,
  FuzzySearchResult,
} from '@/qqbot/plugins/bangDream/tsugu/fuzzy-search';
import { Canvas } from 'skia-canvas';
import { drawCardIcon } from '@/qqbot/plugins/bangDream/tsugu/layout/card';
import { drawDataBlockHorizontal } from '@/qqbot/plugins/bangDream/tsugu/layout/data-block';
import { stackImage } from '@/qqbot/plugins/bangDream/tsugu/layout/utils';
import { drawTitle } from '@/qqbot/plugins/bangDream/tsugu/layout/title';
import { outputEasyImages } from '@/qqbot/plugins/bangDream/tsugu/graphics/output';
import { Server } from '@/qqbot/plugins/bangDream/tsugu/domain/server';
import { globalDefaultServer } from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-config';

const maxWidth = 7000;

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
  const characterIdList: number[] = [];
  const attributeList: Array<'cool' | 'happy' | 'pure' | 'powerful'> = [];
  for (let i = 0; i < tempCardList.length; i++) {
    const tempCard = tempCardList[i];
    if (!characterIdList.includes(tempCard.characterId)) {
      characterIdList.push(tempCard.characterId);
    }
    if (!attributeList.includes(tempCard.attribute)) {
      attributeList.push(tempCard.attribute);
    }
  }
  let cardListImage: Canvas;
  const characterIconImageList: Canvas[] = []; //角色头像列表，画在最左边
  //画角色头像Icon函数
  async function drawCharacterIcon(
    characterId: number | null,
  ): Promise<Canvas> {
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
  characterIdList.sort((a, b) => {
    return a - b;
  });
  //如果角色数量大于5，则颜色作为X轴，角色作为Y轴
  if (characterIdList.length > 5) {
    const promise = [];
    const tempAttributeImageList: Canvas[] = []; //每一个颜色的所有角色的列
    for (let i = 0; i < attributeList.length; i++) {
      const attribute = attributeList[i];
      const tempAttributeCardImageList: Canvas[] = []; //这个颜色的所有角色的行
      for (let j = 0; j < characterIdList.length; j++) {
        const characterId = characterIdList[j];
        const tempAttributeCardList = getCardListByAttributeAndCharacterId(
          tempCardList,
          attribute,
          characterId,
        );
        promise.push(
          tempAttributeCardImageList.push(
            await drawCardListLine(tempAttributeCardList),
          ),
        );
        //画角色头像
        if (i == 0) {
          promise.push(
            characterIconImageList.push(await drawCharacterIcon(characterId)),
          );
        }
      }
      tempAttributeImageList.push(stackImage(tempAttributeCardImageList));
    }
    await Promise.all(promise);
    const characterIconImage = stackImage(characterIconImageList);
    tempAttributeImageList.unshift(characterIconImage);
    cardListImage = drawDataBlockHorizontal({
      list: tempAttributeImageList,
    });
    if (cardListImage.width > maxWidth) {
      const tempImageList: Array<Buffer | string> = [];
      tempImageList.push('卡牌列表过长，已经拆分输出');
      for (let i = 0; i < tempAttributeImageList.length; i++) {
        const tempCanvas = tempAttributeImageList[i];
        if (tempCanvas == characterIconImage) {
          continue;
        }
        const all = [];
        all.push(
          drawDataBlockHorizontal({ list: [characterIconImage, tempCanvas] }),
        );
        const [buffer] = await outputEasyImages(all);
        tempImageList.push(buffer);
      }
      return tempImageList;
    }
    const all = [];
    all.push(drawTitle('查询', '卡牌列表'));
    all.push(cardListImage);
    return await outputEasyImages(all, { compress });
  } else {
    const tempCardImageList: Canvas[] = []; //总列
    const promise = [];
    for (let i = 0; i < characterIdList.length; i++) {
      const characterId = characterIdList[i];
      let icon = true;
      for (let j = 0; j < attributeList.length; j++) {
        const attribute = attributeList[j];
        const tempAttributeCardList = getCardListByAttributeAndCharacterId(
          tempCardList,
          attribute,
          characterId,
        );
        if (tempAttributeCardList.length != 0) {
          promise.push(
            tempCardImageList.push(
              await drawCardListLine(tempAttributeCardList),
            ),
          );
          //画角色头像
          if (icon) {
            promise.push(
              characterIconImageList.push(await drawCharacterIcon(characterId)),
            );
            icon = false;
          } else {
            promise.push(
              characterIconImageList.push(await drawCharacterIcon(null)),
            );
          }
        }
      }
    }
    await Promise.all(promise);
    const cardListImageWithoutCharacterIcon =
      await stackImage(tempCardImageList);
    const characterIconImage = stackImage(characterIconImageList);
    cardListImage = drawDataBlockHorizontal({
      list: [characterIconImage, cardListImageWithoutCharacterIcon],
    });
    const all = [];
    all.push(drawTitle('查询', '卡牌列表'));
    all.push(cardListImage);
    return await outputEasyImages(all, { compress });
  }
}

//计算模糊搜索结果
export function matchCardList(
  matches: FuzzySearchResult,
  displayedServerList: Server[],
) {
  const tempCardList: Array<Card> = []; //最终输出的卡牌列表
  const cardIdList: Array<number> = Object.keys(mainAPI['cards']).map(Number); //所有卡牌ID列表
  for (let i = 0; i < cardIdList.length; i++) {
    const tempCard = new Card(cardIdList[i]);
    if (tempCard.type == 'others') {
      continue;
    }
    let isMatch = match(matches, tempCard, ['scoreUpMaxValue']);
    //如果在所有所选服务器列表中都不存在，则不输出
    let numberOfReleasedServer = 0;
    for (let j = 0; j < displayedServerList.length; j++) {
      const server = displayedServerList[j];
      if (tempCard.releasedAt[server] != null) {
        numberOfReleasedServer++;
      }
    }
    if (numberOfReleasedServer == 0) {
      isMatch = false;
    }

    //如果有数字关系词，则判断关系词
    if (matches._relationStr != undefined) {
      //如果之后范围的话则直接判断
      if (isMatch || Object.keys(matches).length == 1) {
        isMatch = checkRelationList(
          tempCard.cardId,
          matches._relationStr as string[],
        );
      }
    }

    if (isMatch) {
      tempCardList.push(tempCard);
    }
  }
  return tempCardList;
}

function getCardListByAttributeAndCharacterId(
  cardFullList: Card[],
  attribute: 'cool' | 'happy' | 'pure' | 'powerful',
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
