import { Card } from '@/modules/plugins/bangdream/src/domain/card/card.model';
import { Player } from '@/modules/plugins/bangdream/src/domain/player/player.model';
import { Canvas } from 'skia-canvas';
import { drawCardIcon } from '@/modules/plugins/bangdream/src/domain/card/card-art.renderer';
import { drawList } from '@/modules/plugins/bangdream/src/theme/list-frame.renderer';
import {
  BANGDREAM_PLAYER_CARD_ICON_LIST_SPEC,
  getPlayerCardIconListSpacing,
  getPlayerCardIconListTextSize,
  sortPlayerMainDeckEntries,
} from '@/modules/plugins/bangdream/src/domain/player/player-card-icon.layout';

/**
 * 根据`player`、`key`、`cardIdVisible`绘制或格式化玩家卡牌；从 `getPlayerCardIconListTextSize` 读取玩家卡牌。
 * @param player - 用于玩家卡牌的领域对象，包含 `profile` 字段。
 * @param key - 用于读取或更新玩家卡牌的稳定键；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @param cardIdVisible - 决定玩家卡牌内容、边界或目标的 `cardIdVisible` 值；省略时默认采用 `false`。
 * @param lineHeight - 决定玩家卡牌内容、边界或目标的 `lineHeight` 值；省略时默认采用 `BANGDREAM_PLAYER_CARD_ICON_LIST_SPEC.list.default…`。
 * @returns 玩家卡牌。
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
