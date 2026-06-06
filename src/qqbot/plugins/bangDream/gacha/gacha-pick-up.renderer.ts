import { Gacha } from '@/qqbot/plugins/bangDream/gacha/gacha.model';
import { Server } from '@/qqbot/plugins/bangDream/catalog/server.model';
import { drawList } from '@/qqbot/plugins/bangDream/shared/list-frame.renderer';
import { drawCardListInList } from '@/qqbot/plugins/bangDream/card/card-icon.renderer';
import { Card } from '@/qqbot/plugins/bangDream/card/card.model';
import { stackImage } from '@/qqbot/plugins/bangDream/shared/image-stack';
import { Canvas } from 'skia-canvas';
import { BANGDREAM_GACHA_LIST_SPEC } from '@/qqbot/plugins/bangDream/gacha/gacha-list.layout';

/**
 * 在图片布局层中绘制卡池PickUpIn列表。
 *
 * @param gacha - 卡池参数。
 * @param server - 目标服务器。
 * @param key - 当前字段键名，未传入时使用默认值。
 * @returns 异步处理结果。
 */
export async function drawGachaPickupInList(
  gacha: Gacha,
  server: Server,
  key?: string,
): Promise<Canvas> {
  const list = [];
  list.push(
    drawList({
      key: key ?? BANGDREAM_GACHA_LIST_SPEC.label.pickup,
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
      key: key ?? BANGDREAM_GACHA_LIST_SPEC.label.pickup,
      text: BANGDREAM_GACHA_LIST_SPEC.label.empty,
    });
    return result;
  }
}
