import { Card } from '@/qqbot/plugins/bangDream/tsugu/domain/card';
import { Player } from '@/qqbot/plugins/bangDream/tsugu/domain/player';
import { Canvas } from 'skia-canvas';
import { drawCardIcon } from '@/qqbot/plugins/bangDream/tsugu/layout/card';
import { drawList } from '@/qqbot/plugins/bangDream/tsugu/layout/list';

export async function drawPlayerCardInList(
  player: Player,
  key?: string,
  cardIdVisible = false,
  lineHeight = 184,
): Promise<Canvas> {
  const textSize = (lineHeight / 200) * 180;
  const spacing = (lineHeight / 200) * 13;
  const promiseList: Promise<Canvas>[] = [];
  const tempCardDataList = player.profile.mainDeckUserSituations.entries;
  //将tempCardDataList调整顺序，为3,1,0,2,4
  const defaultCardSort = [3, 1, 0, 2, 4];
  const cardDataList = [];
  for (let i = 0; i < defaultCardSort.length; i++) {
    const tempCardData = tempCardDataList[defaultCardSort[i]];
    cardDataList.push(tempCardData);
  }
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
        skillTypeVisible: true,
        cardTypeVisible: false,
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
