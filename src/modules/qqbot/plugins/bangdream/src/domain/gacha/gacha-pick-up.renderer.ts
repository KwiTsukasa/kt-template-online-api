import { Gacha } from '@/modules/qqbot/plugins/bangdream/src/domain/gacha/gacha.model';
import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { drawList } from '@/modules/qqbot/plugins/bangdream/src/theme/list-frame.renderer';
import { drawCardListInList } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-icon.renderer';
import { Card } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card.model';
import { stackImage } from '@/modules/qqbot/plugins/bangdream/src/theme/image-stack';
import { Canvas } from 'skia-canvas';
import { BANGDREAM_GACHA_LIST_SPEC } from '@/modules/qqbot/plugins/bangdream/src/domain/gacha/gacha-list.layout';

/**
 * 根据`gacha`、`server`、`key`绘制或格式化卡池Pickup；当 `Object.keys(pickUpCardList).length != 0` 成立时返回 `stackImage(list)`。
 * @param gacha - 用于卡池Pickup的领域对象，包含 `details`、`rates` 字段。
 * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
 * @param key - 用于读取或更新卡池Pickup的稳定键；为空时采用 `BANGDREAM_GACHA_LIST_SPEC.label.pickup` 作为兜底。
 * @returns 卡池Pickup。
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
