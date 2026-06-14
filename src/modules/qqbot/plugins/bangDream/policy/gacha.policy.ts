import { BangDreamGachaType } from '@/modules/qqbot/plugins/bangDream/shared/bangdream-protocol';

export const BANGDREAM_GACHA_DEFAULT_SPIN_COUNT = 10;
export const BANGDREAM_GACHA_MAX_SPIN_COUNT = 10000;
export const BANGDREAM_GACHA_GUARANTEED_RARITY = 3;

export type BangDreamRandomSource = () => number;

export type GachaRarityRates = Record<
  string,
  {
    rate: number;
    weightTotal: number;
  }
>;

export type GachaCardWeightList = Record<
  string,
  {
    rarityIndex: number;
    weight: number;
  }
>;

/**
 * 判断卡池类型是否为生日卡池。
 *
 * @param type - 卡池类型。
 * @returns 判断结果。
 */
export function isBirthdayGachaType(type: string): boolean {
  return type === BangDreamGachaType.birthday;
}

/**
 * 判断卡池类型是否为免费卡池。
 *
 * @param type - 卡池类型。
 * @returns 判断结果。
 */
export function isFreeGachaType(type: string): boolean {
  return type === BangDreamGachaType.free;
}

/**
 * 判断日服卡池是否为常驻期。
 *
 * @param gachaPeriod - 卡池期间文案。
 * @returns 判断结果。
 */
export function isPermanentJapaneseGachaPeriod(
  gachaPeriod?: string | null,
): boolean {
  return gachaPeriod === '期限なし';
}

/**
 * 判断抽卡次数是否超过上限。
 *
 * @param times - 抽卡次数。
 * @returns 判断结果。
 */
export function isGachaSpinCountTooLarge(times: number): boolean {
  return times > BANGDREAM_GACHA_MAX_SPIN_COUNT;
}

/**
 * 应用十连保底稀有度规则。
 *
 * @param drawIndex - 从 0 开始的抽卡序号。
 * @param rarity - 原始稀有度。
 * @returns 应用保底后的稀有度。
 */
export function applyGachaGuaranteedRarity(
  drawIndex: number,
  rarity: number,
): number {
  if (drawIndex % BANGDREAM_GACHA_DEFAULT_SPIN_COUNT === 9) {
    return Math.max(rarity, BANGDREAM_GACHA_GUARANTEED_RARITY);
  }
  return rarity;
}

/**
 * 按卡池概率抽取稀有度。
 *
 * @param rarities - 稀有度概率表。
 * @param random - 随机源。
 * @returns 稀有度 key。
 */
export function pickGachaRarityByRate(
  rarities: GachaRarityRates,
  random: BangDreamRandomSource = Math.random,
): string | null {
  const totalRate = Object.values(rarities).reduce(
    (sum, rarity) => sum + rarity.rate,
    0,
  );
  const randomValue = random() * totalRate;
  let currentRate = 0;
  for (const key in rarities) {
    if (!Object.prototype.hasOwnProperty.call(rarities, key)) {
      continue;
    }
    currentRate += rarities[key].rate;
    if (randomValue < currentRate) {
      return key;
    }
  }
  return null;
}

/**
 * 按卡牌权重抽取卡牌 ID。
 *
 * @param rarity - 目标稀有度。
 * @param totalWeight - 目标稀有度总权重。
 * @param cardWeightList - 卡牌权重表。
 * @param random - 随机源。
 * @returns 卡牌 ID。
 */
export function pickGachaCardIdByWeight(
  rarity: number,
  totalWeight: number,
  cardWeightList: GachaCardWeightList,
  random: BangDreamRandomSource = Math.random,
): string | undefined {
  const randomValue = random() * totalWeight;
  let currentWeight = 0;
  for (const cardId in cardWeightList) {
    if (!Object.prototype.hasOwnProperty.call(cardWeightList, cardId)) {
      continue;
    }
    const card = cardWeightList[cardId];
    if (card.rarityIndex !== rarity) {
      continue;
    }
    currentWeight += card.weight;
    if (randomValue < currentWeight) {
      return cardId;
    }
  }
}
