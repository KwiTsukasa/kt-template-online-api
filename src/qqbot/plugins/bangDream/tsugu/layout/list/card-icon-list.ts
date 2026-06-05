import { drawList } from '@/qqbot/plugins/bangDream/tsugu/layout/list';
import { Canvas } from 'skia-canvas';
import { drawCardIcon } from '@/qqbot/plugins/bangDream/tsugu/layout/card';
import { Card } from '@/qqbot/plugins/bangDream/tsugu/domain/card';
import { BANGDREAM_CARD_PRIORITY_TYPES } from '@/qqbot/plugins/bangDream/tsugu/domain/bangdream.enum';

interface CardIconInListOptions {
  key?: string;
  cardList: Array<Card>;
  cardIdVisible?: boolean;
  skillTypeVisible?: boolean;
  cardTypeVisible?: boolean;
  trainingStatus?: boolean;
  lineHeight?: number;
}

export async function drawCardListInList({
  key,
  cardList,
  cardIdVisible = false,
  skillTypeVisible = true,
  cardTypeVisible = true,
  trainingStatus,
  lineHeight = 200,
}: CardIconInListOptions) {
  //cardList排序，稀有度高的在前面，其中cardId低的在前面
  const typeList: readonly string[] = BANGDREAM_CARD_PRIORITY_TYPES;
  cardList.sort((a, b) => {
    if (a.rarity == b.rarity) {
      if (typeList.includes(a.type) && !typeList.includes(b.type)) {
        return -1;
      } else if (!typeList.includes(a.type) && typeList.includes(b.type)) {
        return 1;
      } else if (
        typeList.indexOf(a.type) != -1 &&
        typeList.indexOf(b.type) != -1
      ) {
        return typeList.indexOf(a.type) - typeList.indexOf(b.type);
      }

      return a.cardId - b.cardId;
    }
    return b.rarity - a.rarity;
  });
  const textSize = (lineHeight / 200) * 180;
  const spacing = (lineHeight / 200) * 13;
  const list: Array<Canvas> = [];
  for (let i = 0; i < cardList.length; i++) {
    const element: Card = cardList[i];
    let cardIcon: Canvas;
    if (trainingStatus != undefined) {
      cardIcon = await drawCardIcon({
        card: element,
        trainingStatus: trainingStatus,
        cardIdVisible: cardIdVisible,
        skillTypeVisible: skillTypeVisible,
        cardTypeVisible: cardTypeVisible,
      });
      list.push(cardIcon);
    } else {
      const getTrainingStatusList = element.getTrainingStatusList();
      for (let j = 0; j < getTrainingStatusList.length; j++) {
        cardIcon = await drawCardIcon({
          card: element,
          trainingStatus: getTrainingStatusList[j],
          cardIdVisible: cardIdVisible,
          skillTypeVisible: skillTypeVisible,
          cardTypeVisible: cardTypeVisible,
        });
        list.push(cardIcon);
      }
    }
  }
  return drawList({
    key: key,
    content: list,
    textSize: textSize,
    lineHeight: lineHeight,
    spacing: spacing,
  });
}
