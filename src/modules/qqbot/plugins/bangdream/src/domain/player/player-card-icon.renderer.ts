import { Card } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card.model';
import { Player } from '@/modules/qqbot/plugins/bangdream/src/domain/player/player.model';
import { Canvas } from 'skia-canvas';
import { drawCardIcon } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-art.renderer';
import { drawList } from '@/modules/qqbot/plugins/bangdream/src/theme/list-frame.renderer';
import {
  BANGDREAM_PLAYER_CARD_ICON_LIST_SPEC,
  getPlayerCardIconListSpacing,
  getPlayerCardIconListTextSize,
  sortPlayerMainDeckEntries,
} from '@/modules/qqbot/plugins/bangdream/src/domain/player/player-card-icon.layout';

/**
 * 在图片布局层中绘制玩家卡牌In列表。
 *
 * @param player - 玩家参数。
 * @param key - 当前字段键名，未传入时使用默认值。
 * @param cardIdVisible - 卡牌IDVisible参数，未传入时使用默认值。
 * @param lineHeight - 线条高度参数，未传入时使用默认值。
 * @returns 异步处理结果。
 */
export async function drawPlayerCardInList(
  player: Player,
  key?: string,
  cardIdVisible = false,
  lineHeight = BANGDREAM_PLAYER_CARD_ICON_LIST_SPEC.list.defaultLineHeight,
): Promise<Canvas> {
  const textSize = getPlayerCardIconListTextSize(lineHeight);
  const spacing = getPlayerCardIconListSpacing(lineHeight);
  const promiseList: Promise<Canvas>[] = [];
  const cardDataList = sortPlayerMainDeckEntries(
    player.profile.mainDeckUserSituations.entries,
  );
  const cardIconList: Array<Canvas> = [];
  for (const i in cardDataList) {
    const tempCardData = cardDataList[i];
    promiseList.push(
      drawCardIcon({
        card: new Card(tempCardData.situationId),
        trainingStatus: tempCardData.trainingStatus == 'done',
        illustrationTrainingStatus: tempCardData.illust == 'after_training',
        limitBreakRank: tempCardData.limitBreakRank,
        cardIdVisible: cardIdVisible,
        skillTypeVisible:
          BANGDREAM_PLAYER_CARD_ICON_LIST_SPEC.card.showSkillType,
        cardTypeVisible: BANGDREAM_PLAYER_CARD_ICON_LIST_SPEC.card.showCardType,
        skillLevel: tempCardData.skillLevel,
      }),
    );
  }
  const result = await Promise.all(promiseList);
  for (const r of result) {
    cardIconList.push(r);
  }

  return drawList({
    key: key,
    content: cardIconList,
    textSize: textSize,
    lineHeight: lineHeight,
    spacing: spacing,
  });
}
