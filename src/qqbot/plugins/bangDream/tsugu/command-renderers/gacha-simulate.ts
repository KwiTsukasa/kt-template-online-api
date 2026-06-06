import { Gacha } from '@/qqbot/plugins/bangDream/tsugu/models/gacha';
import { Card } from '@/qqbot/plugins/bangDream/tsugu/models/card';
import { drawCardIcon } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/card-art';
import { drawTitle } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/title';
import { Canvas } from 'skia-canvas';
import {
  drawTextWithImages,
  drawText,
} from '@/qqbot/plugins/bangDream/tsugu/canvas/text';
import { outputEasyImages } from '@/qqbot/plugins/bangDream/tsugu/canvas/output';
import { getServerByPriority } from '@/qqbot/plugins/bangDream/tsugu/models/server';
import { drawDataBlock } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/data-block';
import { resizeImage } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/image-stack';
import { drawGachaDataBlock } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/detail-blocks';
import {
  applyGachaGuaranteedRarity,
  BANGDREAM_GACHA_DEFAULT_SPIN_COUNT,
  BANGDREAM_GACHA_MAX_SPIN_COUNT,
  isGachaSpinCountTooLarge,
  pickGachaCardIdByWeight,
  pickGachaRarityByRate,
} from '@/qqbot/plugins/bangDream/tsugu/models/gacha-policy';
import {
  BANGDREAM_GACHA_SIMULATE_SPEC,
  createGachaBannerCanvasSize,
  createGachaSimulateWrapOptions,
  getGachaBannerImageMaxWidth,
  getGachaCountTextPosition,
  getGachaDuplicateIconRect,
  getGachaDuplicateLayerCount,
} from '@/qqbot/plugins/bangDream/tsugu/render-blocks/gacha-simulate-spec';

/**
 * 在QQBot 图片视图层中绘制Random卡池。
 *
 * @param gacha - 卡池参数。
 * @param times - 时间列表参数，未传入时使用默认值。
 * @param compress - compress参数。
 * @returns 异步处理结果。
 */
export async function drawRandomGacha(
  gacha: Gacha,
  times: number = BANGDREAM_GACHA_DEFAULT_SPIN_COUNT,
  compress: boolean,
): Promise<Array<Buffer | string>> {
  if (isGachaSpinCountTooLarge(times)) {
    return [
      `错误: 抽卡次数过多, 请不要超过${BANGDREAM_GACHA_MAX_SPIN_COUNT}次`,
    ];
  }
  if (!gacha.isExist) {
    return ['错误: 该卡池不存在'];
  }
  await gacha.initFull();
  // 如果卡池数据没有提供概率数据
  if (gacha.rates[getServerByPriority(gacha.publishedAt)] == null)
    return ['错误: 该卡池未提供概率分布数据'];
  let gachaImage: Canvas;
  if (times <= 10) {
    const cardImageList: Canvas[] = [];
    for (let i = 0; i < times; i++) {
      cardImageList.push(await drawGachaCard(getGachaRandomCard(gacha, i)));
    }
    gachaImage = drawTextWithImages({
      content: cardImageList,
      ...createGachaSimulateWrapOptions('single'),
    });
  } else {
    const gachaList: { [cardId: number]: number } = {};
    const promises: Promise<void>[] = [];

    for (let i = 0; i < times; i++) {
      promises.push(
        (async () => {
          const card = getGachaRandomCard(gacha, i);
          if (!gachaList[card.cardId]) {
            gachaList[card.cardId] = 1;
          } else {
            gachaList[card.cardId]++;
          }
        })(),
      );
    }

    await Promise.all(promises);

    const cardImageList: Canvas[] = [];
    const cardIdList = Object.keys(gachaList);
    cardIdList.sort((a, b) => {
      const cardA = new Card(parseInt(a));
      const cardB = new Card(parseInt(b));
      return cardB.rarity - cardA.rarity;
    });

    const cardPromises: Promise<Canvas>[] = [];
    for (let i = 0; i < cardIdList.length; i++) {
      const cardId = cardIdList[i];
      if (Object.prototype.hasOwnProperty.call(gachaList, cardId)) {
        const card = new Card(parseInt(cardId));
        cardPromises.push(drawGachaCard(card, gachaList[cardId]));
      }
    }

    const cardImageResults = await Promise.all(cardPromises);
    cardImageList.push(...cardImageResults);

    gachaImage = drawTextWithImages({
      content: cardImageList,
      ...createGachaSimulateWrapOptions('summary'),
    });
  }

  const all = [];
  all.push(drawTitle('卡池', '抽卡模拟'));
  all.push(
    drawDataBlock({
      list: [gachaImage],
    }),
  );
  //下方banner与ok按钮
  all.push(await drawGachaBanner(gacha));

  return await outputEasyImages(all, { compress });
}

//画抽卡模拟的卡牌
/**
 * 在QQBot 图片视图层中绘制卡池卡牌。
 *
 * @param card - 卡牌参数。
 * @param numberOfCard - 数字Of卡牌参数，未传入时使用默认值。
 */
async function drawGachaCard(card: Card, numberOfCard: number = 1) {
  const cardIconWithId = await drawCardIcon({
    card: card,
    trainingStatus: false,
    cardTypeVisible: false,
    cardIdVisible: true,
  });
  if (numberOfCard > 1) {
    const canvas = new Canvas(
      BANGDREAM_GACHA_SIMULATE_SPEC.card.canvas.width,
      BANGDREAM_GACHA_SIMULATE_SPEC.card.canvas.height,
    );
    const ctx = canvas.getContext('2d');
    const layerCount = getGachaDuplicateLayerCount(numberOfCard);
    const cardIconWithoutId = await drawCardIcon({
      card: card,
      trainingStatus: false,
      cardTypeVisible: false,
      cardIdVisible: false,
    });
    for (let i = 0; i < layerCount; i++) {
      const rect = getGachaDuplicateIconRect(i, layerCount);
      ctx.drawImage(cardIconWithoutId, rect.x, rect.y, rect.width, rect.height);
    }
    const iconWithCount = BANGDREAM_GACHA_SIMULATE_SPEC.card.iconWithCount;
    ctx.drawImage(
      cardIconWithId,
      iconWithCount.x,
      iconWithCount.y,
      iconWithCount.width,
      iconWithCount.height,
    );
    const countTextSpec = BANGDREAM_GACHA_SIMULATE_SPEC.card.countText;
    const numberText = drawText({
      text: `x${numberOfCard}`,
      textSize: countTextSpec.textSize,
      maxWidth: countTextSpec.maxWidth,
      color: countTextSpec.color,
    });
    const countPosition = getGachaCountTextPosition(numberText.width);
    ctx.drawImage(numberText, countPosition.x, countPosition.y);
    return canvas;
  } else {
    const canvas = new Canvas(
      BANGDREAM_GACHA_SIMULATE_SPEC.card.canvas.width,
      BANGDREAM_GACHA_SIMULATE_SPEC.card.canvas.height,
    );
    const ctx = canvas.getContext('2d');
    const iconSingle = BANGDREAM_GACHA_SIMULATE_SPEC.card.iconSingle;
    ctx.drawImage(
      cardIconWithId,
      iconSingle.x,
      iconSingle.y,
      iconSingle.width,
      iconSingle.height,
    );
    return canvas;
  }
}

//从该卡池随机抽取一张卡牌,返回卡牌id,第10发保底
/**
 * 在QQBot 图片视图层中获取卡池Random卡牌。
 *
 * @param gacha - 卡池参数。
 * @param times - 时间列表参数。
 */
function getGachaRandomCard(gacha: Gacha, times: number) {
  const server = getServerByPriority(gacha.publishedAt);
  const gachaDetails = gacha.details[server];
  const gachaRates = gacha.rates[server];
  //计算稀有度
  const cardRarity = applyGachaGuaranteedRarity(
    times,
    parseInt(`${pickGachaRarityByRate(gachaRates)}`),
  );
  const rarityTotalWeight = gachaRates[cardRarity].weightTotal;
  const cardId = pickGachaCardIdByWeight(
    cardRarity,
    rarityTotalWeight,
    gachaDetails,
  );
  const card = new Card(parseInt(`${cardId}`));
  return card;
}

//画下方的卡池Banner与抽卡按钮
/**
 * 在QQBot 图片视图层中绘制卡池横幅。
 *
 * @param gacha - 卡池参数。
 */
async function drawGachaBanner(gacha: Gacha) {
  const gachaBannerImage = resizeImage({
    image: await drawGachaDataBlock(gacha),
    widthMax: getGachaBannerImageMaxWidth(),
  });
  const canvasSize = createGachaBannerCanvasSize(gachaBannerImage.height);
  const canvas = new Canvas(canvasSize.width, canvasSize.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(
    gachaBannerImage,
    BANGDREAM_GACHA_SIMULATE_SPEC.banner.imageX,
    BANGDREAM_GACHA_SIMULATE_SPEC.banner.imageY,
  );
  return canvas;
}
