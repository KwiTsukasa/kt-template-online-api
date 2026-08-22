import { Gacha } from '@/modules/plugins/bangdream/src/domain/gacha/gacha.model';
import { Card } from '@/modules/plugins/bangdream/src/domain/card/card.model';
import { drawCardIcon } from '@/modules/plugins/bangdream/src/domain/card/card-art.renderer';
import { drawTitle } from '@/modules/plugins/bangdream/src/theme/title.renderer';
import { Canvas } from 'skia-canvas';
import {
  drawTextWithImages,
  drawText,
} from '@/modules/plugins/bangdream/src/theme/canvas-text';
import { outputEasyImages } from '@/modules/plugins/bangdream/src/theme/canvas-output';
import { getServerByPriority } from '@/modules/plugins/bangdream/src/domain/catalog/server.model';
import { drawDataBlock } from '@/modules/plugins/bangdream/src/theme/data-block.renderer';
import { resizeImage } from '@/modules/plugins/bangdream/src/theme/image-stack';
import { drawGachaDataBlock } from '@/modules/plugins/bangdream/src/theme/detail-block.renderer';
import {
  applyGachaGuaranteedRarity,
  BANGDREAM_GACHA_DEFAULT_SPIN_COUNT,
  BANGDREAM_GACHA_MAX_SPIN_COUNT,
  isGachaSpinCountTooLarge,
  pickGachaCardIdByWeight,
  pickGachaRarityByRate,
} from '@/modules/plugins/bangdream/src/domain/policy/gacha.policy';
import {
  BANGDREAM_GACHA_SIMULATE_SPEC,
  createGachaBannerCanvasSize,
  createGachaSimulateWrapOptions,
  getGachaBannerImageMaxWidth,
  getGachaCountTextPosition,
  getGachaDuplicateIconRect,
  getGachaDuplicateLayerCount,
} from '@/modules/plugins/bangdream/src/domain/gacha/gacha-simulate.layout';

/**
 * 根据`gacha`、`times`、`compress`绘制或格式化Random卡池；当 `isGachaSpinCountTooLarge(times)` 成立时返回 `[ `错误: 抽卡次数过多, 请不要超过${BANGDREAM_GACHA_MAX_S…`。
 * @param gacha - 用于Random卡池的领域对象，包含 `isExist`、`initFull`、`rates`、`publishedAt` 字段。
 * @param times - 决定Random卡池内容、边界或目标的 `times` 值；省略时默认采用 `BANGDREAM_GACHA_DEFAULT_SPIN_COUNT`。
 * @param compress - 决定Random卡池内容、边界或目标的 `compress` 值。
 * @returns 按输入顺序得到的Random卡池列表；没有匹配项时为空数组。
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
 * 根据`card`、`numberOfCard`绘制或格式化卡池卡牌；当 `numberOfCard > 1` 成立时返回 `canvas`。
 * @param card - 决定卡池卡牌内容、边界或目标的 `card` 值。
 * @param numberOfCard - 决定卡池卡牌内容、边界或目标的 `numberOfCard` 值；省略时默认采用 `1`。
 * @returns 卡池卡牌。
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
 * 按`gacha`、`times`读取卡池Random卡牌；从 `getServerByPriority` 读取卡池Random卡牌。
 * @param gacha - 用于卡池Random卡牌的领域对象，包含 `publishedAt`、`details`、`rates` 字段。
 * @param times - 决定卡池Random卡牌内容、边界或目标的 `times` 值。
 * @returns 卡池Random卡牌。
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
 * 根据`gacha`绘制或格式化卡池横幅；把图片、文本或图形按布局规格绘制到画布。
 * @param gacha - 决定卡池横幅内容、边界或目标的 `gacha` 值。
 * @returns 卡池横幅。
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
