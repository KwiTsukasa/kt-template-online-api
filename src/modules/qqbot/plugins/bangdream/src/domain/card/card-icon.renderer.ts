import { drawList } from '@/modules/qqbot/plugins/bangdream/src/theme/list-frame.renderer';
import { Canvas } from 'skia-canvas';
import { drawCardIcon } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-art.renderer';
import { Card } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card.model';
import {
  BANGDREAM_CARD_ICON_LIST_SPEC,
  getCardIconListSpacing,
  getCardIconListTextSize,
  sortCardIconListCards,
} from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-icon.layout';

interface CardIconInListOptions {
  key?: string;
  cardList: Array<Card>;
  cardIdVisible?: boolean;
  skillTypeVisible?: boolean;
  cardTypeVisible?: boolean;
  trainingStatus?: boolean;
  lineHeight?: number;
}

/**
 * 在图片布局层中绘制卡牌列表In列表。
 *
 * @param options1 - options1 输入；影响 drawCardListInList 的返回值。
 */
export async function drawCardListInList({
  key,
  cardList,
  cardIdVisible = BANGDREAM_CARD_ICON_LIST_SPEC.card.showCardId,
  skillTypeVisible = BANGDREAM_CARD_ICON_LIST_SPEC.card.showSkillType,
  cardTypeVisible = BANGDREAM_CARD_ICON_LIST_SPEC.card.showCardType,
  trainingStatus,
  lineHeight = BANGDREAM_CARD_ICON_LIST_SPEC.list.defaultLineHeight,
}: CardIconInListOptions) {
  sortCardIconListCards(cardList);
  const textSize = getCardIconListTextSize(lineHeight);
  const spacing = getCardIconListSpacing(lineHeight);
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
