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
 * 根据`type`与当前约束判定卡池类型是否为生日卡池。
 * @param type - 决定卡池类型是否为生日卡池内容、边界或目标的 `type` 值。
 * @returns 满足卡池类型是否为生日卡池约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
export function isBirthdayGachaType(type: string): boolean {
  return type === BangDreamGachaType.birthday;
}

/**
 * 根据`type`与当前约束判定卡池类型是否为免费卡池。
 * @param type - 决定卡池类型是否为免费卡池内容、边界或目标的 `type` 值。
 * @returns 满足卡池类型是否为免费卡池约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
export function isFreeGachaType(type: string): boolean {
  return type === BangDreamGachaType.free;
}

/**
 * 根据`gachaPeriod`与当前约束判定日服卡池是否为常驻期。
 * @param gachaPeriod - 决定日服卡池是否为常驻期内容、边界或目标的 `gachaPeriod` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 满足日服卡池是否为常驻期约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
export function isPermanentJapaneseGachaPeriod(
  gachaPeriod?: string | null,
): boolean {
  return gachaPeriod === '期限なし';
}

/**
 * 根据`times`与当前约束判定抽卡次数是否超过上限。
 * @param times - 决定抽卡次数是否超过上限内容、边界或目标的 `times` 值。
 * @returns 满足抽卡次数是否超过上限约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
export function isGachaSpinCountTooLarge(times: number): boolean {
  return times > BANGDREAM_GACHA_MAX_SPIN_COUNT;
}

/**
 * 根据`drawIndex`、`rarity`更新十连保底稀有度规则；当 `drawIndex % BANGDREAM_GACHA_DEFAULT_SPIN_COUNT === 9` 成立时返回 `Math.max(rarity, BANGDREAM_GACHA_GUARANTEED…`。
 * @param drawIndex - 决定十连保底稀有度规则内容、边界或目标的 `drawIndex` 值。
 * @param rarity - 决定卡牌边框、星级数量与资源名称的稀有度。
 * @returns 十连保底稀有度规则。
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
 * @param rarities - 用于按卡池概率抽取稀有度的领域对象，包含 `key` 字段。
 * @param random - 负责完成按卡池概率抽取稀有度外部交互的受控能力；省略时默认采用 `Math.random`。
 * @returns 按卡池概率抽取稀有度；无法解析或未命中时为 `null`。
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
 * @param rarity - 决定卡牌边框、星级数量与资源名称的稀有度。
 * @param totalWeight - 决定按卡牌权重抽取卡牌 ID内容、边界或目标的 `totalWeight` 值。
 * @param cardWeightList - 用于按卡牌权重抽取卡牌 ID的领域对象，包含 `cardId` 字段。
 * @param random - 负责完成按卡牌权重抽取卡牌 ID外部交互的受控能力；省略时默认采用 `Math.random`。
 * @returns 按卡牌权重抽取卡牌 ID。
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
