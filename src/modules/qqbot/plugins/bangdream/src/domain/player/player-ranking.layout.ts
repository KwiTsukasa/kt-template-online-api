export const BANGDREAM_PLAYER_RANKING_SPEC = {
  backgroundColor: 'white',
  canvas: {
    height: 110,
    width: 800,
  },
  degree: {
    gap: 10,
    scale: 0.5,
    startX: 210,
    y: 46,
  },
  headShot: {
    height: 90,
    width: 90,
    x: 85,
    y: 10,
  },
  medalRanking: {
    max: 3,
    min: 1,
  },
  ranking: {
    fallbackMaxWidth: 100,
    imageHeight: 21,
    imageWidth: 45,
    textSize: 21,
    x: 12,
    y: 45,
  },
  rightColumn: {
    edgeX: 790,
    maxWidth: 150,
    rankY: 10,
    idY: 45,
    pointY: 70,
  },
  text: {
    idSize: 20,
    introductionMaxWidth: 450,
    introductionSize: 20,
    introductionX: 210,
    introductionY: 75,
    nameMaxWidth: 450,
    nameSize: 23,
    nameX: 210,
    nameY: 10,
    rankSize: 23,
    pointSize: 23,
  },
} as const;

/**
 * 从玩家昵称和简介中移除方括号标签。
 * @param text - 决定从玩家昵称和简介中移除方括号标签内容、边界或目标的 `text` 值。
 * @returns 从玩家昵称和简介中移除方括号标签清理后的文本。
 */
export function stripPlayerRankingTextTags(text: string) {
  return text.replace(/\[[^\]]*\]/g, '');
}

/**
 * 根据`ranking`与当前约束判定排名是否需要使用前三名徽章素材。
 * @param ranking - 决定排名是否需要使用前三名徽章素材内容、边界或目标的 `ranking` 值。
 * @returns 满足排名是否需要使用前三名徽章素材约束时为 `true`；不满足、未命中或显式失败分支为 `false`；无法解析或未命中时为 `null`。
 */
export function isMedalRanking(ranking: number | undefined) {
  return (
    ranking != null &&
    ranking >= BANGDREAM_PLAYER_RANKING_SPEC.medalRanking.min &&
    ranking <= BANGDREAM_PLAYER_RANKING_SPEC.medalRanking.max
  );
}

/**
 * 计算玩家排名行里称号的位置和缩放尺寸，并输出固定投影 `height`、`width`、`x`、`y` 字段。
 * @returns 包含 `height`、`width`、`x`、`y` 字段的排名数据称号布局。
 */
export function createRankingDegreeLayout({
  height,
  index,
  width,
}: {
  height: number;
  index: number;
  width: number;
}) {
  const scale = BANGDREAM_PLAYER_RANKING_SPEC.degree.scale;
  return {
    height: height * scale,
    width: width * scale,
    x:
      BANGDREAM_PLAYER_RANKING_SPEC.degree.startX +
      (width * scale + BANGDREAM_PLAYER_RANKING_SPEC.degree.gap) * index,
    y: BANGDREAM_PLAYER_RANKING_SPEC.degree.y,
  };
}
