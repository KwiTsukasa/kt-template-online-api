export type BangDreamCardArtAttribute = 'cool' | 'happy' | 'pure' | 'powerful';

export const BANGDREAM_CARD_ART_SPEC = {
  icon: {
    attribute: { height: 45.26, width: 45.26, x: 132.5, y: 3 },
    band: { height: 45, width: 45, x: 0, y: 0 },
    cardId: { fontSize: 30, x: 4, y: 195 },
    cardType: { x: 138, y: 91 },
    height: 180,
    heightWithId: 210,
    limitBreak: {
      fontSize: 25,
      height: 39,
      textX: 155,
      textY: 70,
      width: 39,
      x: 137,
      y: 51,
    },
    skillIconY: 142,
    skillLevel: {
      fontSize: 35,
      height: 39,
      textX: 155.5,
      textY: 107.5,
      width: 35,
      x: 138,
      y: 91,
    },
    star: { height: 29, startY: 150, stepY: 26, width: 29, x: 4 },
    width: 180,
  },
  illustration: {
    attribute: { height: 150, width: 150, x: 1195, y: 11 },
    band: { height: 150, width: 150, x: 11, y: 11 },
    height: 905,
    innerHeight: 879,
    innerWidth: 1334,
    innerX: 13,
    innerY: 13,
    listWidth: 800,
    star: { height: 110, startY: 780, stepY: 100, width: 110, x: 5 },
    width: 1360,
  },
} as const;

/**
 * 创建卡牌小图边框资源路径。
 *
 * @param rarity - 卡牌稀有度。
 * @param attribute - 卡牌属性。
 */
export function createCardIconFramePath(
  rarity: number,
  attribute: BangDreamCardArtAttribute,
): string {
  return createCardFramePath('card', rarity, attribute);
}

/**
 * 创建卡牌插画边框资源路径。
 *
 * @param rarity - 卡牌稀有度。
 * @param attribute - 卡牌属性。
 */
export function createCardIllustrationFramePath(
  rarity: number,
  attribute: BangDreamCardArtAttribute,
): string {
  return createCardFramePath('frame', rarity, attribute);
}

/**
 * 根据 Bestdori 边框命名规则创建远程资源路径。
 *
 * @param prefix - 边框资源前缀。
 * @param rarity - 卡牌稀有度。
 * @param attribute - 卡牌属性。
 */
function createCardFramePath(
  prefix: 'card' | 'frame',
  rarity: number,
  attribute: BangDreamCardArtAttribute,
): string {
  const frameName = rarity === 1 ? `${rarity}-${attribute}` : `${rarity}`;
  return `/res/image/${prefix}-${frameName}.png`;
}
