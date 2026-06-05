import { Gacha } from '@/qqbot/plugins/bangDream/tsugu/domain/gacha';
import { Server } from '@/qqbot/plugins/bangDream/tsugu/domain/server';
import { drawList } from '../list';
import { drawCardListInList } from './card-icon-list';
import { Card } from '@/qqbot/plugins/bangDream/tsugu/domain/card';
import { stackImage } from '@/qqbot/plugins/bangDream/tsugu/layout/utils';
import { Canvas } from 'skia-canvas';

export async function drawGachaPickupInList(
  gacha: Gacha,
  server: Server,
  key?: string,
): Promise<Canvas> {
  const list = [];
  list.push(
    drawList({
      key: key ?? '卡池PickUp',
    }),
  );
  let pickUpCardIdList = [];
  const details = gacha.details[server];
  for (const cardId in details) {
    if (details[cardId]['pickup'] == true) {
      pickUpCardIdList.push(parseInt(cardId));
    }
  }
  //pickup按照稀有度和概率分类， pickUpCardList:{rarity:{weight:[card]}
  pickUpCardIdList = Array.from(new Set(pickUpCardIdList));
  const pickUpCardList = {};
  for (let i = 0; i < pickUpCardIdList.length; i++) {
    const card = new Card(pickUpCardIdList[i]);
    const rarity = card.rarity.toString();
    const weight = details[pickUpCardIdList[i]]['weight'].toString();
    if (!pickUpCardList[rarity]) {
      pickUpCardList[rarity] = {};
      if (!pickUpCardList[rarity][weight]) {
        pickUpCardList[rarity][weight] = [];
      }
    }
    pickUpCardList[rarity][weight].push(card);
  }
  if (Object.keys(pickUpCardList).length != 0) {
    for (const rarity in pickUpCardList) {
      for (const weight in pickUpCardList[rarity]) {
        const rate =
          (parseInt(weight) / gacha.rates[server][rarity].weightTotal) *
          gacha.rates[server][rarity].rate;
        list.push(
          drawList({
            text: `${rate.toFixed(2)}%: `,
          }),
        );
        list.push(
          await drawCardListInList({
            cardList: pickUpCardList[rarity][weight],
            trainingStatus: false,
            cardIdVisible: true,
            cardTypeVisible: true,
            skillTypeVisible: true,
          }),
        );
      }
    }
    return stackImage(list);
  } else {
    const result = drawList({
      key: key ?? '卡池PickUp',
      text: '无',
    });
    return result;
  }
}
