import { Gacha } from '@/modules/qqbot/plugins/bangdream/src/domain/gacha/gacha.model';
import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { drawList } from '@/modules/qqbot/plugins/bangdream/src/theme/list-frame.renderer';
import { drawCardListInList } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-icon.renderer';
import { Card } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card.model';
import { stackImage } from '@/modules/qqbot/plugins/bangdream/src/theme/image-stack';
import { Canvas } from 'skia-canvas';
import { BANGDREAM_GACHA_LIST_SPEC } from '@/modules/qqbot/plugins/bangdream/src/domain/gacha/gacha-list.layout';

/**
 * 在图片布局层中绘制卡池PickUpIn列表。
 *
 * @param gacha - gacha 输入；使用 `details`、`rates` 字段生成结果。
 * @param server - server 输入；驱动 `parseInt()` 的 BangDream步骤。
 * @param key - 键名；影响 drawGachaPickupInList 的返回值。
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
