import { BangDreamGachaType } from '@/modules/qqbot/plugins/bangdream/src/domain/common/bangdream-protocol';

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
 * @param type - type 输入；计算 BangDream判断结果。
 * @returns 判断结果。
 */
export function isBirthdayGachaType(type: string): boolean {
  return type === BangDreamGachaType.birthday;
}

/**
 * 判断卡池类型是否为免费卡池。
 *
 * @param type - type 输入；计算 BangDream判断结果。
 * @returns 判断结果。
 */
export function isFreeGachaType(type: string): boolean {
  return type === BangDreamGachaType.free;
}

/**
 * 判断日服卡池是否为常驻期。
 *
 * @param gachaPeriod - gachaPeriod 输入；计算 BangDream判断结果。
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
 * @param times - BangDream列表；计算 BangDream判断结果。
 * @returns 判断结果。
 */
export function isGachaSpinCountTooLarge(times: number): boolean {
  return times > BANGDREAM_GACHA_MAX_SPIN_COUNT;
}

/**
 * 应用十连保底稀有度规则。
 *
 * @param drawIndex - drawIndex 输入；决定 BangDream条件分支。
 * @param rarity - rarity 输入；驱动 `Math.max()` 的 BangDream步骤。
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
 * @param rarities - BangDream列表；驱动 `Object.values()`、`for()` 的 BangDream步骤。
 * @param random - random 输入；影响 pickGachaRarityByRate 的返回值。
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
 * @param rarity - rarity 输入；决定 BangDream条件分支。
 * @param totalWeight - totalWeight 输入；驱动 `random()` 的 BangDream步骤。
 * @param cardWeightList - cardWeightList 输入；驱动 `for()` 的 BangDream步骤。
 * @param random - random 输入；影响 pickGachaCardIdByWeight 的返回值。
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
